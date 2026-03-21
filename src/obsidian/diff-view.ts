import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type TmdPlugin from "./main";
import type { DocumentChangeArtifact, TaskRecord, TmdState } from "../core/types";
import { buildPatchRows } from "../core/diff-service";
import { getArtifactLocationLabel } from "../core/artifacts";

export const TMD_DIFF_VIEW_TYPE = "tmd-diff-view";

export class TmdDiffView extends ItemView {
  private unsubscribe: (() => void) | null = null;
  private latestState!: TmdState;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TmdPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return TMD_DIFF_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Tmd Results";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("tmd-view");
    this.unsubscribe = this.plugin.taskEngine.subscribe((state) => {
      this.latestState = state;
      void this.render(state);
    });
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private async render(state: TmdState): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();

    const currentTask = state.currentTaskId ? state.tasks.find((task) => task.id === state.currentTaskId) ?? state.tasks[0] : state.tasks[0];
    contentEl.createEl("h2", { text: "Tmd Results" });

    if (!currentTask) {
      contentEl.createDiv({ cls: "tmd-empty", text: "No task has run yet." });
      return;
    }

    this.renderTaskSummary(contentEl, currentTask);

    if (currentTask.textResult?.text.trim()) {
      const textSection = contentEl.createDiv({ cls: "tmd-section" });
      textSection.createEl("h3", { text: "Text Result" });
      textSection.createEl("pre", {
        cls: "tmd-text-result",
        text: currentTask.textResult.text
      });
    }

    if (currentTask.artifacts.length === 0) {
      if (!currentTask.textResult && currentTask.status === "running") {
        const waiting = contentEl.createDiv({ cls: "tmd-empty tmd-waiting" });
        waiting.createDiv({ cls: "tmd-stars-loading", text: "* * *" });
        waiting.createDiv({ text: "Waiting for Ante…" });
      }
      return;
    }

    for (const artifact of currentTask.artifacts) {
      await this.renderArtifact(contentEl, currentTask, artifact);
    }
  }

  private renderTaskSummary(container: HTMLElement, task: TaskRecord): void {
    const section = container.createDiv({ cls: "tmd-section" });
    const titleRow = section.createDiv({ cls: "tmd-title-row" });
    titleRow.createEl("h3", { text: `${task.preset.label} · ${task.status}` });
    if (task.status === "running") {
      const spinner = titleRow.createDiv({ cls: "tmd-stars-loading", text: "* * *" });
      spinner.setAttr("aria-label", "Ante is running");
    }
    if (task.context?.filePath) {
      section.createDiv({ cls: "tmd-meta", text: task.context.filePath });
    }
    if (task.inlineInstruction) {
      section.createEl("p", { text: task.inlineInstruction, cls: "tmd-meta" });
    }
    if (task.error) {
      section.createDiv({ cls: "tmd-error", text: task.error });
    }
  }

  private async renderArtifact(container: HTMLElement, task: TaskRecord, artifact: DocumentChangeArtifact): Promise<void> {
    const section = container.createDiv({ cls: "tmd-section" });
    section.createEl("h3", { text: artifact.title });
    section.createDiv({ cls: "tmd-meta", text: getArtifactLocationLabel(artifact) });
    if (artifact.summary) {
      section.createEl("p", { text: artifact.summary, cls: "tmd-meta" });
    }

    const actions = section.createDiv({ cls: "tmd-actions" });
    const applyButton = actions.createEl("button", { text: artifact.applyState === "applied" ? "Applied" : "Apply" });
    applyButton.disabled =
      artifact.applyState === "applying" ||
      artifact.applyState === "reverting" ||
      artifact.applyState === "applied" ||
      artifact.applyState === "discarded";
    applyButton.addEventListener("click", () => {
      void this.plugin.taskEngine.applyArtifact(task.id, artifact.id).catch((error) => {
        new Notice(error instanceof Error ? error.message : "Failed to apply change");
      });
    });

    const discardButton = actions.createEl("button", { text: "Discard" });
    discardButton.disabled =
      artifact.applyState === "applied" ||
      artifact.applyState === "reverted" ||
      artifact.applyState === "discarded";
    discardButton.addEventListener("click", () => {
      this.plugin.taskEngine.discardArtifact(task.id, artifact.id);
    });

    const revertButton = actions.createEl("button", { text: artifact.applyState === "reverted" ? "Reverted" : "Revert" });
    revertButton.disabled = artifact.applyState !== "applied";
    revertButton.addEventListener("click", () => {
      void this.plugin.taskEngine.revertArtifact(task.id, artifact.id).catch((error) => {
        new Notice(error instanceof Error ? error.message : "Failed to revert change");
      });
    });

    const revealButton = actions.createEl("button", { text: "Reveal" });
    revealButton.addEventListener("click", () => {
      void this.plugin.taskEngine.revealArtifact(task.id, artifact.id).catch((error) => {
        new Notice(error instanceof Error ? error.message : "Failed to reveal file");
      });
    });

    if (artifact.applyError) {
      section.createDiv({ cls: "tmd-error", text: artifact.applyError });
    }

    const rows = await buildPatchRows(artifact);
    const pre = section.createEl("pre", { cls: "tmd-patch" });
    for (const row of rows) {
      const line = pre.createDiv({ text: row.text });
      line.addClass(`is-${row.kind}`);
    }
  }
}
