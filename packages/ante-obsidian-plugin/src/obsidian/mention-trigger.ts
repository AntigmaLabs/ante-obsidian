import { Editor, MarkdownView, Notice, TFile, type App } from "obsidian";
import { formatLoadingLabel } from "../core/loading-label";
import { resolveMentionTrigger } from "../core/mention-trigger-state";
import { buildParagraphSelection } from "../core/paragraph-selection";
import type { ContextSnapshot, PresetId, TaskTriggerSource, TaskRecord } from "../core/types";
import type TmdPlugin from "./main";

const INVISIBLE_ZERO = "\u200B";
const INVISIBLE_ONE = "\u200C";
const INVISIBLE_SEPARATOR = "\u2063";

function logTmdDebug(message: string): void {
  void message;
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen - 3)}...`;
}

function getLastNonEmptyLine(text: string): string {
  let currentIndex = text.length;
  while (currentIndex > 0) {
    const nextNewline = text.lastIndexOf("\n", currentIndex - 1);
    const line =
      nextNewline === -1
        ? text.slice(0, currentIndex).trim()
        : text.slice(nextNewline + 1, currentIndex).trim();
    if (line) {
      return line;
    }
    if (nextNewline === -1) {
      break;
    }
    currentIndex = nextNewline;
  }
  return "";
}

function getProgressTextForRunningTask(task: TaskRecord): string {
  // 1. Try to get the latest line of thinkingText (reasoning process)
  const thinking = task.telemetry?.thinkingText;
  if (thinking) {
    const lastLine = getLastNonEmptyLine(thinking);
    if (lastLine) {
      // Clean up markdown markers
      const cleanLine = lastLine.replace(/[*_`#]/g, "").trim();
      if (cleanLine) {
        return truncateText(cleanLine, 60);
      }
    }
  }

  // 2. Try to get progress from processLane (high-level step labels)
  if (task.processLane?.steps) {
    const activeStep =
      task.processLane.steps.find((step) => step.status === "in_progress") ??
      task.processLane.steps.find((step) => step.status === "pending");
    if (activeStep) {
      return activeStep.activeLabel ?? activeStep.label;
    }
    const completedSteps = task.processLane.steps.filter((step) => step.status === "completed");
    if (completedSteps.length > 0) {
      const lastCompleted = completedSteps[completedSteps.length - 1];
      const completedLabel = lastCompleted?.activeLabel ?? lastCompleted?.label;
      if (completedLabel) {
        return completedLabel;
      }
    }
  }

  // 3. Fallback to the latest log line if processLane is empty/missing
  if (task.logs && task.logs.length > 0) {
    for (let i = task.logs.length - 1; i >= 0; i--) {
      const log = task.logs[i];
      if (log && log.text.trim()) {
        const text = log.text.trim();
        // Ignore internal protocol tags
        if (
          !text.startsWith("Ante ") &&
          !text.startsWith("Reusing ") &&
          !text.startsWith("Launching ") &&
          !text.startsWith("Protocol ") &&
          !text.startsWith("Session ")
        ) {
          const firstLine = text.split("\n")[0] ?? "";
          return truncateText(firstLine, 60);
        }
      }
    }
  }

  return "";
}

function buildPlaceholderBody(
  loadingSeed: string,
  loadingFrameIndex: number,
  model: string | undefined,
  progressText: string,
): string {
  const lines: string[] = [];
  if (model) {
    lines.push(
      `> <small style="color: var(--text-muted); opacity: 0.55; font-size: 0.75em;">model: ${escapeHtml(model)}</small>`,
    );
  }
  if (progressText) {
    lines.push(
      `> <small style="color: var(--text-muted); opacity: 0.7; font-style: italic;">Doing: ${escapeHtml(progressText)}</small>`,
    );
  }
  lines.push(`> ${formatLoadingLabel(loadingSeed, loadingFrameIndex)}`);
  return lines.join("\n");
}

interface PlaceholderMarkers {
  blockStart: string;
  blockEnd: string;
}

export class MentionTriggerService {
  private readonly handledKeys = new Set<string>();
  private suppressEditorChangeDepth = 0;
  private running = false;

  constructor(
    private readonly app: App,
    private readonly plugin: TmdPlugin,
    private readonly isDebugEnabled: () => boolean,
  ) {}

  destroy(): void {
    this.handledKeys.clear();
  }

  async handleEditorChange(editor: Editor): Promise<void> {
    if (this.running || this.suppressEditorChangeDepth > 0) {
      return;
    }

    const view = this.resolveMarkdownViewForEditor(editor);
    if (!view?.file) {
      return;
    }

    const cursor = editor.getCursor();
    const currentLine = editor.getLine(cursor.line);
    const previousLine = cursor.line > 0 ? editor.getLine(cursor.line - 1) : "";
    const { match, matchLine, matchText, lineKey, releaseHandledPrefix } = resolveMentionTrigger(
      view.file.path,
      cursor.line,
      currentLine,
      previousLine,
    );

    if (!match) {
      if (releaseHandledPrefix) {
        for (const key of [...this.handledKeys]) {
          if (key.startsWith(releaseHandledPrefix)) {
            this.handledKeys.delete(key);
          }
        }
      }
      return;
    }

    if (!lineKey) {
      return;
    }

    if (this.handledKeys.has(lineKey)) {
      return;
    }

    const paragraphSelection = buildParagraphSelection(editor, matchLine, match.start);
    const mentionSelection = paragraphSelection
      ? {
          ...paragraphSelection,
          to: {
            line: matchLine,
            ch: matchText.length,
          },
        }
      : null;
    const activeContext = await this.plugin.hostAdapter.getActiveContext();
    if (!activeContext) {
      return;
    }

    const context = activeContext.selection?.text.trim()
      ? activeContext
      : {
          ...activeContext,
          selection: mentionSelection
            ? {
                text: mentionSelection.text,
                from: mentionSelection.from,
                to: mentionSelection.to,
              }
            : null,
        };

    if (!this.plugin.ensureAnteInstalled("Inline Ante trigger")) {
      return;
    }

    this.handledKeys.add(lineKey);
    this.running = true;

    if (this.isDebugEnabled()) {
      new Notice(`Triggered ${matchText.slice(match.start, match.end)}`);
    }

    try {
      const triggerLineText = editor.getLine(matchLine);
      const replaceFrom = {
        line: matchLine,
        ch: match.start,
      };
      const replaceTo = {
        line: matchLine,
        ch: triggerLineText.length,
      };

      await this.runTaskWithPlaceholder({
        editor,
        replaceFrom,
        replaceTo,
        context,
        presetId: match.presetId,
        inlineInstruction: match.inlineInstruction,
        triggerSource: "mention",
      });
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Inline Ante trigger failed");
    } finally {
      this.running = false;
    }
  }

  async runTaskWithPlaceholder(options: {
    editor: Editor;
    replaceFrom: { line: number; ch: number };
    replaceTo: { line: number; ch: number };
    context: ContextSnapshot;
    presetId: PresetId;
    inlineInstruction?: string;
    triggerSource?: Exclude<TaskTriggerSource, "chat">;
  }): Promise<void> {
    const {
      editor,
      replaceFrom,
      replaceTo,
      context,
      presetId,
      inlineInstruction,
      triggerSource = "mention",
    } = options;
    let loadingFrameIndex = 0;
    const loadingSeed = window.crypto.randomUUID();
    logTmdDebug(`runTaskWithPlaceholder started: seed=${loadingSeed} file=${context.filePath}`);
    const markers = this.createPlaceholderMarkers(loadingSeed);
    const placeholderPrefix = replaceFrom.ch > 0 ? "\n" : "";
    const placeholderSuffix = "\n";
    const resolvedTarget = this.plugin.getResolvedAnteTarget();

    let latestProgressText = "";
    const placeholderText = `${placeholderPrefix}${this.wrapPlaceholder(
      markers,
      buildPlaceholderBody(
        loadingSeed,
        loadingFrameIndex,
        resolvedTarget.model,
        latestProgressText,
      ),
    )}${placeholderSuffix}`;

    this.performEditorReplace(editor, () => {
      if (replaceFrom.line === replaceTo.line && replaceFrom.ch === replaceTo.ch) {
        editor.setSelection(replaceTo, replaceTo);
      }
      const insertionStartOffset = editor.posToOffset(replaceFrom);
      editor.replaceRange(placeholderText, replaceFrom, replaceTo);
      editor.setCursor(editor.offsetToPos(insertionStartOffset + placeholderText.length));
    });
    logTmdDebug(`runTaskWithPlaceholder: placeholder inserted`);

    const updateLoading = () => {
      loadingFrameIndex += 1;
      this.replacePlaceholderBody(
        editor,
        markers,
        buildPlaceholderBody(
          loadingSeed,
          loadingFrameIndex,
          resolvedTarget.model,
          latestProgressText,
        ),
        context.filePath,
      );
    };
    const timer = window.setInterval(updateLoading, 800);

    try {
      const taskId = await this.plugin.taskEngine.startDocumentTask({
        presetId,
        triggerSource,
        context,
        inlineInstruction,
      });
      logTmdDebug(`runTaskWithPlaceholder: task started: taskId=${taskId}`);

      let settled = false;
      const unsubscribe = this.plugin.taskEngine.subscribe((state) => {
        if (settled) {
          return;
        }
        const task = state.tasks.find((entry) => entry.id === taskId);
        if (!task) {
          logTmdDebug(`Subscriber: task not found: taskId=${taskId}`);
          settled = true;
          window.clearInterval(timer);
          unsubscribe();
          void this.replacePlaceholderWhole(
            editor,
            markers,
            `> [!warning]\n> \n> Task was cancelled or removed.`,
            context.filePath,
          );
          return;
        }

        logTmdDebug(
          `Subscriber update: taskId=${taskId} status=${task.status} artifacts=${task.artifacts.length} hasTextResult=${!!task.textResult}`,
        );

        if (task.status === "running") {
          latestProgressText = getProgressTextForRunningTask(task);
          return;
        }

        if (task.artifacts.length > 0) {
          const pendingArtifacts = task.artifacts.filter(
            (artifact) => artifact.applyState === "pending",
          );
          const activeArtifacts = task.artifacts.filter(
            (artifact) => artifact.applyState === "applying" || artifact.applyState === "reverting",
          );
          logTmdDebug(
            `Subscriber handling artifacts: pending=${pendingArtifacts.length} active=${activeArtifacts.length}`,
          );
          if (pendingArtifacts.length > 0) {
            settled = true;
            window.clearInterval(timer);
            unsubscribe();

            void (async () => {
              try {
                for (const artifact of pendingArtifacts) {
                  logTmdDebug(
                    `Applying artifact: id=${artifact.id} target=${artifact.target.path}`,
                  );
                  await this.plugin.taskEngine.applyArtifact(task.id, artifact.id);
                }
                logTmdDebug(`Finished applying artifacts, now replacing placeholder whole`);
                await this.replacePlaceholderWhole(
                  editor,
                  markers,
                  `> [!success]\n> \n> Applied directly.`,
                  context.filePath,
                );
              } catch (error) {
                logTmdDebug(
                  `Error applying artifacts: ${error instanceof Error ? error.message : String(error)}`,
                );
                await this.replacePlaceholderWhole(
                  editor,
                  markers,
                  `> [!failure]\n> \n> ${error instanceof Error ? error.message : "Failed to apply change"}`,
                  context.filePath,
                );
              }
            })();
            return;
          }
          if (activeArtifacts.length > 0) {
            return;
          }

          settled = true;
          window.clearInterval(timer);
          unsubscribe();
          const failedArtifact = task.artifacts.find(
            (artifact) => artifact.applyState === "failed",
          );

          void (async () => {
            try {
              if (failedArtifact?.applyError) {
                logTmdDebug(`Artifact failed error: ${failedArtifact.applyError}`);
                await this.replacePlaceholderWhole(
                  editor,
                  markers,
                  `> [!failure]\n> \n> ${failedArtifact.applyError}`,
                  context.filePath,
                );
              } else {
                logTmdDebug(`Artifacts completed, replacing placeholder with success`);
                await this.replacePlaceholderWhole(
                  editor,
                  markers,
                  `> [!success]\n> \n> Applied directly.`,
                  context.filePath,
                );
              }
            } catch (error) {
              logTmdDebug(
                `Error in artifact settled IIFE: ${error instanceof Error ? error.message : String(error)}`,
              );
              console.error("[tmd] Error replacing placeholder for artifacts:", error);
            }
          })();
          return;
        }

        settled = true;
        window.clearInterval(timer);
        unsubscribe();

        void (async () => {
          try {
            if (task.textResult?.text.trim()) {
              logTmdDebug(`TextResult received, length=${task.textResult.text.trim().length}`);
              await this.replacePlaceholderWhole(
                editor,
                markers,
                task.textResult.text.trim(),
                context.filePath,
              );
            } else if (task.error) {
              logTmdDebug(`Task error: ${task.error}`);
              await this.replacePlaceholderWhole(
                editor,
                markers,
                `> [!failure]\n> \n> ${task.error}`,
                context.filePath,
              );
            } else {
              logTmdDebug(`No textResult and no error, replacing with warning`);
              await this.replacePlaceholderWhole(
                editor,
                markers,
                `> [!warning]\n> \n> Ante returned no visible result.`,
                context.filePath,
              );
            }
          } catch (error) {
            logTmdDebug(
              `Error in textResult settled IIFE: ${error instanceof Error ? error.message : String(error)}`,
            );
            console.error("[tmd] Error replacing placeholder whole:", error);
          }
        })();
      });
    } catch (error) {
      logTmdDebug(
        `Error launching document task: ${error instanceof Error ? error.message : String(error)}`,
      );
      window.clearInterval(timer);
      await this.replacePlaceholderWhole(
        editor,
        markers,
        `> [!failure]\n> \n> ${error instanceof Error ? error.message : "Failed to start Ante task"}`,
        context.filePath,
      );
      throw error;
    }
  }

  private resolveMarkdownViewForEditor(editor: Editor): MarkdownView | null {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView?.editor === editor) {
      return activeView;
    }
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.editor === editor) {
        return view;
      }
    }
    return null;
  }

  private resolveEditorForFile(filePath: string): Editor | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === filePath) {
        return view.editor;
      }
    }
    return null;
  }

  private wrapPlaceholder(markers: PlaceholderMarkers, body: string): string {
    return `${markers.blockStart}\n> [!ante]\n${body}\n${markers.blockEnd}`;
  }

  private async replacePlaceholderWhole(
    editor: Editor,
    markers: PlaceholderMarkers,
    replacement: string,
    filePath: string | null,
  ): Promise<void> {
    logTmdDebug(`replacePlaceholderWhole: filePath=${filePath}`);
    let targetEditor = editor;
    if (filePath) {
      const foundEditor = this.resolveEditorForFile(filePath);
      if (foundEditor) {
        targetEditor = foundEditor;
      }
    }

    const content = targetEditor.getValue();
    const startIndex = content.indexOf(markers.blockStart);
    const endIndex = content.indexOf(markers.blockEnd);
    logTmdDebug(
      `replacePlaceholderWhole editor search: startIndex=${startIndex} endIndex=${endIndex} contentLength=${content.length}`,
    );
    if (startIndex >= 0 && endIndex >= 0 && endIndex >= startIndex) {
      const startPosition = targetEditor.offsetToPos(startIndex);
      const endPosition = targetEditor.offsetToPos(endIndex + markers.blockEnd.length);
      logTmdDebug(
        `replacePlaceholderWhole replacing editor range: startLine=${startPosition.line} startCh=${startPosition.ch} endLine=${endPosition.line} endCh=${endPosition.ch}`,
      );
      this.performEditorReplace(targetEditor, () => {
        targetEditor.replaceRange(replacement, startPosition, endPosition);
      });
      return;
    }

    if (filePath) {
      logTmdDebug(`replacePlaceholderWhole fallback: reading file path=${filePath}`);
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        try {
          const fileContent = await this.app.vault.read(file);
          const fStartIndex = fileContent.indexOf(markers.blockStart);
          const fEndIndex = fileContent.indexOf(markers.blockEnd);
          logTmdDebug(
            `replacePlaceholderWhole vault file search: startIndex=${fStartIndex} endIndex=${fEndIndex} fileLength=${fileContent.length}`,
          );
          if (fStartIndex >= 0 && fEndIndex >= 0 && fEndIndex >= fStartIndex) {
            const before = fileContent.slice(0, fStartIndex);
            const after = fileContent.slice(fEndIndex + markers.blockEnd.length);
            const newContent = before + replacement + after;
            await this.app.vault.modify(file, newContent);
            logTmdDebug(`replacePlaceholderWhole fallback: vault file modify completed`);
          } else {
            logTmdDebug(`replacePlaceholderWhole fallback: markers not found in vault file`);
          }
        } catch (error) {
          logTmdDebug(
            `replacePlaceholderWhole fallback error: ${error instanceof Error ? error.message : String(error)}`,
          );
          console.error("[tmd] Failed to fallback replace placeholder in vault file:", error);
        }
      } else {
        logTmdDebug(`replacePlaceholderWhole fallback error: file not TFile`);
      }
    }
  }

  private replacePlaceholderBody(
    editor: Editor,
    markers: PlaceholderMarkers,
    replacement: string,
    filePath: string | null,
  ): void {
    let targetEditor = editor;
    if (filePath) {
      const foundEditor = this.resolveEditorForFile(filePath);
      if (foundEditor) {
        targetEditor = foundEditor;
      }
    }

    const content = targetEditor.getValue();
    const blockStartIndex = content.indexOf(markers.blockStart);
    if (blockStartIndex < 0) {
      return;
    }

    const headerStart = content.indexOf("\n> [!ante]", blockStartIndex);
    if (headerStart < 0) {
      return;
    }

    const headerEnd = content.indexOf("\n", headerStart + 1);
    const endIndex = content.indexOf(`\n${markers.blockEnd}`, headerStart);
    if (headerEnd < 0 || endIndex < 0 || endIndex < headerEnd) {
      return;
    }

    const startPosition = targetEditor.offsetToPos(headerEnd + 1);
    const endPosition = targetEditor.offsetToPos(endIndex);
    this.performEditorReplace(targetEditor, () => {
      targetEditor.replaceRange(replacement, startPosition, endPosition);
    });
  }

  private performEditorReplace(editor: Editor, action: () => void): void {
    this.suppressEditorChangeDepth += 1;
    try {
      action();
    } finally {
      window.setTimeout(() => {
        this.suppressEditorChangeDepth = Math.max(0, this.suppressEditorChangeDepth - 1);
      }, 0);
    }
  }

  private createPlaceholderMarkers(seed: string): PlaceholderMarkers {
    return {
      blockStart: this.encodeInvisibleMarker(`block-start:${seed}`),
      blockEnd: this.encodeInvisibleMarker(`block-end:${seed}`),
    };
  }

  private encodeInvisibleMarker(value: string): string {
    const payload = Array.from(value)
      .map((char) => char.charCodeAt(0).toString(2).padStart(8, "0"))
      .join("1111")
      .replace(/0/g, INVISIBLE_ZERO)
      .replace(/1/g, INVISIBLE_ONE);

    return `${INVISIBLE_SEPARATOR}${payload}${INVISIBLE_SEPARATOR}`;
  }
}
