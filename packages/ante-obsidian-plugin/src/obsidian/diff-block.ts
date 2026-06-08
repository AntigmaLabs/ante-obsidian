import { Notice, setIcon } from "obsidian";
import type TmdPlugin from "./main";
import type { DocumentChangeArtifact, TaskRecord } from "../core/types";
import { buildPatchRows, type PatchRow } from "../core/diff-service";
import { getArtifactTargetKey, getArtifactTargetPath } from "../core/artifacts";
import { appendErrorReportLink } from "./utils";

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

const formatFileCountLabel = (fileCount: number, changeCount: number): string => {
  const fileLabel = `${fileCount} file${fileCount === 1 ? "" : "s"} changed`;
  return changeCount > fileCount ? `${fileLabel} · ${changeCount} changes` : fileLabel;
};

type InlineSegment = {
  text: string;
  kind: "common" | "remove" | "add";
};

const buildInlineDiffSegments = (before: string, after: string): { before: InlineSegment[]; after: InlineSegment[] } => {
  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before[prefix] === after[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  const maxSuffix = Math.min(before.length - prefix, after.length - prefix);
  while (
    suffix < maxSuffix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const beforePrefix = before.slice(0, prefix);
  const beforeChanged = before.slice(prefix, before.length - suffix);
  const beforeSuffix = suffix > 0 ? before.slice(before.length - suffix) : "";
  const afterPrefix = after.slice(0, prefix);
  const afterChanged = after.slice(prefix, after.length - suffix);
  const afterSuffix = suffix > 0 ? after.slice(after.length - suffix) : "";

  return {
    before: [
      beforePrefix ? { text: beforePrefix, kind: "common" } : null,
      beforeChanged ? { text: beforeChanged, kind: "remove" } : null,
      beforeSuffix ? { text: beforeSuffix, kind: "common" } : null
    ].filter(Boolean) as InlineSegment[],
    after: [
      afterPrefix ? { text: afterPrefix, kind: "common" } : null,
      afterChanged ? { text: afterChanged, kind: "add" } : null,
      afterSuffix ? { text: afterSuffix, kind: "common" } : null
    ].filter(Boolean) as InlineSegment[]
  };
};

const renderInlineSegments = (container: HTMLElement, segments: InlineSegment[]): void => {
  if (segments.length === 0) {
    container.setText(" ");
    return;
  }

  for (const segment of segments) {
    container.createSpan({
      cls: segment.kind === "common" ? "tmd-diff-inline-common" : `tmd-diff-inline-${segment.kind}`,
      text: segment.text || " "
    });
  }
};

const renderDiffLine = (
  container: HTMLElement,
  row: RenderableDiffRow,
  pairedSegments?: InlineSegment[]
): void => {
  const line = container.createDiv({ cls: `tmd-diff-line is-${row.kind}` });
  line.createDiv({ cls: "tmd-diff-gutter" });
  line.createDiv({ cls: "tmd-diff-line-number" }).setText(row.oldLine === null ? "" : String(row.oldLine));
  line.createDiv({ cls: "tmd-diff-line-number" }).setText(row.newLine === null ? "" : String(row.newLine));
  line.createDiv({ cls: "tmd-diff-line-marker", text: row.marker });
  const text = line.createDiv({ cls: "tmd-diff-line-text" });
  if (pairedSegments) {
    renderInlineSegments(text, pairedSegments);
    return;
  }
  text.setText(row.text || " ");
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
      activeHunk.rows.push(row);
    }
  }

  return hunks;
};

export const resolveArtifactDiffs = async (task: TaskRecord): Promise<ResolvedArtifactDiff[]> =>
  resolveArtifactsToDiffs(task.artifacts);

export const resolveArtifactsToDiffs = async (artifacts: DocumentChangeArtifact[]): Promise<ResolvedArtifactDiff[]> =>
  Promise.all(
    artifacts.map(async (artifact) => {
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

export const collectAggregateDiffStats = (artifacts: ResolvedArtifactDiff[]): DiffStats =>
  artifacts.reduce<DiffStats>(
    (stats, artifact) => {
      stats.additions += artifact.stats.additions;
      stats.removals += artifact.stats.removals;
      return stats;
    },
    { additions: 0, removals: 0 }
  );

export const countChangedFiles = (artifacts: ResolvedArtifactDiff[]): number =>
  new Set(artifacts.map(({ artifact }) => getArtifactTargetKey(artifact))).size;

export interface RenderDiffSummaryOptions {
  actionLabel?: string;
  onAction?: () => void;
  isActionDisabled?: boolean;
}

export const renderDiffSummary = (
  container: HTMLElement,
  artifacts: ResolvedArtifactDiff[],
  options?: RenderDiffSummaryOptions
): HTMLElement => {
  const card = container.createDiv({ cls: "tmd-diff-card" });
  const summary = card.createDiv({ cls: "tmd-diff-summary" });
  const title = summary.createDiv({ cls: "tmd-diff-summary-title" });
  title.createSpan({
    cls: "tmd-diff-summary-count",
    text: formatFileCountLabel(countChangedFiles(artifacts), artifacts.length)
  });
  renderStatPills(title, collectAggregateDiffStats(artifacts));

  if (options?.onAction) {
    const actionButton = summary.createEl("button", {
      cls: "tmd-diff-summary-action",
      text: options.actionLabel ?? "Apply all"
    });
    actionButton.type = "button";
    actionButton.disabled = Boolean(options.isActionDisabled);
    actionButton.addEventListener("click", options.onAction);
  }

  return card.createDiv({ cls: "tmd-diff-card-list" });
};

export const renderArtifactDiff = (
  container: HTMLElement,
  plugin: TmdPlugin,
  task: TaskRecord | null,
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

  headerMain.createSpan({ cls: "tmd-diff-file-name", text: getArtifactTargetPath(artifact) });

  const headerAside = header.createDiv({ cls: "tmd-diff-file-aside" });
  renderStatPills(headerAside, stats);
  const chevronButton = headerAside.createEl("button", {
    cls: "tmd-diff-file-chevron clickable-icon"
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
    !task ||
    artifact.applyState === "applying" ||
    artifact.applyState === "reverting" ||
    artifact.applyState === "applied" ||
    artifact.applyState === "discarded";
  if (task) {
    applyButton.addEventListener("click", () => {
      void plugin.taskEngine.applyArtifact(task.id, artifact.id).catch((error) => {
        new Notice(error instanceof Error ? error.message : "Failed to apply change");
      });
    });
  }

  const discardButton = actions.createEl("button", { text: "Discard" });
  discardButton.disabled =
    !task ||
    artifact.applyState === "applying" ||
    artifact.applyState === "reverting" ||
    artifact.applyState === "discarded";
  if (task) {
    discardButton.addEventListener("click", () => {
      void plugin.taskEngine.discardArtifact(task.id, artifact.id).catch((error) => {
        new Notice(error instanceof Error ? error.message : "Failed to discard change");
      });
    });
  }

  if (artifact.applyError) {
    const errorEl = body.createDiv({ cls: "tmd-error" });
    errorEl.createSpan({ cls: "tmd-error-text", text: artifact.applyError });
    appendErrorReportLink(errorEl, artifact.applyError, plugin);
  }

  const patch = body.createDiv({ cls: "tmd-diff-patch" });
  const patchToolbar = patch.createDiv({ cls: "tmd-diff-patch-toolbar" });
  patchToolbar.createDiv({
    cls: "tmd-diff-patch-title",
    text: hunks[0]?.header ?? "@@"
  });
  const toolbarActions = patchToolbar.createDiv({ cls: "tmd-diff-file-actions" });
  toolbarActions.appendChild(applyButton);
  toolbarActions.appendChild(discardButton);

  hunks.forEach((hunk, index) => {
    const hunkEl = patch.createDiv({ cls: "tmd-diff-hunk" });
    if (index > 0) {
      hunkEl.createDiv({ cls: "tmd-diff-hunk-header", text: hunk.header });
    }
    for (let rowIndex = 0; rowIndex < hunk.rows.length; rowIndex += 1) {
      const row = hunk.rows[rowIndex];
      const next = hunk.rows[rowIndex + 1];
      if (row?.kind === "remove" && next?.kind === "add") {
        const segments = buildInlineDiffSegments(row.text, next.text);
        renderDiffLine(hunkEl, row, segments.before);
        renderDiffLine(hunkEl, next, segments.after);
        rowIndex += 1;
        continue;
      }
      renderDiffLine(hunkEl, row);
    }
  });
};
