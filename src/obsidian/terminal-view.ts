import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type TmdPlugin from "./main";
import type { ContextSnapshot, RuntimeApprovalDecision, TaskRecord, TmdState } from "../core/types";

export const TMD_TERMINAL_VIEW_TYPE = "tmd-terminal-view";

type TerminalRow =
  | { kind: "command"; text: string; timestamp: string }
  | { kind: "output"; text: string; timestamp: string }
  | { kind: "system"; text: string; timestamp: string }
  | { kind: "error"; text: string; timestamp: string }
  | { kind: "artifact"; text: string; timestamp: string }
  | { kind: "loading"; text: string; timestamp: string };

const formatTime = (timestamp: string): string =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

const terminalStatus = (task: TaskRecord | undefined): string => {
  if (!task) {
    return "idle";
  }
  if (task.status === "applied") {
    return "completed";
  }
  return task.status;
};

const terminalStatusClass = (task: TaskRecord | undefined): string => {
  const status = terminalStatus(task);
  switch (status) {
    case "running":
      return "tmd-is-running";
    case "failed":
      return "tmd-is-failed";
    case "discarded":
      return "tmd-is-muted";
    default:
      return "tmd-is-completed";
  }
};

const summarizeContext = (context: ContextSnapshot | null | undefined): string => {
  if (!context?.filePath) {
    return "No Markdown context";
  }

  const selection = context.selection?.text?.trim();
  if (selection) {
    return `${context.filePath} · selection ${selection.length} chars`;
  }

  const documentText = context.documentText?.trim() ?? "";
  return `${context.filePath} · note ${documentText.length} chars`;
};

const NOISY_SYSTEM_PATTERNS = [
  /^Launching Ante server\b/,
  /^Reusing existing Ante session\b/,
  /^Ante TurnStart\b/,
  /^Ante ToolStart\b/,
  /^Ante ToolEnd\b/,
  /^Ante ToolUpdate\b/
];

const shouldDisplaySystemLog = (text: string): boolean => !NOISY_SYSTEM_PATTERNS.some((pattern) => pattern.test(text));

const extractRuntimeSummary = (task: TaskRecord | undefined): { provider: string; model: string } | null => {
  if (!task) {
    return null;
  }
  for (const log of task.logs) {
    const match =
      /provider=([^\s·]+)\s+·\s+model=([^\s·]+)/.exec(log.text) ??
      /provider=([^\s·]+)\s+·\s+model=([^\s·]+)/.exec(log.text.replace(/\n/g, " "));
    if (match?.[1] && match?.[2]) {
      return {
        provider: match[1],
        model: match[2]
      };
    }
  }
  return null;
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

const analyzeOutput = (task: TaskRecord): { text: string; suppressStdout: boolean } => {
  const primaryText = task.textResult?.text.trim()
    ? task.textResult.text.trim()
    : task.logs
        .filter((log) => log.stream === "stdout")
        .map((log) => log.text)
        .join("")
        .trim();

  if (!primaryText) {
    return { text: "", suppressStdout: false };
  }

  const parsed = parseJsonPayload(primaryText);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if ((record.type === "text" || record.type === "terminal") && typeof record.text === "string") {
      return { text: record.text.trim(), suppressStdout: Boolean(task.textResult?.text.trim()) };
    }
    if (record.type === "change") {
      const summary = typeof record.summary === "string" ? record.summary.trim() : "";
      const title = typeof record.title === "string" ? record.title.trim() : "";
      return { text: summary || title, suppressStdout: true };
    }
  }

  return { text: primaryText, suppressStdout: Boolean(task.textResult?.text.trim()) };
};

const buildRows = (task: TaskRecord): TerminalRow[] => {
  const rows: TerminalRow[] = [];
  rows.push({
    kind: "command",
    text: task.inlineInstruction || "(empty prompt)",
    timestamp: task.startedAt
  });

  const hasStructuredOutput = Boolean(task.textResult?.text.trim());
  const stdoutLogs = task.logs.filter((log) => log.stream === "stdout" && log.text.trim());
  const output = analyzeOutput(task);

  for (const log of task.logs) {
    if (log.stream === "stdout") {
      if (!output.suppressStdout) {
        rows.push({
          kind: "output",
          text: log.text,
          timestamp: log.timestamp
        });
      }
      continue;
    }
    if (log.stream === "system" && !shouldDisplaySystemLog(log.text)) {
      continue;
    }
    rows.push({
      kind: log.stream === "stderr" ? "error" : "system",
      text: log.text,
      timestamp: log.timestamp
    });
  }

  if (output.text && (output.suppressStdout || hasStructuredOutput || stdoutLogs.length === 0)) {
    rows.push({
      kind: "output",
      text: output.text,
      timestamp: task.endedAt ?? task.startedAt
    });
  }

  if (task.artifacts.length > 0) {
    rows.push({
      kind: "artifact",
      text: `${task.artifacts.length} change artifact(s) ready. Open Tmd Results to inspect diff or revert.`,
      timestamp: task.endedAt ?? task.startedAt
    });
  }

  if (task.error) {
    rows.push({
      kind: "error",
      text: task.error,
      timestamp: task.endedAt ?? task.startedAt
    });
  }

  if (task.status === "running" && !output.text && !task.pendingApproval) {
    rows.push({
      kind: "loading",
      text: "*",
      timestamp: new Date().toISOString()
    });
  }

  return rows;
};

export class TmdTerminalView extends ItemView {
  private unsubscribe: (() => void) | null = null;
  private loadingTimer: number | null = null;
  private loadingFrame = 0;
  private latestState: TmdState | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TmdPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return TMD_TERMINAL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Ante Terminal";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("tmd-view", "tmd-terminal-view");
    await this.plugin.hostAdapter.capturePreferredContext();
    this.unsubscribe = this.plugin.taskEngine.subscribe((state) => {
      this.latestState = state;
      this.syncLoadingTimer(state);
      this.render(state);
    });
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.loadingTimer) {
      window.clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }
  }

  private render(state: TmdState): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Ante Terminal" });

    const tasks = state.tasks.filter((task) => task.triggerSource === "terminal");
    const latestTask = tasks[0];
    const latestTerminalSession = tasks.find((task) => task.runtimeSession?.sessionId)?.runtimeSession;
    const context = latestTask?.context ?? state.tasks.find((task) => task.context?.filePath)?.context ?? null;
    const runtimeSummary = extractRuntimeSummary(latestTask);
    const approval = latestTask?.pendingApproval;

    const frame = contentEl.createDiv({ cls: "tmd-terminal-frame" });
    const chrome = frame.createDiv({ cls: "tmd-terminal-chrome" });
    chrome.createDiv({ cls: "tmd-terminal-chrome-title", text: "ante terminal" });
    const chromeActions = chrome.createDiv({ cls: "tmd-terminal-chrome-actions" });
    const stopButton = chromeActions.createEl("button", {
      cls: "tmd-terminal-stop-button"
    });
    stopButton.setAttr("aria-label", "Stop active Ante task");
    stopButton.createSpan({ cls: "tmd-terminal-stop-icon", text: "■" });
    stopButton.createSpan({ cls: "tmd-terminal-stop-label", text: "Stop" });
    stopButton.disabled = !state.tasks.some((task) => task.status === "running");
    stopButton.addEventListener("click", () => this.plugin.taskEngine.cancelActiveTask());
    chromeActions.createDiv({
      cls: `tmd-terminal-status ${terminalStatusClass(latestTask)}`,
      text: terminalStatus(latestTask)
    });

    const meta = frame.createDiv({ cls: "tmd-terminal-meta" });
    meta.createDiv({ cls: "tmd-terminal-meta-line", text: summarizeContext(context) });
    if (runtimeSummary) {
      meta.createDiv({
        cls: "tmd-terminal-meta-line",
        text: `${runtimeSummary.provider} · ${runtimeSummary.model}`
      });
    }
    meta.createDiv({
      cls: "tmd-terminal-meta-line",
      text: latestTerminalSession?.sessionId ? `session ${latestTerminalSession.sessionId}` : "session new"
    });

    const screen = frame.createDiv({ cls: "tmd-terminal-screen" });
    if (tasks.length === 0) {
      const empty = screen.createDiv({ cls: "tmd-terminal-row tmd-is-system" });
      empty.createDiv({ cls: "tmd-terminal-row-time", text: formatTime(new Date().toISOString()) });
      empty.createDiv({ cls: "tmd-terminal-row-prefix", text: "sys" });
      empty.createDiv({ cls: "tmd-terminal-row-text", text: "Ready. Open a Markdown note and enter a prompt below." });
    } else {
      for (const task of [...tasks].reverse()) {
        for (const row of this.buildRows(task)) {
          this.renderRow(screen, row);
        }
      }
    }

    if (latestTask?.status === "running" && approval) {
      const approvalCard = frame.createDiv({ cls: "tmd-terminal-approval" });
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

      const actionRow = approvalCard.createDiv({ cls: "tmd-terminal-approval-actions" });
      const renderAction = (label: string, decision: RuntimeApprovalDecision, cls: string) => {
        const button = actionRow.createEl("button", {
          cls: `tmd-terminal-approval-button ${cls}`,
          text: label
        });
        button.addEventListener("click", () => {
          try {
            this.plugin.taskEngine.respondToTaskApproval(latestTask.id, decision);
          } catch (error) {
            new Notice(error instanceof Error ? error.message : "Failed to send Ante approval");
          }
        });
      };

      renderAction("Approve once", "Accept", "tmd-is-approve");
      renderAction("Allow session", "AcceptForSession", "tmd-is-approve-session");
      renderAction("Deny", "Skip", "tmd-is-deny");
    }

    const promptBar = frame.createDiv({ cls: "tmd-terminal-promptbar" });
    const prompt = promptBar.createDiv({ cls: "tmd-terminal-promptline" });
    prompt.createDiv({ cls: "tmd-terminal-shell-sign", text: "$" });
    const editor = prompt.createDiv({ cls: "tmd-terminal-shell-editor tmd-is-empty" });
    editor.contentEditable = state.tasks.some((task) => task.status === "running") ? "false" : "true";
    editor.dataset.placeholder = context?.filePath ? `Ask Ante about ${context.filePath}` : "Ask Ante";
    editor.setAttr("role", "textbox");
    editor.setAttr("aria-label", "Ante terminal prompt");

    const runPrompt = () => {
      const promptText = editor.innerText.replace(/\n/g, " ").trim();
      if (!promptText) {
        return;
      }
      void this.plugin.hostAdapter
        .capturePreferredContext()
        .then(() => this.plugin.taskEngine.startTerminalTask(promptText, Boolean(latestTerminalSession)))
        .then((taskId) => {
          this.plugin.watchTaskForResults(taskId, "Terminal");
          editor.empty();
          editor.classList.add("tmd-is-empty");
        })
        .catch((error) => {
          new Notice(error instanceof Error ? error.message : "Failed to start Ante terminal task");
        });
    };

    editor.addEventListener("input", () => {
      editor.classList.toggle("tmd-is-empty", editor.innerText.trim().length === 0);
    });

    editor.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runPrompt();
      }
    });

    window.requestAnimationFrame(() => {
      screen.scrollTop = screen.scrollHeight;
      if (editor.contentEditable === "true") {
        editor.focus();
      }
    });
  }

  private buildRows(task: TaskRecord): TerminalRow[] {
    return buildRows(task).map((row) =>
      row.kind === "loading"
        ? {
            ...row,
            text: ["*", "**", "***"][this.loadingFrame]
          }
        : row
    );
  }

  private syncLoadingTimer(state: TmdState): void {
    const terminalTasks = state.tasks.filter((task) => task.triggerSource === "terminal");
    const blockingTasks = terminalTasks
      .filter((task) => task.status === "running")
      .map((task) => ({
        id: task.id,
        status: task.status,
        hasTextResult: Boolean(task.textResult?.text.trim()),
        stdoutCount: task.logs.filter((log) => log.stream === "stdout" && log.text.trim()).length,
        aggregateOutput: analyzeOutput(task).text,
        pendingApproval: Boolean(task.pendingApproval),
        error: task.error,
        startedAt: task.startedAt,
        runtimeSessionId: task.runtimeSession?.sessionId
      }))
      .filter((task) => !task.aggregateOutput && !task.pendingApproval);
    const shouldAnimate = blockingTasks.length > 0;

    if (shouldAnimate && this.loadingTimer == null) {
      this.loadingTimer = window.setInterval(() => {
        this.loadingFrame = (this.loadingFrame + 1) % 3;
        if (this.latestState) {
          this.render(this.latestState);
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

  private renderRow(container: HTMLElement, row: TerminalRow): void {
    const rowEl = container.createDiv({ cls: `tmd-terminal-row tmd-is-${row.kind}` });
    rowEl.createDiv({ cls: "tmd-terminal-row-time", text: formatTime(row.timestamp) });
    rowEl.createDiv({ cls: "tmd-terminal-row-prefix", text: this.prefixForRow(row.kind) });
    rowEl.createDiv({ cls: "tmd-terminal-row-text", text: row.text });
  }

  private prefixForRow(kind: TerminalRow["kind"]): string {
    switch (kind) {
      case "command":
        return "$";
      case "output":
        return "out";
      case "error":
        return "err";
      case "artifact":
        return "git";
      case "loading":
        return "";
      default:
        return "sys";
    }
  }
}
