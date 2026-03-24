import { ItemView, WorkspaceLeaf } from "obsidian";
import type TmdPlugin from "./main";
import type { TaskRecord, TmdState } from "../core/types";
import { formatLoadingLabel } from "../core/loading-label";
import { renderArtifactDiff, renderDiffSummary, resolveArtifactDiffs, type ResolvedArtifactDiff } from "./diff-block";

export const TMD_DIFF_VIEW_TYPE = "tmd-diff-view";

export class TmdDiffView extends ItemView {
  private unsubscribe: (() => void) | null = null;
  private latestState!: TmdState;
  private readonly expandedArtifactIds = new Set<string>();
  private renderVersion = 0;
  private expandedStateTaskId: string | null = null;

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
    const currentTask = state.currentTaskId ? state.tasks.find((task) => task.id === state.currentTaskId) ?? state.tasks[0] : state.tasks[0];
    const renderVersion = ++this.renderVersion;

    if (!currentTask) {
      if (renderVersion !== this.renderVersion) {
        return;
      }
      const { contentEl } = this;
      contentEl.empty();
      contentEl.createEl("h2", { text: "Tmd Results" });
      contentEl.createDiv({ cls: "tmd-empty", text: "No task has run yet." });
      return;
    }

    let resolvedArtifacts: ResolvedArtifactDiff[] = [];
    if (currentTask.artifacts.length > 0) {
      resolvedArtifacts = await resolveArtifactDiffs(currentTask);
    }

    if (renderVersion !== this.renderVersion) {
      return;
    }

    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Tmd Results" });

    this.renderTaskSummary(contentEl, currentTask);
    this.ensureExpandedArtifacts(currentTask);

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
        waiting.createDiv({ cls: "tmd-stars-loading", text: formatLoadingLabel(currentTask.id, 2) });
        waiting.createDiv({ text: "Waiting for Ante…" });
      }
      return;
    }

    renderDiffSummary(contentEl, resolvedArtifacts);

    for (const resolvedArtifact of resolvedArtifacts) {
      this.renderArtifact(contentEl, currentTask, resolvedArtifact);
    }
  }

  private ensureExpandedArtifacts(task: TaskRecord): void {
    const artifactIds = new Set(task.artifacts.map((artifact) => artifact.id));
    for (const expandedId of Array.from(this.expandedArtifactIds)) {
      if (!artifactIds.has(expandedId)) {
        this.expandedArtifactIds.delete(expandedId);
      }
    }

    const switchedTask = this.expandedStateTaskId !== task.id;
    if (switchedTask) {
      this.expandedStateTaskId = task.id;
      this.expandedArtifactIds.clear();
    }

    if (switchedTask && task.artifacts.length > 0 && this.expandedArtifactIds.size === 0) {
      this.expandedArtifactIds.add(task.artifacts[0].id);
    }
  }

  private renderTaskSummary(container: HTMLElement, task: TaskRecord): void {
    const section = container.createDiv({ cls: "tmd-section" });
    const titleRow = section.createDiv({ cls: "tmd-title-row" });
    titleRow.createEl("h3", { text: `${task.preset.label} · ${task.status}` });
    if (task.status === "running") {
      const spinner = titleRow.createDiv({ cls: "tmd-stars-loading", text: formatLoadingLabel(task.id, 2) });
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

  private renderArtifact(container: HTMLElement, task: TaskRecord, resolved: ResolvedArtifactDiff): void {
    const { artifact } = resolved;
    renderArtifactDiff(container, this.plugin, task, resolved, this.expandedArtifactIds, () => {
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
}
