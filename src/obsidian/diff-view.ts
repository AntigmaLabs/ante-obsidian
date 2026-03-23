import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type TmdPlugin from "./main";
import type { DocumentChangeArtifact, TaskRecord, TmdState } from "../core/types";
import { buildPatchRows, type PatchRow } from "../core/diff-service";
import { getArtifactLocationLabel } from "../core/artifacts";

export const TMD_DIFF_VIEW_TYPE = "tmd-diff-view";

type DiffStats = {
  additions: number;
  removals: number;
};

type DiffHunk = {
  header: string;
  rows: Extract<PatchRow, { kind: "context" | "add" | "remove" }>[];
};

type ResolvedArtifactDiff = {
  artifact: DocumentChangeArtifact;
  rows: PatchRow[];
  stats: DiffStats;
  hunks: DiffHunk[];
};

type RenderableDiffRow = Extract<PatchRow, { kind: "context" | "add" | "remove" }>;

const formatDiffCount = (value: number, marker: "+" | "-"): string => `${marker}${value}`;

const assertNever = (value: never): never => {
  throw new Error(`Unexpected value: ${String(value)}`);
};

const getOperationLabel = (operation: DocumentChangeArtifact["operation"]): string => {
  switch (operation) {
    case "replace-selection":
      return "Replace selection";
    case "append-block":
      return "Append block";
    case "replace-file":
      return "Replace file";
    case "create-file":
      return "Create file";
    default:
      return assertNever(operation);
  }
};

const getApplyStateLabel = (state: DocumentChangeArtifact["applyState"]): string => {
  switch (state) {
    case "pending":
      return "Pending";
    case "applying":
      return "Applying";
    case "applied":
      return "Applied";
    case "reverting":
      return "Reverting";
    case "reverted":
      return "Reverted";
    case "failed":
      return "Failed";
    case "discarded":
      return "Discarded";
    default:
      return assertNever(state);
  }
};

const getApplyStateClass = (state: DocumentChangeArtifact["applyState"]): string => {
  switch (state) {
    case "applied":
    case "reverted":
      return "is-positive";
    case "failed":
      return "is-negative";
    case "applying":
    case "reverting":
      return "is-active";
    case "discarded":
      return "is-muted";
    case "pending":
      return "is-pending";
    default:
      return assertNever(state);
  }
};

const collectDiffStats = (rows: PatchRow[]): DiffStats =>
  rows.reduce<DiffStats>(
    (stats, row) => {
      if (row.kind === "add") {
        stats.additions += 1;
      } else if (row.kind === "remove") {
        stats.removals += 1;
      }
      return stats;
    },
    { additions: 0, removals: 0 }
  );

const normalizeRenderableRows = (rows: PatchRow[]): PatchRow[] => {
  const normalized: PatchRow[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const current = rows[index];
    const next = rows[index + 1];

    if (
      current?.kind === "remove" &&
      next?.kind === "add" &&
      current.text === next.text
    ) {
      normalized.push({
        kind: "context",
        text: current.text,
        oldLine: current.oldLine,
        newLine: next.newLine,
        marker: " "
      });
      index += 1;
      continue;
    }

    normalized.push(current);
  }

  return normalized;
};

const collectDiffHunks = (rows: PatchRow[]): DiffHunk[] => {
  const hunks: DiffHunk[] = [];
  let activeHunk: DiffHunk | null = null;

  for (const row of rows) {
    if (row.kind === "hunk") {
      activeHunk = { header: row.text, rows: [] };
      hunks.push(activeHunk);
      continue;
    }
    if (row.kind === "context" || row.kind === "add" || row.kind === "remove") {
      if (!activeHunk) {
        activeHunk = { header: "@@", rows: [] };
        hunks.push(activeHunk);
      }
      activeHunk.rows.push(row as RenderableDiffRow);
    }
  }

  return hunks;
};

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
      resolvedArtifacts = await Promise.all(
        currentTask.artifacts.map(async (artifact) => {
          const rows = normalizeRenderableRows(await buildPatchRows(artifact));
          return {
            artifact,
            rows,
            stats: collectDiffStats(rows),
            hunks: collectDiffHunks(rows)
          } satisfies ResolvedArtifactDiff;
        })
      );
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
        waiting.createDiv({ cls: "tmd-stars-loading", text: "* * *" });
        waiting.createDiv({ text: "Waiting for Ante…" });
      }
      return;
    }

    this.renderDiffSummary(contentEl, resolvedArtifacts);

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

  private renderDiffSummary(container: HTMLElement, artifacts: ResolvedArtifactDiff[]): void {
    const summary = container.createDiv({ cls: "tmd-diff-summary" });
    const title = summary.createDiv({ cls: "tmd-diff-summary-title" });
    const fileCount = artifacts.length;
    title.createSpan({ text: `${fileCount} file${fileCount === 1 ? "" : "s"} changed` });

    const aggregate = artifacts.reduce<DiffStats>(
      (stats, artifact) => {
        stats.additions += artifact.stats.additions;
        stats.removals += artifact.stats.removals;
        return stats;
      },
      { additions: 0, removals: 0 }
    );

    this.renderStatPills(title, aggregate);
  }

  private renderStatPills(container: HTMLElement, stats: DiffStats): void {
    if (stats.additions > 0) {
      container.createSpan({ cls: "tmd-diff-stat is-add", text: formatDiffCount(stats.additions, "+") });
    }
    if (stats.removals > 0) {
      container.createSpan({ cls: "tmd-diff-stat is-remove", text: formatDiffCount(stats.removals, "-") });
    }
    if (stats.additions === 0 && stats.removals === 0) {
      container.createSpan({ cls: "tmd-diff-stat is-neutral", text: "No text changes" });
    }
  }

  private renderArtifact(container: HTMLElement, task: TaskRecord, resolved: ResolvedArtifactDiff): void {
    const { artifact, stats, hunks } = resolved;
    const isExpanded = this.expandedArtifactIds.has(artifact.id);
    const toggleExpanded = (): void => {
      if (this.expandedArtifactIds.has(artifact.id)) {
        this.expandedArtifactIds.delete(artifact.id);
      } else {
        this.expandedArtifactIds.add(artifact.id);
      }
      if (this.latestState) {
        void this.render(this.latestState);
      }
    };

    const section = container.createDiv({ cls: "tmd-diff-file" });
    section.addClass(isExpanded ? "is-expanded" : "is-collapsed");
    const header = section.createDiv({ cls: "tmd-diff-file-header" });
    const headerMain = header.createEl("button", { cls: "tmd-diff-file-main" });
    headerMain.type = "button";
    headerMain.setAttr("aria-expanded", String(isExpanded));
    headerMain.addEventListener("click", toggleExpanded);

    const titleRow = headerMain.createDiv({ cls: "tmd-diff-file-title-row" });
    titleRow.createSpan({ cls: "tmd-diff-file-name", text: artifact.title });
    titleRow.createSpan({ cls: "tmd-diff-file-chip tmd-is-operation", text: getOperationLabel(artifact.operation) });
    const locationRow = headerMain.createDiv({ cls: "tmd-diff-file-location" });
    locationRow.createSpan({ text: getArtifactLocationLabel(artifact) });
    if (artifact.summary) {
      headerMain.createDiv({ cls: "tmd-diff-file-summary", text: artifact.summary });
    }

    const headerAside = header.createDiv({ cls: "tmd-diff-file-aside" });
    this.renderStatPills(headerAside, stats);
    headerAside.createSpan({
      cls: `tmd-diff-file-chip tmd-diff-state ${getApplyStateClass(artifact.applyState)}`,
      text: getApplyStateLabel(artifact.applyState)
    });
    const chevronButton = headerAside.createEl("button", {
      cls: "tmd-diff-file-chevron",
      text: isExpanded ? "⌃" : "⌄"
    });
    chevronButton.type = "button";
    chevronButton.setAttr("aria-expanded", String(isExpanded));
    chevronButton.setAttr("aria-label", isExpanded ? "Collapse diff" : "Expand diff");
    chevronButton.addEventListener("click", (event) => {
      event.preventDefault();
      toggleExpanded();
    });

    if (!isExpanded) {
      return;
    }

    const body = section.createDiv({ cls: "tmd-diff-file-body" });
    const actions = body.createDiv({ cls: "tmd-diff-file-actions" });
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
      body.createDiv({ cls: "tmd-error", text: artifact.applyError });
    }

    const patch = body.createDiv({ cls: "tmd-diff-patch" });
    for (const hunk of hunks) {
      const hunkEl = patch.createDiv({ cls: "tmd-diff-hunk" });
      hunkEl.createDiv({ cls: "tmd-diff-hunk-header", text: hunk.header });
      for (const row of hunk.rows) {
        const line = hunkEl.createDiv({ cls: `tmd-diff-line is-${row.kind}` });
        line.createDiv({ cls: "tmd-diff-gutter" });
        line.createDiv({ cls: "tmd-diff-line-number" }).setText(row.oldLine === null ? "" : String(row.oldLine));
        line.createDiv({ cls: "tmd-diff-line-number" }).setText(row.newLine === null ? "" : String(row.newLine));
        line.createDiv({ cls: "tmd-diff-line-marker", text: row.marker });
        line.createDiv({ cls: "tmd-diff-line-text", text: row.text || " " });
      }
    }
  }
}
