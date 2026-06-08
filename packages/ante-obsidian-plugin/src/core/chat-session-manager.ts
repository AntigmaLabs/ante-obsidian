import type { ChatStatePersistence } from "./chat-persistence";
import type {
  ChatConversationRecord,
  ChatMessageRecord,
  ChatPersistenceState,
  ChatStateSnapshot
} from "./chat-types";
import type { AnteThinkingPreference } from "./ante-thinking";
import type { ContextSnapshot, DocumentChangeArtifact, TaskRecord, TmdState } from "./types";

type ChatListener = (state: ChatStateSnapshot) => void;

const MAX_CONVERSATION_TITLE_CHARS = 60;

const logDebug = (...args: unknown[]): void => {
  void args;
};

const previewText = (value: string, maxChars = 240): string =>
  value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;

const approvalHasOnlyFileEditingTools = (
  approval: NonNullable<ChatMessageRecord["runtime"]>["approval"] | undefined,
): boolean =>
  Boolean(
    approval &&
      approval.tools.length > 0 &&
      approval.tools.every((tool) => {
        const normalized = tool.name.trim().toLowerCase();
        return normalized === "write" || normalized === "edit";
      }),
  );

const shouldHideFileEditingApproval = (
  approval: NonNullable<ChatMessageRecord["runtime"]>["approval"] | undefined,
  artifactCount: number,
): boolean => approvalHasOnlyFileEditingTools(approval) && artifactCount > 0;

const cloneContext = (context: ContextSnapshot | null | undefined): ContextSnapshot | null =>
  context
    ? {
        vaultPath: context.vaultPath,
        filePath: context.filePath,
        noteTitle: context.noteTitle,
        documentText: context.documentText,
        selection: context.selection
          ? {
              text: context.selection.text,
              from: { ...context.selection.from },
              to: { ...context.selection.to }
            }
          : null
      }
    : null;

const contextSignature = (context: ContextSnapshot | null | undefined): string =>
  context
    ? JSON.stringify({
        vaultPath: context.vaultPath,
        filePath: context.filePath,
        noteTitle: context.noteTitle,
        documentText: context.documentText,
        selection: context.selection
          ? {
              text: context.selection.text,
              from: context.selection.from,
              to: context.selection.to
            }
          : null
      })
    : "";

const cloneArtifact = (artifact: DocumentChangeArtifact): DocumentChangeArtifact => ({
  ...artifact,
  target: {
    type: "file",
    path: artifact.target.path
  },
  baselinePath: artifact.baselinePath,
  stagedPath: artifact.stagedPath,
  stagedRoot: artifact.stagedRoot,
  runtimeMode: artifact.runtimeMode
});

const defaultConversationTitle = (prompt: string): string => {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "New chat";
  }
  return normalized.slice(0, MAX_CONVERSATION_TITLE_CHARS);
};

const isEmptyDraftConversation = (conversation: ChatConversationRecord): boolean =>
  !conversation.archived &&
  conversation.messageIds.length === 0 &&
  conversation.title === "New chat";

const sortConversations = (conversations: ChatConversationRecord[]): ChatConversationRecord[] =>
  [...conversations].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

const cloneMessage = (message: ChatMessageRecord): ChatMessageRecord => ({
  ...message,
  attachmentPaths: message.attachmentPaths ? [...message.attachmentPaths] : undefined,
  context: cloneContext(message.context),
  turn: message.turn ? { ...message.turn } : undefined,
  runtime: message.runtime
    ? {
        approval: message.runtime.approval
          ? {
              turnId: message.runtime.approval.turnId,
              message: message.runtime.approval.message,
              tools: message.runtime.approval.tools.map((tool) => ({ ...tool }))
            }
          : undefined,
        processLane: message.runtime.processLane
          ? {
              ...message.runtime.processLane,
              steps: message.runtime.processLane.steps.map((step) => ({ ...step }))
            }
          : undefined,
        telemetry: message.runtime.telemetry
          ? {
              ...message.runtime.telemetry,
              usage: message.runtime.telemetry.usage
                ? { ...message.runtime.telemetry.usage }
                : undefined,
              lastInfo: message.runtime.telemetry.lastInfo
                ? { ...message.runtime.telemetry.lastInfo }
                : undefined,
              timeline: message.runtime.telemetry.timeline.map((entry) => ({ ...entry }))
            }
          : undefined,
        error: message.runtime.error,
        artifactIds: [...message.runtime.artifactIds],
        artifacts: message.runtime.artifacts?.map((artifact) => cloneArtifact(artifact))
      }
    : undefined
});

const emptyRuntime = () => ({
  approval: undefined,
  processLane: undefined,
  telemetry: undefined,
  error: undefined,
  artifactIds: [] as string[]
});

const STRUCTURED_JSON_TYPE_PATTERN = /"type"\s*:\s*"text"/;
const STRUCTURED_TEXT_TYPE_PATTERN = /"type"\s*:\s*"text"/;

const extractJsonCandidates = (text: string): string[] => {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const candidates: string[] = [];
  const exactFence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (exactFence?.[1]) {
    candidates.push(exactFence[1].trim());
  }

  const fencePattern = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  for (const match of trimmed.matchAll(fencePattern)) {
    const candidate = match[1]?.trim();
    if (candidate) {
      candidates.push(candidate);
    }
  }

  candidates.push(trimmed);
  return [...new Set(candidates)];
};

const decodePartialJsonString = (input: string): string => {
  let output = "";

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char !== "\\") {
      output += char;
      continue;
    }

    index += 1;
    const escaped = input[index];
    if (escaped == null) {
      break;
    }

    switch (escaped) {
      case '"':
        output += '"';
        break;
      case "\\":
        output += "\\";
        break;
      case "/":
        output += "/";
        break;
      case "b":
        output += "\b";
        break;
      case "f":
        output += "\f";
        break;
      case "n":
        output += "\n";
        break;
      case "r":
        output += "\r";
        break;
      case "t":
        output += "\t";
        break;
      case "u": {
        const hex = input.slice(index + 1, index + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          output += String.fromCharCode(Number.parseInt(hex, 16));
          index += 4;
        }
        break;
      }
      default:
        output += escaped;
        break;
    }
  }

  return output;
};

const extractStructuredStreamingText = (text: string): string | null => {
  for (const candidate of extractJsonCandidates(text)) {
    if (!candidate.startsWith("{") || !STRUCTURED_JSON_TYPE_PATTERN.test(candidate)) {
      continue;
    }

    if (!STRUCTURED_TEXT_TYPE_PATTERN.test(candidate)) {
      return "";
    }

    const textFieldMatch = /"text"\s*:\s*"/.exec(candidate);
    if (!textFieldMatch) {
      return "";
    }

    const contentStart = textFieldMatch.index + textFieldMatch[0].length;
    let escaped = false;
    let valueEnd = candidate.length;

    for (let index = contentStart; index < candidate.length; index += 1) {
      const char = candidate[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        valueEnd = index;
        break;
      }
    }

    return decodePartialJsonString(candidate.slice(contentStart, valueEnd));
  }

  return null;
};

const isRecoverableConversationSession = (task: TaskRecord): boolean => Boolean(task.runtimeSession?.sessionId && task.endedAt);

const isRecoverableConversationMessage = (
  message: ChatMessageRecord | undefined
): message is ChatMessageRecord & { turn: NonNullable<ChatMessageRecord["turn"]> } =>
  Boolean(message?.turn?.runtimeSessionId && message.status !== "streaming");

const isMissingAnteSessionError = (error: string | undefined): boolean =>
  Boolean(
    error &&
      (error.includes("saved session files are missing") ||
        error.includes("Failed to resume session: No such file or directory"))
  );

export class ChatSessionManager {
  private readonly listeners = new Set<ChatListener>();
  private readonly conversations = new Map<string, ChatConversationRecord>();
  private readonly messages = new Map<string, ChatMessageRecord>();
  private readonly taskToMessageId = new Map<string, string>();
  private activeConversationId: string | null = null;
  private saveTimer: number | null = null;
  private lastTaskState = new Map<string, string>();

  constructor(private readonly persistence: ChatStatePersistence, persisted?: ChatPersistenceState | null) {
    for (const conversation of persisted?.conversations ?? []) {
      this.conversations.set(conversation.id, {
        ...conversation,
        pinnedContext: cloneContext(conversation.pinnedContext),
        runtimeTarget: conversation.runtimeTarget ? { ...conversation.runtimeTarget } : undefined,
        messageIds: [...conversation.messageIds]
      });
    }
    for (const message of persisted?.messages ?? []) {
      this.messages.set(message.id, cloneMessage(message));
      if (message.turn?.taskId) {
        this.taskToMessageId.set(message.turn.taskId, message.id);
      }
    }
    this.activeConversationId = persisted?.activeConversationId ?? null;
    if (!this.activeConversationId || !this.conversations.has(this.activeConversationId)) {
      this.activeConversationId = this.ensureConversation().id;
    }
  }

  dispose(): void {
    if (this.saveTimer != null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  subscribe(listener: ChatListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): ChatStateSnapshot {
    const conversations = sortConversations([...this.conversations.values()]);
    const messagesByConversation: Record<string, ChatMessageRecord[]> = {};
    for (const conversation of conversations) {
      messagesByConversation[conversation.id] = conversation.messageIds
        .map((messageId) => this.messages.get(messageId))
        .filter((message): message is ChatMessageRecord => Boolean(message))
        .map((message) => cloneMessage(message));
    }
    return {
      conversations,
      messagesByConversation,
      activeConversationId: this.activeConversationId
    };
  }

  createConversation(options?: { title?: string; context?: ContextSnapshot | null; forceNew?: boolean }): ChatConversationRecord {
    const requestedTitle = options?.title?.trim() || "New chat";
    if (requestedTitle === "New chat" && !options?.forceNew) {
      const existingDraft = sortConversations([...this.conversations.values()]).find((conversation) =>
        isEmptyDraftConversation(conversation)
      );
      if (existingDraft) {
        if (
          options?.context &&
          contextSignature(existingDraft.pinnedContext) !== contextSignature(options.context)
        ) {
          existingDraft.pinnedContext = cloneContext(options.context);
          existingDraft.updatedAt = new Date().toISOString();
        }
        this.activeConversationId = existingDraft.id;
        this.persistAndNotify();
        return existingDraft;
      }
    }

    const timestamp = new Date().toISOString();
    const conversation: ChatConversationRecord = {
      id: crypto.randomUUID(),
      title: requestedTitle,
      createdAt: timestamp,
      updatedAt: timestamp,
      pinnedContext: cloneContext(options?.context),
      runtimeTarget: undefined,
      messageIds: [],
      archived: false
    };
    this.conversations.set(conversation.id, conversation);
    this.activeConversationId = conversation.id;
    this.persistAndNotify();
    return conversation;
  }

  setActiveConversation(conversationId: string): void {
    if (!this.conversations.has(conversationId) || this.activeConversationId === conversationId) {
      return;
    }
    this.activeConversationId = conversationId;
    this.persistAndNotify();
  }

  renameConversation(conversationId: string, title: string): void {
    const conversation = this.conversations.get(conversationId);
    const nextTitle = title.trim();
    if (!conversation || !nextTitle || conversation.title === nextTitle) {
      return;
    }
    conversation.title = nextTitle.slice(0, MAX_CONVERSATION_TITLE_CHARS);
    conversation.updatedAt = new Date().toISOString();
    this.persistAndNotify();
  }

  removeConversation(conversationId: string): string[] {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return [];
    }
    const removedTaskIds: string[] = [];
    for (const messageId of conversation.messageIds) {
      const message = this.messages.get(messageId);
      if (message?.turn?.taskId) {
        removedTaskIds.push(message.turn.taskId);
        this.taskToMessageId.delete(message.turn.taskId);
      }
      this.messages.delete(messageId);
    }
    this.conversations.delete(conversationId);
    if (this.activeConversationId === conversationId) {
      this.activeConversationId = sortConversations([...this.conversations.values()])[0]?.id ?? null;
    }
    if (!this.activeConversationId) {
      this.activeConversationId = this.ensureConversation().id;
    }
    this.persistAndNotify();
    return removedTaskIds;
  }

  resetActiveConversation(): void {
    const activeId = this.ensureConversation().id;
    this.removeConversation(activeId);
  }

  getActiveConversation(): ChatConversationRecord {
    return this.ensureConversation();
  }

  getConversationRuntimeSessionId(conversationId: string): string | null {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return null;
    }
    for (const messageId of [...conversation.messageIds].reverse()) {
      const message = this.messages.get(messageId);
      if (!isRecoverableConversationMessage(message)) {
        continue;
      }
      const sessionId = message.turn?.runtimeSessionId?.trim();
      if (sessionId) {
        return sessionId;
      }
    }
    return null;
  }

  getConversationRuntimeTarget(
    conversationId: string
  ): {
    provider: string;
    model: string;
    thinking: AnteThinkingPreference;
  } | null {
    const conversation = this.conversations.get(conversationId);
    return conversation?.runtimeTarget ? { ...conversation.runtimeTarget } : null;
  }

  setConversationRuntimeTarget(
    conversationId: string,
    target: {
      provider: string;
      model: string;
      thinking: AnteThinkingPreference;
    }
  ): void {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return;
    }
    if (
      conversation.runtimeTarget?.provider === target.provider &&
      conversation.runtimeTarget?.model === target.model &&
      conversation.runtimeTarget?.thinking === target.thinking
    ) {
      return;
    }
    conversation.runtimeTarget = { ...target };
    conversation.updatedAt = new Date().toISOString();
    this.persistAndNotify();
  }

  appendAssistantNotice(conversationId: string, text: string): string | null {
    const conversation = this.conversations.get(conversationId);
    const trimmed = text.trim();
    if (!conversation || !trimmed) {
      return null;
    }
    const message = this.pushMessage(conversation, {
      role: "assistant",
      status: "completed",
      text: trimmed,
      context: null
    });
    this.persistAndNotify();
    return message.id;
  }

  clearConversationRuntimeSessionId(conversationId: string, sessionId: string): void {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || !sessionId.trim()) {
      return;
    }

    let changed = false;
    for (const messageId of conversation.messageIds) {
      const message = this.messages.get(messageId);
      if (!message?.turn?.runtimeSessionId || message.turn.runtimeSessionId !== sessionId) {
        continue;
      }
      message.turn = {
        ...message.turn,
        runtimeSessionId: undefined
      };
      changed = true;
    }

    if (changed) {
      conversation.updatedAt = new Date().toISOString();
      this.persistAndNotify();
    }
  }

  appendUserPrompt(
    prompt: string,
    context: ContextSnapshot | null,
    submissionText?: string,
    attachmentPaths?: string[]
  ): { conversation: ChatConversationRecord; userMessageId: string; createdConversation: boolean } {
    const hadActiveConversation =
      Boolean(this.activeConversationId) && Boolean(this.activeConversationId && this.conversations.get(this.activeConversationId));
    const conversation = this.ensureConversation({ title: defaultConversationTitle(prompt), context });
    if (conversation.messageIds.length === 0 && conversation.title === "New chat") {
      conversation.title = defaultConversationTitle(prompt);
    }
    if (!conversation.pinnedContext && context) {
      conversation.pinnedContext = cloneContext(context);
    }
    const message = this.pushMessage(conversation, {
      role: "user",
      status: "completed",
      text: prompt,
      submissionText,
      attachmentPaths,
      context
    });
    this.persistAndNotify();
    return {
      conversation,
      userMessageId: message.id,
      createdConversation: !hadActiveConversation || conversation.messageIds.length === 1
    };
  }

  bindTaskToConversation(taskId: string, conversationId: string): void {
    const conversation = this.conversations.get(conversationId) ?? this.ensureConversation();
    if (this.taskToMessageId.has(taskId)) {
      return;
    }
    const timestamp = new Date().toISOString();
    const message: ChatMessageRecord = {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "assistant",
      status: "streaming",
      text: "",
      createdAt: timestamp,
      updatedAt: timestamp,
      turn: { taskId },
      runtime: emptyRuntime()
    };
    conversation.messageIds.push(message.id);
    conversation.updatedAt = timestamp;
    this.messages.set(message.id, message);
    this.taskToMessageId.set(taskId, message.id);
    this.persistAndNotify();
  }

  createAssistantTurn(conversationId: string, taskId: string): void {
    this.bindTaskToConversation(taskId, conversationId);
  }

  rollbackPendingSend(
    conversationId: string,
    userMessageId: string,
    taskId: string,
    removeConversationIfEmpty = false,
    extraMessageIds: string[] = []
  ): string[] {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return [];
    }
    const assistantMessageId = this.taskToMessageId.get(taskId);
    const messageIdsToRemove = new Set(
      [userMessageId, assistantMessageId, ...extraMessageIds].filter((value): value is string => Boolean(value))
    );
    if (messageIdsToRemove.size === 0) {
      return [];
    }
    const removedTaskIds: string[] = [];
    conversation.messageIds = conversation.messageIds.filter((messageId) => !messageIdsToRemove.has(messageId));
    for (const messageId of messageIdsToRemove) {
      const message = this.messages.get(messageId);
      if (message?.turn?.taskId) {
        removedTaskIds.push(message.turn.taskId);
        this.taskToMessageId.delete(message.turn.taskId);
      }
      this.messages.delete(messageId);
    }
    conversation.updatedAt = new Date().toISOString();
    if (removeConversationIfEmpty && conversation.messageIds.length === 0) {
      return this.removeConversation(conversationId);
    }
    this.persistAndNotify();
    return removedTaskIds;
  }

  removeConversationIfEmpty(conversationId: string): void {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || conversation.messageIds.length > 0) {
      return;
    }
    this.conversations.delete(conversationId);
    if (this.activeConversationId === conversationId) {
      this.activeConversationId = sortConversations([...this.conversations.values()])[0]?.id ?? null;
      if (!this.activeConversationId) {
        this.activeConversationId = this.ensureConversation().id;
      }
    }
    this.persistAndNotify();
  }

  syncFromTaskState(state: TmdState): void {
    const chatTasks = state.tasks.filter((task) => task.triggerSource === "chat");
    for (const task of chatTasks) {
      const signature = this.buildTaskSignature(task);
      if (this.lastTaskState.get(task.id) === signature) {
        continue;
      }
      this.lastTaskState.set(task.id, signature);
      this.syncTask(task);
    }

    const activeTaskIds = new Set(chatTasks.map((task) => task.id));
    for (const taskId of [...this.lastTaskState.keys()]) {
      if (activeTaskIds.has(taskId)) {
        continue;
      }
      this.lastTaskState.delete(taskId);
    }
  }

  private syncTask(task: TaskRecord): void {
    const messageId = this.taskToMessageId.get(task.id);
    if (!messageId) {
      return;
    }
    const message = this.messages.get(messageId);
    if (!message) {
      return;
    }

    if (task.error && isMissingAnteSessionError(task.error)) {
      const boundSessionId = this.getConversationRuntimeSessionId(message.conversationId);
      if (boundSessionId) {
        this.clearConversationRuntimeSessionId(message.conversationId, boundSessionId);
      }
    }

    const hasStructuredResult = Boolean(task.textResult?.text.trim()) || task.artifacts.length > 0;
    const extractedStreamingText = extractStructuredStreamingText(task.stdoutText);
    const hideStructuredStreamingText = extractedStreamingText == null && task.stdoutText.trimStart().startsWith("{");
    const streamingText = extractedStreamingText ?? (hideStructuredStreamingText ? "" : task.stdoutText);
    const nextText =
      task.status === "running"
        ? streamingText
        : task.textResult?.text.trim() || (hasStructuredResult ? "" : streamingText);
    const nextStatus =
      task.status === "cancelled"
        ? "cancelled"
        : task.error
          ? "failed"
          : task.status === "awaiting-apply"
            ? "awaiting-apply"
            : task.status === "running"
              ? "streaming"
              : "completed";
    const nextRuntime = {
      approval: shouldHideFileEditingApproval(task.pendingApproval, task.artifacts.length)
        ? undefined
        : task.pendingApproval,
      processLane: task.processLane
        ? {
            ...task.processLane,
            steps: task.processLane.steps.map((step) => ({ ...step }))
          }
        : undefined,
      telemetry: task.telemetry
        ? {
            ...task.telemetry,
            usage: task.telemetry.usage ? { ...task.telemetry.usage } : undefined,
            lastInfo: task.telemetry.lastInfo ? { ...task.telemetry.lastInfo } : undefined,
            timeline: task.telemetry.timeline.map((entry) => ({ ...entry }))
          }
        : undefined,
      error: task.error,
      artifactIds: task.artifacts.map((artifact) => artifact.id),
      artifacts: task.artifacts.map((artifact) => cloneArtifact(artifact))
    };
    const nextTurn = {
      taskId: task.id,
      runtimeSessionId: task.runtimeSession?.sessionId
    };

    const runtimeArtifactCount = task.artifacts.filter((artifact) => Boolean(artifact.runtimeToolId)).length;
    const fallbackArtifactCount = task.artifacts.length - runtimeArtifactCount;
    if (runtimeArtifactCount > 0 || fallbackArtifactCount > 0 || extractedStreamingText != null) {
      logDebug(
        `syncTask id=${task.id} status=${task.status} runtimeArtifacts=${runtimeArtifactCount} fallbackArtifacts=${fallbackArtifactCount} structuredStreaming=${extractedStreamingText != null}`,
      );
      if (extractedStreamingText != null && task.stdoutText.trim()) {
        logDebug(`syncTask structured preview=${JSON.stringify(previewText(task.stdoutText, 400))}`);
      }
    }

    const changed =
      message.text !== nextText ||
      message.status !== nextStatus ||
      message.updatedAt !== (task.endedAt ?? task.startedAt) ||
      JSON.stringify(message.runtime) !== JSON.stringify(nextRuntime) ||
      JSON.stringify(message.turn) !== JSON.stringify(nextTurn);

    if (!changed) {
      return;
    }

    message.text = nextText;
    message.status = nextStatus;
    message.updatedAt = task.endedAt ?? new Date().toISOString();
    message.turn = nextTurn;
    message.runtime = nextRuntime;
    const conversation = this.conversations.get(message.conversationId);
    if (conversation) {
      conversation.updatedAt = message.updatedAt;
      if (conversation.messageIds.length === 1 && conversation.title === "New chat") {
        conversation.title = defaultConversationTitle(message.text || "New chat");
      }
    }
    this.persistAndNotify();
  }

  private pushMessage(
    conversation: ChatConversationRecord,
    input: Pick<ChatMessageRecord, "role" | "status" | "text" | "submissionText" | "attachmentPaths" | "context">
  ): ChatMessageRecord {
    const timestamp = new Date().toISOString();
    const message: ChatMessageRecord = {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: input.role,
      status: input.status,
      text: input.text,
      submissionText: input.submissionText,
      attachmentPaths: input.attachmentPaths ? [...input.attachmentPaths] : undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
      context: cloneContext(input.context)
    };
    conversation.messageIds.push(message.id);
    conversation.updatedAt = timestamp;
    this.messages.set(message.id, message);
    return message;
  }

  private ensureConversation(defaults?: { title?: string; context?: ContextSnapshot | null }): ChatConversationRecord {
    const active = this.activeConversationId ? this.conversations.get(this.activeConversationId) : null;
    if (active) {
      return active;
    }
    return this.createConversation(defaults);
  }

  private buildTaskSignature(task: TaskRecord): string {
    return JSON.stringify({
      id: task.id,
      status: task.status,
      stdoutText: task.stdoutText,
      textResult: task.textResult?.text ?? "",
      error: task.error ?? "",
      runtimeSessionId: task.runtimeSession?.sessionId ?? "",
      persistedRuntimeSessionId: isRecoverableConversationSession(task) ? task.runtimeSession?.sessionId ?? "" : "",
      approval: task.pendingApproval,
      processLane: task.processLane,
      telemetry: task.telemetry,
      artifacts: task.artifacts.map((artifact) => ({
        id: artifact.id,
        applyState: artifact.applyState,
        applyError: artifact.applyError ?? ""
      })),
      endedAt: task.endedAt ?? ""
    });
  }

  private persistAndNotify(): void {
    this.schedulePersist();
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private schedulePersist(): void {
    if (this.saveTimer != null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.persistence.saveChatState(this.serialize());
    }, 150);
  }

  private serialize(): ChatPersistenceState {
    return {
      conversations: [...this.conversations.values()].map((conversation) => ({
        ...conversation,
        pinnedContext: cloneContext(conversation.pinnedContext),
        runtimeTarget: conversation.runtimeTarget ? { ...conversation.runtimeTarget } : undefined,
        messageIds: [...conversation.messageIds]
      })),
      messages: [...this.messages.values()].map((message) => cloneMessage(message)),
      activeConversationId: this.activeConversationId
    };
  }
}
