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

export const TMD_CONSOLE_VIEW_TYPE = "tmd-console-view";

const MAX_CHAT_PREVIEW_CHARS = 12000;
const MAX_CHAT_PREVIEW_LINES = 160;

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

export class TmdConsoleView extends ItemView {
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

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TmdPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return TMD_CONSOLE_VIEW_TYPE;
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
    this.stopButtonEl = titleRow.createEl("button", { text: "Stop" });
    this.stopButtonEl.addEventListener("click", () => this.plugin.taskEngine.cancelActiveTask());

    this.contextEl = this.shellEl.createDiv({ cls: "tmd-chat-contextbar" });
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
    const tasks = [...state.tasks.filter((task) => task.triggerSource === "console")].reverse();
    const renderVersion = ++this.renderVersion;
    const shouldStickToBottom = this.shouldStickToBottom();

    const diffsByTask = new Map<string, ResolvedArtifactDiff[]>();
    await Promise.all(
      tasks.map(async (task) => {
        if (task.artifacts.length === 0) {
          return;
        }
        const signature = [
          task.id,
          ...task.artifacts.map(
            (artifact) => `${artifact.id}:${artifact.applyState}:${artifact.applyError ?? ""}`
          )
        ].join("|");
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

    const latestTask = state.tasks.find((task) => task.triggerSource === "console");
    const context =
      this.liveContext ??
      latestTask?.context ??
      state.tasks.find((task) => task.context?.filePath)?.context ??
      null;

    this.contextEl.empty();
    this.contextEl.createDiv({
      cls: "tmd-chat-context-title",
      text: "Current context"
    });
    this.contextEl.createDiv({
      cls: "tmd-chat-context-value",
      text: summarizeContext(context)
    });
    if (context?.selection?.text?.trim()) {
      this.contextEl.createDiv({
        cls: "tmd-chat-context-snippet",
        text: context.selection.text.trim().slice(0, 2000)
      });
    }

    this.stopButtonEl.disabled = !state.tasks.some((task) => task.status === "running");

    this.timelineEl.empty();
    if (tasks.length === 0) {
      const empty = this.timelineEl.createDiv({ cls: "tmd-empty tmd-chat-empty" });
      empty.createEl("p", { text: "No messages yet." });
      empty.createEl("p", {
        cls: "tmd-meta",
        text: "Use the current note as context and start chatting with Ante."
      });
      return;
    }

    for (const task of tasks) {
      this.renderTaskPair(task, diffsByTask.get(task.id) ?? []);
    }

    this.pruneResolvedArtifactCache(tasks);
    if (shouldStickToBottom) {
      this.timelineEl.scrollTop = this.timelineEl.scrollHeight;
    }
  }

  private renderTaskPair(task: TaskRecord, resolvedArtifacts: ResolvedArtifactDiff[]): void {
    this.renderUserMessage(task);
    this.renderAssistantMessage(task, resolvedArtifacts);
  }

  private renderUserMessage(task: TaskRecord): void {
    const message = this.timelineEl.createDiv({ cls: "tmd-chat-message tmd-is-user" });
    const bubble = message.createDiv({ cls: "tmd-chat-bubble" });
    const meta = bubble.createDiv({ cls: "tmd-chat-meta" });
    meta.createDiv({ cls: "tmd-chat-role", text: "You" });
    meta.createDiv({ cls: "tmd-chat-stamp", text: formatTime(task.startedAt) });
    bubble.createEl("p", {
      cls: "tmd-chat-text",
      text: task.inlineInstruction || "(empty prompt)"
    });
  }

  private renderAssistantMessage(task: TaskRecord, resolvedArtifacts: ResolvedArtifactDiff[]): void {
    const message = this.timelineEl.createDiv({ cls: "tmd-chat-message tmd-is-assistant" });
    const bubble = message.createDiv({ cls: "tmd-chat-bubble" });
    const meta = bubble.createDiv({ cls: "tmd-chat-meta" });
    meta.createDiv({
      cls: "tmd-chat-role",
      text: task.status === "running" ? "Ante is thinking" : "Ante"
    });
    meta.createDiv({ cls: "tmd-chat-stamp", text: formatTime(task.endedAt ?? task.startedAt) });

    const text = task.status === "running" ? buildStreamingPreview(task) : analyzeOutput(task);
    if (text) {
      bubble.createEl("pre", { cls: "tmd-chat-text tmd-chat-pre", text });
    } else if (task.status === "running") {
      bubble.createDiv({ cls: "tmd-chat-loading", text: loadingLabelForTask(task, this.loadingFrame) });
    }

    if (task.status === "running") {
      const processLines = buildProcessStatusLines(task);
      if (processLines.length > 0) {
        const processBlock = bubble.createDiv({ cls: "tmd-chat-process" });
        for (const line of processLines) {
          processBlock.createDiv({ cls: "tmd-chat-process-line", text: line });
        }
      }
    }

    if (resolvedArtifacts.length > 0) {
      this.renderArtifacts(bubble, task, resolvedArtifacts);
    }

    if (task.pendingApproval) {
      this.renderApproval(bubble, task);
    }

    if (task.error) {
      bubble.createDiv({ cls: "tmd-error", text: task.error });
    }
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
    }
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
      (task) => task.triggerSource === "console" && task.runtimeSession?.sessionId
    )?.runtimeSession;

    void this.plugin.hostAdapter
      .capturePreferredContext()
      .then((contextSnapshot) => {
        this.liveContext = contextSnapshot;
        return this.plugin.taskEngine.startConsoleTask(prompt, Boolean(latestConsoleSession), contextSnapshot);
      })
      .then(() => {
        this.composerEl.value = "";
      })
      .catch((error) => {
        new Notice(error instanceof Error ? error.message : "Failed to start Ante chat");
      });
  }

  private syncLoadingTimer(state: TmdState): void {
    const consoleTasks = state.tasks.filter((task) => task.triggerSource === "console");
    const shouldAnimate = consoleTasks
      .filter((task) => task.status === "running")
      .some((task) => !buildStreamingPreview(task) && !task.pendingApproval);

    if (shouldAnimate && this.loadingTimer == null) {
      this.loadingTimer = window.setInterval(() => {
        this.loadingFrame = (this.loadingFrame + 1) % 4;
        if (this.latestState) {
          void this.render(this.latestState);
        }
      }, 500);
      return;
    }

    if (!shouldAnimate && this.loadingTimer != null) {
      window.clearInterval(this.loadingTimer);
      this.loadingTimer = null;
      this.loadingFrame = 0;
    }
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
  }
}
