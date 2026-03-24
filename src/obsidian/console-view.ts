import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type TmdPlugin from "./main";
import type { TaskRecord, TmdState } from "../core/types";

export const TMD_CONSOLE_VIEW_TYPE = "tmd-console-view";

export class TmdConsoleView extends ItemView {
  private unsubscribe: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TmdPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return TMD_CONSOLE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Ante Console";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("tmd-view");
    this.unsubscribe = this.plugin.taskEngine.subscribe((state) => {
      this.render(state);
    });
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private render(state: TmdState): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Ante Console" });

    const actions = contentEl.createDiv({ cls: "tmd-actions" });
    const cancelButton = actions.createEl("button", { text: "Cancel Active Task" });
    cancelButton.disabled = !state.tasks.some((task) => task.status === "running");
    cancelButton.addEventListener("click", () => this.plugin.taskEngine.cancelActiveTask());

    const form = contentEl.createDiv({ cls: "tmd-section" });
    form.createEl("h3", { text: "New Prompt" });
    const latestContextTask = state.tasks.find((task) => task.context?.filePath);
    const latestConsoleSession = state.tasks.find(
      (task) => task.triggerSource === "console" && task.runtimeSession?.sessionId
    )?.runtimeSession;
    form.createDiv({
      cls: "tmd-meta",
      text: latestContextTask?.context?.filePath
        ? `Context note: ${latestContextTask.context.filePath}`
        : "Context note: none"
    });
    const input = form.createEl("textarea", { cls: "tmd-console-input" });
    input.placeholder = "Ask Ante anything. Use this for exploration or follow-up tasks.";
    const submit = form.createEl("button", { text: "Send" });
    submit.addEventListener("click", () => {
      const prompt = input.value.trim();
      if (!prompt) {
        return;
      }
      const canFollowUp = Boolean(latestConsoleSession);
      void this.plugin.taskEngine
        .startConsoleTask(prompt, canFollowUp)
        .then(() => {
          input.value = "";
        })
        .catch((error) => {
          new Notice(error instanceof Error ? error.message : "Failed to start Ante console task");
        });
    });

    const tasks = state.tasks.filter((task) => task.triggerSource === "console");
    if (tasks.length === 0) {
      contentEl.createDiv({ cls: "tmd-empty", text: "No console tasks yet." });
      return;
    }

    const history = contentEl.createDiv({ cls: "tmd-section" });
    history.createEl("h3", { text: "History" });
    for (const task of tasks) {
      this.renderTask(history, task);
    }
  }

  private renderTask(container: HTMLElement, task: TaskRecord): void {
    const card = container.createDiv({ cls: "tmd-console-card" });
    card.createDiv({ cls: "tmd-meta", text: `${task.status} · ${new Date(task.startedAt).toLocaleString()}` });
    if (task.inlineInstruction) {
      card.createEl("p", { text: task.inlineInstruction });
    }
    if (task.textResult?.text) {
      card.createEl("pre", { cls: "tmd-text-result", text: task.textResult.text });
    } else if (task.stdoutText.trim()) {
      card.createEl("pre", { cls: "tmd-text-result", text: task.stdoutText.slice(-4000) });
    }
    if (task.artifacts.length > 0) {
      card.createDiv({ cls: "tmd-meta", text: `${task.artifacts.length} change artifact(s) ready in Tmd Results` });
    }
    if (task.logs.length > 0) {
      const logBlock = card.createEl("pre", { cls: "tmd-console-log" });
      for (const log of task.logs.slice(-10)) {
        logBlock.createDiv({ text: `[${log.stream}] ${log.text}` });
      }
    }
    if (task.error) {
      card.createDiv({ cls: "tmd-error", text: task.error });
    }
  }
}
