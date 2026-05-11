import { Notice } from "obsidian"
import type TmdPlugin from "./main"
import type { TaskRecord } from "../core/types"
import {
  renderArtifactDiff,
  renderDiffSummary,
  type ResolvedArtifactDiff,
} from "./diff-block"

export const renderArtifactDiffList = (
  container: HTMLElement,
  options: {
    plugin: TmdPlugin
    task: TaskRecord | null
    resolvedArtifacts: ResolvedArtifactDiff[]
    expandedArtifactIds: Set<string>
    onToggleExpanded: (artifactId: string) => void
    onApplyAll?: (() => Promise<void>) | undefined
    onApplyAllError?: string
  },
): HTMLElement => {
  const { task, resolvedArtifacts } = options
  const diffList = renderDiffSummary(container, resolvedArtifacts, {
    actionLabel: "Apply all",
    onAction: options.onApplyAll
      ? () => {
          void options.onApplyAll?.().catch((error) => {
            new Notice(
              error instanceof Error
                ? error.message
                : (options.onApplyAllError ?? "Failed to apply all changes"),
            )
          })
        }
      : undefined,
    isActionDisabled:
      !task ||
      resolvedArtifacts.every(
        ({ artifact }) =>
          artifact.applyState === "applied" ||
          artifact.applyState === "discarded",
      ),
  })

  for (const resolvedArtifact of resolvedArtifacts) {
    renderArtifactDiff(
      diffList,
      options.plugin,
      task,
      resolvedArtifact,
      options.expandedArtifactIds,
      () => {
        options.onToggleExpanded(resolvedArtifact.artifact.id)
      },
    )
  }

  return diffList
}
