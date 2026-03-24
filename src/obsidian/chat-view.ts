import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type TmdPlugin from "./main";
import type {
  ContextSnapshot,
  RuntimeApprovalDecision,
  TaskRecord,
  TmdState
} from "../core/types";
import {
  renderArtifactDiff,
  renderDiffSummary,
  resolveArtifactDiffs,
  type ResolvedArtifactDiff
} from "./diff-block";
import { formatLoadingLabel } from "../core/loading-label";
import { shouldHandlePromptEnter } from "../core/terminal-input";

export const TMD_CHAT_VIEW_TYPE = "tmd-chat-view";

const MAX_CHAT_PREVIEW_CHARS = 12000;
const MAX_CHAT_PREVIEW_LINES = 160;

const hashText = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const parseJsonPayload = (value: string): unknown | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
};

const extractStreamingJsonPreview = (value: string): string => {
  const candidates = [
    /"summary"\s*:\s*"((?:\\.|[^"])*)"/s,
    /"title"\s*:\s*"((?:\\.|[^"])*)"/s,
    /"afterText"\s*:\s*"((?:\\.|[^"])*)"/s,
  ];

  for (const pattern of candidates) {
    const match = pattern.exec(value);
    const raw = match?.[1];
    if (!raw) {
      continue;
    }
    const normalized = raw
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\")
      .trim();
    if (normalized) {
      return normalized;
    }
  }

  return "";
};

const extractPartialJsonPreview = (value: string): string => {
  const normalized = value
    .replace(/\r/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\")
    .trim();

  if (!normalized) {
    return "";
  }

  const afterTextMatch = /"afterText"\s*:\s*"([\s\S]*)$/s.exec(normalized);
  if (afterTextMatch?.[1]) {
    return afterTextMatch[1].trim();
  }

  const summaryMatch = /"summary"\s*:\s*"([\s\S]*)$/s.exec(normalized);
  if (summaryMatch?.[1]) {
    return summaryMatch[1].trim();
  }

  const titleMatch = /"title"\s*:\s*"([\s\S]*)$/s.exec(normalized);
  if (titleMatch?.[1]) {
    return titleMatch[1].trim();
  }

  return normalized;
};

const clampPreview = (value: string): string => {
  const normalized = value.replace(/\r/g, "");
  if (!normalized) {
    return "";
  }

  const lines = normalized.split("\n");
  const tailLines =
    lines.length > MAX_CHAT_PREVIEW_LINES
      ? lines.slice(-MAX_CHAT_PREVIEW_LINES)
      : lines;
  let preview = tailLines.join("\n");

  if (preview.length > MAX_CHAT_PREVIEW_CHARS) {
    preview = preview.slice(-MAX_CHAT_PREVIEW_CHARS);
  }

  if (preview !== normalized) {
    const omittedChars = Math.max(0, normalized.length - preview.length);
    const omittedLines = Math.max(0, lines.length - tailLines.length);
    preview = `... truncated preview (${omittedLines} lines, ${omittedChars} chars omitted) ...\n${preview}`;
  }

  return preview.trim();
};

const analyzeOutput = (task: TaskRecord): string => {
  const primaryText = task.textResult?.text.trim()
    ? task.textResult.text.trim()
    : task.stdoutText.trim();

  if (!primaryText) {
    return "";
  }

  const parsed = parseJsonPayload(primaryText);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if (
      (record.type === "text" || record.type === "terminal") &&
      typeof record.text === "string"
    ) {
      return record.text.trim();
    }
    if (record.type === "change") {
      const summary =
        typeof record.summary === "string" ? record.summary.trim() : "";
      const title = typeof record.title === "string" ? record.title.trim() : "";
      return summary || title || "Prepared a Markdown change.";
    }
    if (record.type === "changes" && Array.isArray(record.changes)) {
      return `${record.changes.length} Markdown changes ready to review.`;
    }
  }

  return clampPreview(primaryText);
};

const buildStreamingPreview = (task: TaskRecord): string => {
  const combined = task.stdoutText;
  if (!combined.trim()) {
    return "";
  }
  if (
    /"type"\s*:\s*"change"/.test(combined) ||
    /"type"\s*:\s*"changes"/.test(combined)
  ) {
    return clampPreview(
      extractStreamingJsonPreview(combined) ||
        extractPartialJsonPreview(combined) ||
        "Preparing Markdown change..."
    );
  }

  return clampPreview(combined.replace(/\\n/g, "\n").trim());
};

const summarizeContext = (context: ContextSnapshot | null): string => {
  if (!context?.filePath) {
    return "No note context";
  }

  const selection = context.selection?.text?.trim();
  if (selection) {
    return `${context.filePath} · selection ${selection.length} chars`;
  }

  const documentText = context.documentText?.trim() ?? "";
  return `${context.filePath} · note ${documentText.length} chars`;
};

const formatTime = (timestamp: string): string =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

const hasContextDispatchLog = (task: TaskRecord): boolean =>
  task.logs.some(
    (log) =>
      log.stream === "system" &&
      (/^Sending Markdown context\b/.test(log.text) ||
        /^Sending context reference\b/.test(log.text))
  );

const hasTurnActivityLog = (task: TaskRecord): boolean =>
  task.logs.some(
    (log) =>
      log.stream === "system" &&
      (/^Ante TurnStart\b/.test(log.text) ||
        /^Ante ToolStart\b/.test(log.text) ||
        /^Ante ToolUpdate\b/.test(log.text) ||
        /^Ante ToolEnd\b/.test(log.text) ||
        /^Ante TurnPause\b/.test(log.text))
  );

const hasStdoutLog = (task: TaskRecord): boolean =>
  task.stdoutText.trim().length > 0;

const loadingLabelForTask = (task: TaskRecord, loadingFrame: number): string => {
  if (!task.runtimeSession?.sessionId) {
    return "booting ante";
  }
  if (
    hasContextDispatchLog(task) &&
    !hasTurnActivityLog(task) &&
    !hasStdoutLog(task)
  ) {
    return "sending context";
  }
  return formatLoadingLabel(task.id, loadingFrame);
};

const buildProcessStatusLines = (task: TaskRecord): string[] => {
  const process = task.status === "running" ? task.processLane : undefined;
  if (!process) {
    return [];
  }

  const lines: string[] = [];
  const activeStep =
    process.steps.find((step) => step.status === "in_progress") ??
    process.steps.find((step) => step.status === "pending");

  lines.push(`out ${activeStep?.activeLabel ?? activeStep?.label ?? process.label}`);

  for (const step of process.steps) {
    lines.push(
      `out ${step.status === "completed" ? "■" : step.status === "in_progress" ? "▪" : "□"} ${
        step.status === "in_progress" ? (step.activeLabel ?? step.label) : step.label
      }`
    );
  }

  if (process.steps.length === 0 && process.label !== lines[0]?.replace(/^out /, "")) {
    lines.push(`out ${process.phase} · ${process.label}`);
  }

  return lines;
};

interface ChatContextElements {
  titleEl: HTMLDivElement;
  valueEl: HTMLDivElement;
  snippetEl: HTMLDivElement | null;
}

interface ChatTaskPairElements {
  userEl: HTMLDivElement;
  assistantEl: HTMLDivElement;
}

interface ChatMessageElements {
  rootEl: HTMLDivElement;
  bubbleEl: HTMLDivElement;
  roleEl: HTMLDivElement;
  stampEl: HTMLDivElement;
  textEl: HTMLPreElement | null;
  textSignature: string | null;
  loadingEl: HTMLDivElement | null;
  loadingSignature: string | null;
  processEl: HTMLDivElement | null;
  processSignature: string | null;
  artifactsHostEl: HTMLDivElement | null;
  artifactsSignature: string | null;
  approvalHostEl: HTMLDivElement | null;
  approvalSignature: string | null;
  errorEl: HTMLDivElement | null;
}

export class TmdChatView extends ItemView {
  private unsubscribe: (() => void) | null = null;
  private loadingTimer: number | null = null;
  private loadingFrame = 0;
  private renderVersion = 0;
  private latestState: TmdState | null = null;
  private liveContext: ContextSnapshot | null = null;
  private readonly expandedArtifactIds = new Set<string>();
  private readonly resolvedArtifactsCache = new Map<
    string,
    { signature: string; diffs: ResolvedArtifactDiff[] }
  >();
  private expandedStateTaskId: string | null = null;
  private composerEl!: HTMLTextAreaElement;
  private isComposing = false;
  private shellEl!: HTMLDivElement;
  private timelineEl!: HTMLDivElement;
  private contextEl!: HTMLDivElement;
  private stopButtonEl!: HTMLButtonElement;
  private resetButtonEl!: HTMLButtonElement;
  private emptyStateEl: HTMLDivElement | null = null;
  private contextNodes: ChatContextElements | null = null;
  private readonly taskPairEls = new Map<string, ChatTaskPairElements>();
  private readonly messageEls = new WeakMap<HTMLElement, ChatMessageElements>();
  private lastRenderedTasks: TaskRecord[] = [];
  private readonly outputPreviewCache = new Map<string, { signature: string; text: string }>();
  private readonly streamingPreviewCache = new Map<string, { signature: string; text: string }>();

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TmdPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return TMD_CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Chat with Ante";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("tmd-view", "tmd-chat-view");
    this.buildShell();
    this.liveContext = await this.plugin.hostAdapter.capturePreferredContext();
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        void this.refreshLiveContext();
      })
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        void this.refreshLiveContext();
      })
    );
    this.unsubscribe = this.plugin.taskEngine.subscribe((state) => {
      this.latestState = state;
      this.syncLoadingTimer(state);
      void this.render(state);
    });
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.loadingTimer != null) {
      window.clearInterval(this.loadingTimer);
      this.loadingTimer = null;
      this.loadingFrame = 0;
    }
  }

  private buildShell(): void {
    const { contentEl } = this;
    contentEl.empty();

    this.shellEl = contentEl.createDiv({ cls: "tmd-chat-shell" });
    const titleRow = this.shellEl.createDiv({ cls: "tmd-title-row tmd-chat-header" });
    titleRow.createEl("h2", { text: "Chat with Ante" });
    const headerActions = titleRow.createDiv({ cls: "tmd-chat-header-actions" });
    this.resetButtonEl = headerActions.createEl("button", { text: "Reset" });
    this.resetButtonEl.addEventListener("click", () => this.resetChatHistory());
    this.stopButtonEl = headerActions.createEl("button", { text: "Stop" });
    this.stopButtonEl.addEventListener("click", () => this.plugin.taskEngine.cancelActiveTask());

    this.contextEl = this.shellEl.createDiv({ cls: "tmd-chat-contextbar" });
    this.contextNodes = {
      titleEl: this.contextEl.createDiv({ cls: "tmd-chat-context-title" }),
      valueEl: this.contextEl.createDiv({ cls: "tmd-chat-context-value" }),
      snippetEl: null
    };
    this.contextNodes.titleEl.setText("Current context");
    const body = this.shellEl.createDiv({ cls: "tmd-chat-body" });
    this.timelineEl = body.createDiv({ cls: "tmd-chat-timeline" });

    const composer = this.shellEl.createDiv({ cls: "tmd-chat-composer" });
    this.composerEl = composer.createEl("textarea", { cls: "tmd-chat-input" });
    this.composerEl.placeholder = "Ask about the current note, rewrite selected text, or plan next steps.";
    this.composerEl.addEventListener("compositionstart", () => {
      this.isComposing = true;
    });
    this.composerEl.addEventListener("compositionend", () => {
      this.isComposing = false;
    });
    this.composerEl.addEventListener("keydown", (event) => {
      if (
        !shouldHandlePromptEnter({
          isComposing: this.isComposing,
          eventIsComposing: event.isComposing,
          keyCode: event.keyCode
        })
      ) {
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.runPrompt();
      }
    });

    const actions = composer.createDiv({ cls: "tmd-chat-composer-actions" });
    actions.createDiv({
      cls: "tmd-meta",
      text: "Enter to send · Shift+Enter for newline"
    });
    const sendButton = actions.createEl("button", { text: "Send" });
    sendButton.addEventListener("click", () => this.runPrompt());
  }

  private async refreshLiveContext(): Promise<void> {
    this.liveContext = await this.plugin.hostAdapter.capturePreferredContext();
    if (this.latestState) {
      void this.render(this.latestState);
    }
  }

  private async render(state: TmdState): Promise<void> {
    const tasks = [...state.tasks.filter((task) => task.triggerSource === "chat")].reverse();
    const renderVersion = ++this.renderVersion;
    const shouldStickToBottom = this.shouldStickToBottom();

    const diffsByTask = new Map<string, ResolvedArtifactDiff[]>();
    const artifactTasks = tasks.filter((task) => task.artifacts.length > 0);
    await Promise.all(
      artifactTasks.map(async (task) => {
        const signature = this.buildArtifactResolutionSignature(task);
        const cached = this.resolvedArtifactsCache.get(task.id);
        if (cached?.signature === signature) {
          diffsByTask.set(task.id, cached.diffs);
          return;
        }
        const diffs = await resolveArtifactDiffs(task);
        this.resolvedArtifactsCache.set(task.id, { signature, diffs });
        diffsByTask.set(task.id, diffs);
      })
    );

    if (renderVersion !== this.renderVersion) {
      return;
    }

    const latestTask = state.tasks.find((task) => task.triggerSource === "chat");
    const context =
      this.liveContext ??
      latestTask?.context ??
      state.tasks.find((task) => task.context?.filePath)?.context ??
      null;

    this.syncContext(context);
    const hasRunningTask = state.tasks.some((task) => task.status === "running");
    this.stopButtonEl.disabled = !hasRunningTask;
    this.resetButtonEl.disabled = hasRunningTask || tasks.length === 0;

    if (tasks.length === 0) {
      this.syncEmptyState(true);
      this.pruneTaskPairs([]);
      return;
    }

    this.syncEmptyState(false);
    this.syncTaskPairs(tasks, diffsByTask);

    this.pruneResolvedArtifactCache(tasks);
    if (shouldStickToBottom) {
      this.timelineEl.scrollTop = this.timelineEl.scrollHeight;
    }
  }

  private syncContext(context: ContextSnapshot | null): void {
    if (!this.contextNodes) {
      return;
    }

    const summary = summarizeContext(context);
    if (this.contextNodes.valueEl.dataset.value !== summary) {
      this.contextNodes.valueEl.dataset.value = summary;
      this.contextNodes.valueEl.setText(summary);
    }

    const snippet = context?.selection?.text?.trim().slice(0, 2000) ?? "";
    const existingSnippetEl = this.contextNodes.snippetEl;
    if (!snippet) {
      existingSnippetEl?.remove();
      this.contextNodes.snippetEl = null;
      return;
    }

    const snippetEl =
      existingSnippetEl ??
      this.contextEl.createDiv({
        cls: "tmd-chat-context-snippet"
      });
    if (snippetEl.dataset.value !== snippet) {
      snippetEl.dataset.value = snippet;
      snippetEl.setText(snippet);
    }
    this.contextNodes.snippetEl = snippetEl;
  }

  private syncEmptyState(isEmpty: boolean): void {
    if (!isEmpty) {
      this.emptyStateEl?.remove();
      this.emptyStateEl = null;
      return;
    }

    this.pruneTaskPairs([]);
    if (this.emptyStateEl) {
      return;
    }

    const empty = this.timelineEl.createDiv({ cls: "tmd-empty tmd-chat-empty" });
    empty.createEl("p", { text: "No messages yet." });
    empty.createEl("p", {
      cls: "tmd-meta",
      text: "Use the current note as context and start chatting with Ante."
    });
    this.emptyStateEl = empty;
  }

  private syncTaskPairs(
    tasks: TaskRecord[],
    diffsByTask: Map<string, ResolvedArtifactDiff[]>
  ): void {
    this.lastRenderedTasks = tasks;
    let previousEl: HTMLElement | null = null;
    for (const task of tasks) {
      const pair = this.syncTaskPair(task, diffsByTask.get(task.id) ?? []);
      for (const element of [pair.userEl, pair.assistantEl]) {
        const anchor: ChildNode | null = previousEl
          ? previousEl.nextSibling
          : this.timelineEl.firstChild;
        if (element !== anchor) {
          this.timelineEl.insertBefore(element, anchor);
        }
        previousEl = element;
      }
    }

    this.pruneTaskPairs(tasks);
  }

  private syncTaskPair(task: TaskRecord, resolvedArtifacts: ResolvedArtifactDiff[]): ChatTaskPairElements {
    let pair = this.taskPairEls.get(task.id);
    if (!pair) {
      pair = {
        userEl: this.createMessageElement("user"),
        assistantEl: this.createMessageElement("assistant")
      };
      this.taskPairEls.set(task.id, pair);
    }

    this.syncUserMessage(pair.userEl, task);
    this.syncAssistantMessage(pair.assistantEl, task, resolvedArtifacts);
    return pair;
  }

  private pruneTaskPairs(tasks: TaskRecord[]): void {
    const activeTaskIds = new Set(tasks.map((task) => task.id));
    this.lastRenderedTasks = this.lastRenderedTasks.filter((task) => activeTaskIds.has(task.id));
    for (const [taskId, pair] of Array.from(this.taskPairEls.entries())) {
      if (activeTaskIds.has(taskId)) {
        continue;
      }
      pair.userEl.remove();
      pair.assistantEl.remove();
      this.taskPairEls.delete(taskId);
    }
  }

  private createMessageElement(kind: "user" | "assistant"): HTMLDivElement {
    const rootEl = createDiv({
      cls: `tmd-chat-message ${kind === "user" ? "tmd-is-user" : "tmd-is-assistant"}`
    });
    const bubbleEl = rootEl.createDiv({ cls: "tmd-chat-bubble" });
    const metaEl = bubbleEl.createDiv({ cls: "tmd-chat-meta" });
    const roleEl = metaEl.createDiv({ cls: "tmd-chat-role" });
    const stampEl = metaEl.createDiv({ cls: "tmd-chat-stamp" });
    this.messageEls.set(rootEl, {
      rootEl,
      bubbleEl,
      roleEl,
      stampEl,
      textEl: null,
      textSignature: null,
      loadingEl: null,
      loadingSignature: null,
      processEl: null,
      processSignature: null,
      artifactsHostEl: null,
      artifactsSignature: null,
      approvalHostEl: null,
      approvalSignature: null,
      errorEl: null
    });
    return rootEl;
  }

  private syncUserMessage(messageEl: HTMLDivElement, task: TaskRecord): void {
    const elements = this.getMessageElements(messageEl);
    this.setTextIfChanged(elements.roleEl, "You");
    this.setTextIfChanged(elements.stampEl, formatTime(task.startedAt));
    const text = task.inlineInstruction || "(empty prompt)";
    this.syncMessageText(elements, text, `user:${text}`);
  }

  private syncAssistantMessage(
    messageEl: HTMLDivElement,
    task: TaskRecord,
    resolvedArtifacts: ResolvedArtifactDiff[]
  ): void {
    const elements = this.getMessageElements(messageEl);
    this.setTextIfChanged(elements.roleEl, task.status === "running" ? "Ante is thinking" : "Ante");
    this.setTextIfChanged(elements.stampEl, formatTime(task.endedAt ?? task.startedAt));
    const text = task.status === "running" ? this.getStreamingPreview(task) : this.getAnalyzedOutput(task);
    if (text) {
      this.syncMessageText(elements, text, `${task.status}:${text}`);
      this.removeLoading(elements);
    } else if (task.status === "running") {
      this.removeText(elements);
      this.syncLoading(elements, loadingLabelForTask(task, this.loadingFrame));
    } else {
      this.removeText(elements);
      this.removeLoading(elements);
    }

    if (task.status === "running") {
      const processLines = buildProcessStatusLines(task);
      this.syncProcessLines(elements, processLines);
    } else {
      this.removeProcess(elements);
    }

    if (resolvedArtifacts.length > 0) {
      this.syncArtifacts(elements, task, resolvedArtifacts);
    } else {
      this.removeArtifacts(elements);
    }

    if (task.pendingApproval) {
      this.syncApproval(elements, task);
    } else {
      this.removeApproval(elements);
    }

    if (task.error) {
      this.syncError(elements, task.error);
    } else {
      this.removeError(elements);
    }
  }

  private syncMessageText(elements: ChatMessageElements, text: string, signature: string): void {
    if (elements.textEl && elements.textSignature === signature) {
      return;
    }
    const textEl =
      elements.textEl ??
      elements.bubbleEl.createEl("pre", { cls: "tmd-chat-text tmd-chat-pre" });
    this.setTextIfChanged(textEl, text);
    elements.textEl = textEl;
    elements.textSignature = signature;
  }

  private removeText(elements: ChatMessageElements): void {
    elements.textEl?.remove();
    elements.textEl = null;
    elements.textSignature = null;
  }

  private syncLoading(elements: ChatMessageElements, text: string): void {
    if (elements.loadingEl && elements.loadingSignature === text) {
      return;
    }
    const loadingEl =
      elements.loadingEl ??
      elements.bubbleEl.createDiv({ cls: "tmd-chat-loading" });
    this.setTextIfChanged(loadingEl, text);
    elements.loadingEl = loadingEl;
    elements.loadingSignature = text;
  }

  private removeLoading(elements: ChatMessageElements): void {
    elements.loadingEl?.remove();
    elements.loadingEl = null;
    elements.loadingSignature = null;
  }

  private syncProcessLines(elements: ChatMessageElements, lines: string[]): void {
    if (lines.length === 0) {
      this.removeProcess(elements);
      return;
    }

    const signature = lines.join("\n");
    if (elements.processEl && elements.processSignature === signature) {
      return;
    }

    const processEl =
      elements.processEl ??
      elements.bubbleEl.createDiv({ cls: "tmd-chat-process" });
    const nextKeys = new Set(lines.map((_, index) => String(index)));
    const existing = new Map<string, HTMLDivElement>();
    Array.from(processEl.children).forEach((child, index) => {
      if (child instanceof HTMLDivElement) {
        existing.set(String(index), child);
      }
    });

    for (const [key, lineEl] of existing.entries()) {
      if (!nextKeys.has(key)) {
        lineEl.remove();
      }
    }

    let previousEl: HTMLElement | null = null;
    for (const [index, line] of lines.entries()) {
      const key = String(index);
      let lineEl = existing.get(key);
      if (!lineEl) {
        lineEl = processEl.createDiv({ cls: "tmd-chat-process-line" });
      }
      this.setTextIfChanged(lineEl, line);
      const anchor: ChildNode | null = previousEl ? previousEl.nextSibling : processEl.firstChild;
      processEl.insertBefore(lineEl, anchor);
      previousEl = lineEl;
    }

    elements.processEl = processEl;
    elements.processSignature = signature;
  }

  private removeProcess(elements: ChatMessageElements): void {
    elements.processEl?.remove();
    elements.processEl = null;
    elements.processSignature = null;
  }

  private syncArtifacts(
    elements: ChatMessageElements,
    task: TaskRecord,
    resolvedArtifacts: ResolvedArtifactDiff[]
  ): void {
    const signature = this.buildArtifactsSignature(task, resolvedArtifacts);
    if (elements.artifactsHostEl && elements.artifactsSignature === signature) {
      return;
    }

    const host =
      elements.artifactsHostEl ??
      elements.bubbleEl.createDiv({ cls: "tmd-chat-artifacts-host" });
    host.empty();
    this.renderArtifacts(host, task, resolvedArtifacts);
    elements.artifactsHostEl = host;
    elements.artifactsSignature = signature;
  }

  private removeArtifacts(elements: ChatMessageElements): void {
    elements.artifactsHostEl?.remove();
    elements.artifactsHostEl = null;
    elements.artifactsSignature = null;
  }

  private renderArtifacts(container: HTMLElement, task: TaskRecord, resolvedArtifacts: ResolvedArtifactDiff[]): void {
    this.ensureExpandedArtifacts(task);
    const diffList = renderDiffSummary(container, resolvedArtifacts, {
      actionLabel: "Apply all",
      isActionDisabled: resolvedArtifacts.every(
        ({ artifact }) => artifact.applyState === "applied" || artifact.applyState === "discarded"
      ),
      onAction: () => {
        void this.plugin.taskEngine.applyAllArtifacts(task.id).catch((error) => {
          new Notice(error instanceof Error ? error.message : "Failed to apply all changes");
        });
      }
    });

    for (const resolvedArtifact of resolvedArtifacts) {
      const { artifact } = resolvedArtifact;
      renderArtifactDiff(diffList, this.plugin, task, resolvedArtifact, this.expandedArtifactIds, () => {
        if (this.expandedArtifactIds.has(artifact.id)) {
          this.expandedArtifactIds.delete(artifact.id);
        } else {
          this.expandedArtifactIds.add(artifact.id);
        }
        if (this.latestState) {
          void this.render(this.latestState);
        }
      });
    }

    const openResults = container.createEl("button", {
      cls: "tmd-chat-secondary-action",
      text: "Open Tmd Results"
    });
    openResults.addEventListener("click", () => {
      void this.plugin.openResultsView();
    });
  }

  private ensureExpandedArtifacts(task: TaskRecord): void {
    const artifactIds = new Set(task.artifacts.map((artifact) => artifact.id));
    for (const expandedId of Array.from(this.expandedArtifactIds)) {
      if (!artifactIds.has(expandedId)) {
        this.expandedArtifactIds.delete(expandedId);
      }
    }

    if (this.expandedStateTaskId !== task.id) {
      this.expandedStateTaskId = task.id;
      this.expandedArtifactIds.clear();
      const firstArtifactId = task.artifacts[0]?.id;
      if (firstArtifactId) {
        this.expandedArtifactIds.add(firstArtifactId);
      }
    }
  }

  private syncApproval(elements: ChatMessageElements, task: TaskRecord): void {
    const approval = task.pendingApproval;
    if (!approval) {
      this.removeApproval(elements);
      return;
    }

    const signature = [
      approval.turnId,
      approval.message,
      ...approval.tools.map((tool) => `${tool.id}:${tool.name}:${tool.argsText ?? ""}`)
    ].join("|");
    if (elements.approvalHostEl && elements.approvalSignature === signature) {
      return;
    }

    const host =
      elements.approvalHostEl ??
      elements.bubbleEl.createDiv({ cls: "tmd-chat-approval-host" });
    host.empty();
    this.renderApproval(host, task);
    elements.approvalHostEl = host;
    elements.approvalSignature = signature;
  }

  private removeApproval(elements: ChatMessageElements): void {
    elements.approvalHostEl?.remove();
    elements.approvalHostEl = null;
    elements.approvalSignature = null;
  }

  private renderApproval(container: HTMLElement, task: TaskRecord): void {
    const approval = task.pendingApproval;
    if (!approval) {
      return;
    }

    const approvalCard = container.createDiv({ cls: "tmd-terminal-approval" });
    approvalCard.createDiv({
      cls: "tmd-terminal-approval-title",
      text: "Tool approval required"
    });
    approvalCard.createDiv({
      cls: "tmd-terminal-approval-message",
      text: approval.message
    });

    for (const tool of approval.tools) {
      const toolRow = approvalCard.createDiv({ cls: "tmd-terminal-approval-tool" });
      toolRow.createDiv({
        cls: "tmd-terminal-approval-tool-name",
        text: `${tool.name} · ${tool.id}`
      });
      if (tool.argsText) {
        toolRow.createDiv({
          cls: "tmd-terminal-approval-tool-args",
          text: tool.argsText
        });
      }
    }

    const actionRow = approvalCard.createDiv({
      cls: "tmd-terminal-approval-actions"
    });
    this.renderApprovalAction(actionRow, task.id, "Approve once", "Accept", "tmd-is-approve");
    this.renderApprovalAction(actionRow, task.id, "Allow session", "AcceptForSession", "tmd-is-approve-session");
    this.renderApprovalAction(actionRow, task.id, "Deny", "Skip", "tmd-is-deny");
  }

  private syncError(elements: ChatMessageElements, error: string): void {
    const errorEl =
      elements.errorEl ??
      elements.bubbleEl.createDiv({ cls: "tmd-error" });
    this.setTextIfChanged(errorEl, error);
    elements.errorEl = errorEl;
  }

  private removeError(elements: ChatMessageElements): void {
    elements.errorEl?.remove();
    elements.errorEl = null;
  }

  private getMessageElements(messageEl: HTMLDivElement): ChatMessageElements {
    const elements = this.messageEls.get(messageEl);
    if (!elements) {
      throw new Error("Missing chat message elements");
    }
    return elements;
  }

  private setTextIfChanged(el: HTMLElement, text: string): void {
    if (el.dataset.value === text) {
      return;
    }
    el.dataset.value = text;
    el.setText(text);
  }

  private buildArtifactResolutionSignature(task: TaskRecord): string {
    return [
      task.id,
      ...task.artifacts.map((artifact) =>
        [
          artifact.id,
          artifact.applyState,
          artifact.applyError ?? "",
          hashText(artifact.beforeText),
          hashText(artifact.afterText)
        ].join(":")
      )
    ].join("|");
  }

  private buildArtifactsSignature(task: TaskRecord, resolvedArtifacts: ResolvedArtifactDiff[]): string {
    return [
      task.id,
      this.expandedStateTaskId === task.id ? "active" : "inactive",
      ...resolvedArtifacts.map(({ artifact, hunks, stats }) =>
        [
          artifact.id,
          artifact.applyState,
          artifact.applyError ?? "",
          this.expandedArtifactIds.has(artifact.id) ? "expanded" : "collapsed",
          stats.additions,
          stats.removals,
          hunks.length
        ].join(":")
      )
    ].join("|");
  }

  private getAnalyzedOutput(task: TaskRecord): string {
    const signature = [
      task.textResult?.text ?? "",
      task.stdoutText,
      task.status,
      task.artifacts.length
    ].join("|");
    const cached = this.outputPreviewCache.get(task.id);
    if (cached?.signature === signature) {
      return cached.text;
    }
    const text = analyzeOutput(task);
    this.outputPreviewCache.set(task.id, { signature, text });
    return text;
  }

  private getStreamingPreview(task: TaskRecord): string {
    const signature = `${task.status}:${task.stdoutText}`;
    const cached = this.streamingPreviewCache.get(task.id);
    if (cached?.signature === signature) {
      return cached.text;
    }
    const text = buildStreamingPreview(task);
    this.streamingPreviewCache.set(task.id, { signature, text });
    return text;
  }

  private renderApprovalAction(
    container: HTMLElement,
    taskId: string,
    label: string,
    decision: RuntimeApprovalDecision,
    cls: string
  ): void {
    const button = container.createEl("button", {
      cls: `tmd-terminal-approval-button ${cls}`,
      text: label
    });
    button.addEventListener("click", () => {
      try {
        this.plugin.taskEngine.respondToTaskApproval(taskId, decision);
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "Failed to send Ante approval");
      }
    });
  }

  private runPrompt(): void {
    const prompt = this.composerEl.value.trim();
    if (!prompt) {
      return;
    }

    const latestConsoleSession = (this.latestState ?? this.plugin.taskEngine.getState()).tasks.find(
      (task) => task.triggerSource === "chat" && task.runtimeSession?.sessionId
    )?.runtimeSession;

    void this.plugin.hostAdapter
      .capturePreferredContext()
      .then((contextSnapshot) => {
        this.liveContext = contextSnapshot;
        return this.plugin.taskEngine.startChatTask(prompt, Boolean(latestConsoleSession), contextSnapshot);
      })
      .then(() => {
        this.composerEl.value = "";
      })
      .catch((error) => {
        new Notice(error instanceof Error ? error.message : "Failed to start Ante chat");
      });
  }

  private syncLoadingTimer(state: TmdState): void {
    const chatTasks = state.tasks.filter((task) => task.triggerSource === "chat");
    const shouldAnimate = chatTasks
      .filter((task) => task.status === "running")
      .some((task) => !buildStreamingPreview(task) && !task.pendingApproval);

    if (shouldAnimate && this.loadingTimer == null) {
      this.loadingTimer = window.setInterval(() => {
        this.loadingFrame = (this.loadingFrame + 1) % 4;
        this.refreshLoadingIndicators();
      }, 500);
      return;
    }

    if (!shouldAnimate && this.loadingTimer != null) {
      window.clearInterval(this.loadingTimer);
      this.loadingTimer = null;
      this.loadingFrame = 0;
    }
  }

  private refreshLoadingIndicators(): void {
    for (const task of this.lastRenderedTasks) {
      if (task.status !== "running") {
        continue;
      }
      const pair = this.taskPairEls.get(task.id);
      if (!pair) {
        continue;
      }
      const elements = this.getMessageElements(pair.assistantEl);
      const hasStreamingPreview = Boolean(this.getStreamingPreview(task));
      if (hasStreamingPreview || task.pendingApproval) {
        this.removeLoading(elements);
        continue;
      }
      this.syncLoading(elements, loadingLabelForTask(task, this.loadingFrame));
    }
  }

  private resetChatHistory(): void {
    const hasRunningTask = (this.latestState ?? this.plugin.taskEngine.getState()).tasks.some(
      (task) => task.triggerSource === "chat" && task.status === "running"
    );
    if (hasRunningTask) {
      new Notice("Stop the active chat task before resetting the conversation");
      return;
    }

    this.plugin.taskEngine.clearTasksByTriggerSource("chat");
    this.expandedArtifactIds.clear();
    this.expandedStateTaskId = null;
  }

  private shouldStickToBottom(): boolean {
    const threshold = 24;
    return (
      this.timelineEl.scrollTop + this.timelineEl.clientHeight >=
      this.timelineEl.scrollHeight - threshold
    );
  }

  private pruneResolvedArtifactCache(tasks: TaskRecord[]): void {
    const activeTaskIds = new Set(tasks.map((task) => task.id));
    for (const taskId of Array.from(this.resolvedArtifactsCache.keys())) {
      if (!activeTaskIds.has(taskId)) {
        this.resolvedArtifactsCache.delete(taskId);
      }
    }
    for (const taskId of Array.from(this.outputPreviewCache.keys())) {
      if (!activeTaskIds.has(taskId)) {
        this.outputPreviewCache.delete(taskId);
      }
    }
    for (const taskId of Array.from(this.streamingPreviewCache.keys())) {
      if (!activeTaskIds.has(taskId)) {
        this.streamingPreviewCache.delete(taskId);
      }
    }
  }
}
