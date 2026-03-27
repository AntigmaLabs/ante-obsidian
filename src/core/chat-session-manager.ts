import type TmdPlugin from "../obsidian/main";
import type {
  ChatConversationRecord,
  ChatMessageRecord,
  ChatPersistenceState,
  ChatStateSnapshot
} from "./chat-types";
import type { ContextSnapshot, TaskRecord, TmdState } from "./types";

type ChatListener = (state: ChatStateSnapshot) => void;

const MAX_CONVERSATION_TITLE_CHARS = 60;

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

const defaultConversationTitle = (prompt: string): string => {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "New chat";
  }
  return normalized.slice(0, MAX_CONVERSATION_TITLE_CHARS);
};

const sortConversations = (conversations: ChatConversationRecord[]): ChatConversationRecord[] =>
  [...conversations].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

const cloneMessage = (message: ChatMessageRecord): ChatMessageRecord => ({
  ...message,
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
        error: message.runtime.error,
        artifactIds: [...message.runtime.artifactIds]
      }
    : undefined
});

const emptyRuntime = () => ({
  approval: undefined,
  processLane: undefined,
  error: undefined,
  artifactIds: [] as string[]
});

export class ChatSessionManager {
  private readonly listeners = new Set<ChatListener>();
  private readonly conversations = new Map<string, ChatConversationRecord>();
  private readonly messages = new Map<string, ChatMessageRecord>();
  private readonly taskToMessageId = new Map<string, string>();
  private activeConversationId: string | null = null;
  private saveTimer: number | null = null;
  private lastTaskState = new Map<string, string>();

  constructor(private readonly plugin: TmdPlugin, persisted?: ChatPersistenceState | null) {
    for (const conversation of persisted?.conversations ?? []) {
      this.conversations.set(conversation.id, {
        ...conversation,
        pinnedContext: cloneContext(conversation.pinnedContext),
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

  createConversation(options?: { title?: string; context?: ContextSnapshot | null }): ChatConversationRecord {
    const timestamp = new Date().toISOString();
    const conversation: ChatConversationRecord = {
      id: crypto.randomUUID(),
      title: options?.title?.trim() || "New chat",
      createdAt: timestamp,
      updatedAt: timestamp,
      pinnedContext: cloneContext(options?.context),
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
      const sessionId = this.messages.get(messageId)?.turn?.runtimeSessionId?.trim();
      if (sessionId) {
        return sessionId;
      }
    }
    return null;
  }

  appendUserPrompt(
    prompt: string,
    context: ContextSnapshot | null
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
    removeConversationIfEmpty = false
  ): string[] {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return [];
    }
    const assistantMessageId = this.taskToMessageId.get(taskId);
    const messageIdsToRemove = new Set([userMessageId, assistantMessageId].filter((value): value is string => Boolean(value)));
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

    const nextText = task.status === "running" ? task.stdoutText : task.textResult?.text.trim() || task.stdoutText;
    const nextStatus =
      task.error ? "failed" : task.status === "awaiting-apply" ? "awaiting-apply" : task.status === "running" ? "streaming" : "completed";
    const nextRuntime = {
      approval: task.pendingApproval,
      processLane: task.processLane
        ? {
            ...task.processLane,
            steps: task.processLane.steps.map((step) => ({ ...step }))
          }
        : undefined,
      error: task.error,
      artifactIds: task.artifacts.map((artifact) => artifact.id)
    };
    const nextTurn = {
      taskId: task.id,
      runtimeSessionId: task.runtimeSession?.sessionId
    };

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
    input: Pick<ChatMessageRecord, "role" | "status" | "text" | "context">
  ): ChatMessageRecord {
    const timestamp = new Date().toISOString();
    const message: ChatMessageRecord = {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: input.role,
      status: input.status,
      text: input.text,
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
      approval: task.pendingApproval,
      processLane: task.processLane,
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
      void this.plugin.saveChatState(this.serialize());
    }, 150);
  }

  private serialize(): ChatPersistenceState {
    return {
      conversations: [...this.conversations.values()].map((conversation) => ({
        ...conversation,
        pinnedContext: cloneContext(conversation.pinnedContext),
        messageIds: [...conversation.messageIds]
      })),
      messages: [...this.messages.values()].map((message) => cloneMessage(message)),
      activeConversationId: this.activeConversationId
    };
  }
}
