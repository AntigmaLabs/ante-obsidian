import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type TmdPlugin from "./main";
import type { ContextSnapshot, TaskRecord, TmdState } from "../core/types";

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
      return "is-running";
    case "failed":
      return "is-failed";
    case "discarded":
      return "is-muted";
    default:
      return "is-completed";
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

const aggregateOutput = (task: TaskRecord): string => {
  const primaryText = task.textResult?.text.trim()
    ? task.textResult.text.trim()
    : task.logs
        .filter((log) => log.stream === "stdout")
        .map((log) => log.text)
        .join("")
        .trim();

  if (!primaryText) {
    return "";
  }

  const parsed = parseJsonPayload(primaryText);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if ((record.type === "text" || record.type === "terminal") && typeof record.text === "string") {
      return record.text.trim();
    }
    if (record.type === "change") {
      const summary = typeof record.summary === "string" ? record.summary.trim() : "";
      const title = typeof record.title === "string" ? record.title.trim() : "";
      return summary || title;
    }
  }

  return primaryText;
};

const buildRows = (task: TaskRecord): TerminalRow[] => {
  const rows: TerminalRow[] = [];
  rows.push({
    kind: "command",
    text: task.inlineInstruction || "(empty prompt)",
    timestamp: task.startedAt
  });

  for (const log of task.logs) {
    if (log.stream === "stdout") {
      continue;
    }
    rows.push({
      kind: log.stream === "stderr" ? "error" : "system",
      text: log.text,
      timestamp: log.timestamp
    });
  }

  const output = aggregateOutput(task);
  if (output) {
    rows.push({
      kind: "output",
      text: output,
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

  if (task.status === "running" && !output) {
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

    const frame = contentEl.createDiv({ cls: "tmd-terminal-frame" });
    const chrome = frame.createDiv({ cls: "tmd-terminal-chrome" });
    chrome.createDiv({ cls: "tmd-terminal-chrome-title", text: "ante terminal" });
    chrome.createDiv({
      cls: `tmd-terminal-status ${terminalStatusClass(latestTask)}`,
      text: terminalStatus(latestTask)
    });

    const meta = frame.createDiv({ cls: "tmd-terminal-meta" });
    meta.createDiv({ cls: "tmd-terminal-meta-line", text: summarizeContext(context) });
    meta.createDiv({
      cls: "tmd-terminal-meta-line",
      text: latestTerminalSession?.sessionId ? `session ${latestTerminalSession.sessionId}` : "session new"
    });

    const screen = frame.createDiv({ cls: "tmd-terminal-screen" });
    if (tasks.length === 0) {
      const empty = screen.createDiv({ cls: "tmd-terminal-row is-system" });
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

    const promptBar = frame.createDiv({ cls: "tmd-terminal-promptbar" });
    const prompt = promptBar.createDiv({ cls: "tmd-terminal-promptline" });
    prompt.createDiv({ cls: "tmd-terminal-shell-sign", text: "$" });
    const editor = prompt.createDiv({ cls: "tmd-terminal-shell-editor is-empty" });
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
        .then(() => {
          editor.empty();
          editor.classList.add("is-empty");
        })
        .catch((error) => {
          new Notice(error instanceof Error ? error.message : "Failed to start Ante terminal task");
        });
    };

    editor.addEventListener("input", () => {
      editor.classList.toggle("is-empty", editor.innerText.trim().length === 0);
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
    const shouldAnimate = state.tasks
      .filter((task) => task.triggerSource === "terminal")
      .some((task) => task.status === "running" && !aggregateOutput(task));

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
    const rowEl = container.createDiv({ cls: `tmd-terminal-row is-${row.kind}` });
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
