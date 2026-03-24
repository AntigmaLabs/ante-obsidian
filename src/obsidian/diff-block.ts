import { Notice, setIcon } from "obsidian";
import type TmdPlugin from "./main";
import type { DocumentChangeArtifact, TaskRecord } from "../core/types";
import { buildPatchRows, type PatchRow } from "../core/diff-service";
import { getArtifactLocationLabel } from "../core/artifacts";

export type DiffStats = {
  additions: number;
  removals: number;
};

export type DiffHunk = {
  header: string;
  rows: Extract<PatchRow, { kind: "context" | "add" | "remove" }>[];
};

export type ResolvedArtifactDiff = {
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

    if (current?.kind === "remove" && next?.kind === "add" && current.text === next.text) {
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

export const resolveArtifactDiffs = async (task: TaskRecord): Promise<ResolvedArtifactDiff[]> =>
  Promise.all(
    task.artifacts.map(async (artifact) => {
      const rows = normalizeRenderableRows(await buildPatchRows(artifact));
      return {
        artifact,
        rows,
        stats: collectDiffStats(rows),
        hunks: collectDiffHunks(rows)
      } satisfies ResolvedArtifactDiff;
    })
  );

export const renderStatPills = (container: HTMLElement, stats: DiffStats): void => {
  if (stats.additions > 0) {
    container.createSpan({ cls: "tmd-diff-stat is-add", text: formatDiffCount(stats.additions, "+") });
  }
  if (stats.removals > 0) {
    container.createSpan({ cls: "tmd-diff-stat is-remove", text: formatDiffCount(stats.removals, "-") });
  }
  if (stats.additions === 0 && stats.removals === 0) {
    container.createSpan({ cls: "tmd-diff-stat is-neutral", text: "No text changes" });
  }
};

export const renderDiffSummary = (container: HTMLElement, artifacts: ResolvedArtifactDiff[]): void => {
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

  renderStatPills(title, aggregate);
};

export const renderArtifactDiff = (
  container: HTMLElement,
  plugin: TmdPlugin,
  task: TaskRecord,
  resolved: ResolvedArtifactDiff,
  expandedArtifactIds: Set<string>,
  onToggleExpanded: () => void
): void => {
  const { artifact, stats, hunks } = resolved;
  const isExpanded = expandedArtifactIds.has(artifact.id);

  const section = container.createDiv({ cls: "tmd-diff-file" });
  section.addClass(isExpanded ? "is-expanded" : "is-collapsed");
  const header = section.createDiv({ cls: "tmd-diff-file-header" });
  const headerMain = header.createEl("button", { cls: "tmd-diff-file-main" });
  headerMain.type = "button";
  headerMain.setAttr("aria-expanded", String(isExpanded));
  headerMain.addEventListener("click", onToggleExpanded);

  const titleRow = headerMain.createDiv({ cls: "tmd-diff-file-title-row" });
  titleRow.createSpan({ cls: "tmd-diff-file-name", text: artifact.title });
  titleRow.createSpan({ cls: "tmd-diff-file-chip tmd-is-operation", text: getOperationLabel(artifact.operation) });
  const locationRow = headerMain.createDiv({ cls: "tmd-diff-file-location" });
  locationRow.createSpan({ text: getArtifactLocationLabel(artifact) });
  if (artifact.summary) {
    headerMain.createDiv({ cls: "tmd-diff-file-summary", text: artifact.summary });
  }

  const headerAside = header.createDiv({ cls: "tmd-diff-file-aside" });
  renderStatPills(headerAside, stats);
  headerAside.createSpan({
    cls: `tmd-diff-file-chip tmd-diff-state ${getApplyStateClass(artifact.applyState)}`,
    text: getApplyStateLabel(artifact.applyState)
  });
  const chevronButton = headerAside.createEl("button", {
    cls: "tmd-diff-file-chevron"
  });
  chevronButton.type = "button";
  chevronButton.setAttr("aria-expanded", String(isExpanded));
  chevronButton.setAttr("aria-label", isExpanded ? "Collapse diff" : "Expand diff");
  setIcon(chevronButton, isExpanded ? "chevron-up" : "chevron-down");
  chevronButton.addEventListener("click", (event) => {
    event.preventDefault();
    onToggleExpanded();
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
    void plugin.taskEngine.applyArtifact(task.id, artifact.id).catch((error) => {
      new Notice(error instanceof Error ? error.message : "Failed to apply change");
    });
  });

  const discardButton = actions.createEl("button", { text: "Discard" });
  discardButton.disabled =
    artifact.applyState === "applied" ||
    artifact.applyState === "reverted" ||
    artifact.applyState === "discarded";
  discardButton.addEventListener("click", () => {
    plugin.taskEngine.discardArtifact(task.id, artifact.id);
  });

  const revertButton = actions.createEl("button", { text: artifact.applyState === "reverted" ? "Reverted" : "Revert" });
  revertButton.disabled = artifact.applyState !== "applied";
  revertButton.addEventListener("click", () => {
    void plugin.taskEngine.revertArtifact(task.id, artifact.id).catch((error) => {
      new Notice(error instanceof Error ? error.message : "Failed to revert change");
    });
  });

  const revealButton = actions.createEl("button", { text: "Reveal" });
  revealButton.addEventListener("click", () => {
    void plugin.taskEngine.revealArtifact(task.id, artifact.id).catch((error) => {
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
};
