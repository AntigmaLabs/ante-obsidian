import { Editor, MarkdownView, Notice, type App } from "obsidian";
import { formatLoadingLabel } from "../core/loading-label";
import { resolveMentionTrigger } from "../core/mention-trigger-state";
import { buildParagraphSelection } from "../core/paragraph-selection";
import type { ContextSnapshot, PresetId, TaskTriggerSource } from "../core/types";
import type TmdPlugin from "./main";

const INVISIBLE_ZERO = "\u200B";
const INVISIBLE_ONE = "\u200C";
const INVISIBLE_SEPARATOR = "\u2063";

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
    private readonly isDebugEnabled: () => boolean
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
      previousLine
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
            ch: matchText.length
          }
        }
      : null;
    const activeContext = await this.plugin.hostAdapter.getActiveContext();
    if (!activeContext) {
      return;
    }

    const context =
      activeContext.selection?.text.trim()
        ? activeContext
        : {
            ...activeContext,
            selection: mentionSelection
              ? {
                  text: mentionSelection.text,
                  from: mentionSelection.from,
                  to: mentionSelection.to
                }
              : null
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
        ch: match.start
      };
      const replaceTo = {
        line: matchLine,
        ch: triggerLineText.length
      };

      await this.runTaskWithPlaceholder({
        editor,
        replaceFrom,
        replaceTo,
        context,
        presetId: match.presetId,
        inlineInstruction: match.inlineInstruction,
        triggerSource: "mention"
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
      triggerSource = "mention"
    } = options;
    let loadingFrameIndex = 0;
    const loadingSeed = window.crypto.randomUUID();
    const markers = this.createPlaceholderMarkers(loadingSeed);
    const placeholderPrefix = replaceFrom.ch > 0 ? "\n\n" : "";
    const placeholderSuffix = "\n\n";
    const placeholderText = `${placeholderPrefix}${this.wrapPlaceholder(
      markers,
      `> ${formatLoadingLabel(loadingSeed, loadingFrameIndex)}`
    )}${placeholderSuffix}`;

    this.performEditorReplace(editor, () => {
      if (replaceFrom.line === replaceTo.line && replaceFrom.ch === replaceTo.ch) {
        editor.setSelection(replaceTo, replaceTo);
      }
      const insertionStartOffset = editor.posToOffset(replaceFrom);
      editor.replaceRange(placeholderText, replaceFrom, replaceTo);
      editor.setCursor(editor.offsetToPos(insertionStartOffset + placeholderText.length));
    });

    const updateLoading = () => {
      loadingFrameIndex += 1;
      this.replacePlaceholderBody(editor, markers, `> ${formatLoadingLabel(loadingSeed, loadingFrameIndex)}`);
    };
    const timer = window.setInterval(updateLoading, 800);

    try {
      const taskId = await this.plugin.taskEngine.startDocumentTask({
        presetId,
        triggerSource,
        context,
        inlineInstruction
      });

      let settled = false;
      const unsubscribe = this.plugin.taskEngine.subscribe((state) => {
        if (settled) {
          return;
        }
        const task = state.tasks.find((entry) => entry.id === taskId);
        if (!task) {
          return;
        }

        if (task.status === "running") {
          return;
        }

        if (task.artifacts.length > 0) {
          const pendingArtifacts = task.artifacts.filter((artifact) => artifact.applyState === "pending");
          const activeArtifacts = task.artifacts.filter(
            (artifact) => artifact.applyState === "applying" || artifact.applyState === "reverting"
          );
          if (pendingArtifacts.length > 0) {
            settled = true;
            window.clearInterval(timer);
            unsubscribe();

            void (async () => {
              try {
                for (const artifact of pendingArtifacts) {
                  await this.plugin.taskEngine.applyArtifact(task.id, artifact.id);
                }
                this.replacePlaceholderWhole(editor, markers, `> [!success]\n> \n> Applied directly.`);
              } catch (error) {
                this.replacePlaceholderWhole(
                  editor,
                  markers,
                  `> [!failure]\n> \n> ${error instanceof Error ? error.message : "Failed to apply change"}`
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
          const failedArtifact = task.artifacts.find((artifact) => artifact.applyState === "failed");
          if (failedArtifact?.applyError) {
            this.replacePlaceholderWhole(editor, markers, `> [!failure]\n> \n> ${failedArtifact.applyError}`);
            return;
          }

          this.replacePlaceholderWhole(
            editor,
            markers,
            `> [!success]\n> \n> Applied directly.`
          );
          return;
        }

        settled = true;
        window.clearInterval(timer);
        unsubscribe();

        if (task.textResult?.text.trim()) {
          this.replacePlaceholderWhole(editor, markers, task.textResult.text.trim());
          return;
        }

        if (task.error) {
          this.replacePlaceholderWhole(editor, markers, `> [!failure]\n> \n> ${task.error}`);
          return;
        }

        this.replacePlaceholderWhole(editor, markers, `> [!warning]\n> \n> Ante returned no visible result.`);
      });
    } catch (error) {
      window.clearInterval(timer);
      this.replacePlaceholderWhole(
        editor,
        markers,
        `> [!failure]\n> \n> ${error instanceof Error ? error.message : "Failed to start Ante task"}`
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

  private wrapPlaceholder(markers: PlaceholderMarkers, body: string): string {
    return `${markers.blockStart}\n> [!ante]\n${body}\n${markers.blockEnd}`;
  }

  private replacePlaceholderWhole(editor: Editor, markers: PlaceholderMarkers, replacement: string): void {
    const content = editor.getValue();
    const startIndex = content.indexOf(markers.blockStart);
    const endIndex = content.indexOf(markers.blockEnd);
    if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
      return;
    }

    const startPosition = editor.offsetToPos(startIndex);
    const endPosition = editor.offsetToPos(endIndex + markers.blockEnd.length);
    this.performEditorReplace(editor, () => {
      editor.replaceRange(replacement, startPosition, endPosition);
    });
  }

  private replacePlaceholderBody(editor: Editor, markers: PlaceholderMarkers, replacement: string): void {
    const content = editor.getValue();
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

    const startPosition = editor.offsetToPos(headerEnd + 1);
    const endPosition = editor.offsetToPos(endIndex);
    this.performEditorReplace(editor, () => {
      editor.replaceRange(replacement, startPosition, endPosition);
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
      blockEnd: this.encodeInvisibleMarker(`block-end:${seed}`)
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
