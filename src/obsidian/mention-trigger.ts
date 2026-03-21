import { Editor, MarkdownView, Notice, type App } from "obsidian";
import { parseMentionLine } from "../core/mention-parser";
import { buildParagraphSelection } from "../core/paragraph-selection";
import type { TmdState } from "../core/types";
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
    const line = editor.getLine(cursor.line);
    const match = parseMentionLine(line);
    const lineKey = `${view.file.path}:${cursor.line}:${line}`;

    if (!match) {
      for (const key of [...this.handledKeys]) {
        if (key.startsWith(`${view.file.path}:${cursor.line}:`)) {
          this.handledKeys.delete(key);
        }
      }
      return;
    }

    if (this.handledKeys.has(lineKey)) {
      return;
    }

    const paragraphSelection = buildParagraphSelection(editor, cursor.line, match.start);
    const activeContext = await this.plugin.hostAdapter.getActiveContext();
    if (!activeContext) {
      return;
    }

    const context =
      activeContext.selection?.text.trim()
        ? activeContext
        : {
            ...activeContext,
            selection: paragraphSelection
              ? {
                  text: paragraphSelection.text,
                  from: paragraphSelection.from,
                  to: paragraphSelection.to
                }
              : null
          };

    this.handledKeys.add(lineKey);
    this.running = true;

    if (this.isDebugEnabled()) {
      new Notice(`Triggered ${line.slice(match.start, match.end)}`);
    }

    try {
      await this.runInlineMention(editor, cursor.line, line.slice(match.start, match.end), match.inlineInstruction, context, match.presetId);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Inline Ante trigger failed");
    } finally {
      this.running = false;
    }
  }

  private async runInlineMention(
    editor: Editor,
    triggerLine: number,
    triggerToken: string,
    inlineInstruction: string,
    context: Awaited<ReturnType<TmdPlugin["hostAdapter"]["getActiveContext"]>>,
    presetId: Parameters<TmdPlugin["runMentionTask"]>[0]
  ): Promise<void> {
    if (!context) {
      throw new Error("Open a Markdown note before using @ante");
    }

    const loadingFrames = ["*", "**", "***", "**"];
    let loadingFrameIndex = 0;
    const markers = this.createPlaceholderMarkers(crypto.randomUUID());
    const insertAt = {
      line: triggerLine,
      ch: editor.getLine(triggerLine).length
    };

    this.performEditorReplace(editor, () => {
      editor.replaceRange(`\n\n${this.wrapPlaceholder(markers, triggerToken, `> ${loadingFrames[loadingFrameIndex]} Running…`)}`, insertAt);
    });

    const updateLoading = () => {
      loadingFrameIndex = (loadingFrameIndex + 1) % loadingFrames.length;
      this.replacePlaceholderBody(editor, markers, `> ${loadingFrames[loadingFrameIndex]} Running…`);
    };
    const timer = window.setInterval(updateLoading, 800);

    const taskId = await this.plugin.runMentionTask(presetId, context, inlineInstruction);
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
          void (async () => {
            try {
              for (const artifact of pendingArtifacts) {
                await this.plugin.taskEngine.applyArtifact(task.id, artifact.id);
              }
            } catch (error) {
              settled = true;
              window.clearInterval(timer);
              unsubscribe();
              this.replacePlaceholderWhole(
                editor,
                markers,
                `> [!failure] ${triggerToken}\n> \n> ${error instanceof Error ? error.message : "Failed to apply change"}`
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
          this.replacePlaceholderWhole(editor, markers, `> [!failure] ${triggerToken}\n> \n> ${failedArtifact.applyError}`);
          return;
        }

        this.replacePlaceholderWhole(editor, markers, `> [!success] ${triggerToken}\n> \n> Applied directly. Open Tmd Results if you want to inspect the diff or revert the change.`);
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
        this.replacePlaceholderWhole(editor, markers, `> [!failure] ${triggerToken}\n> \n> ${task.error}`);
        return;
      }

      this.replacePlaceholderWhole(editor, markers, `> [!warning] ${triggerToken}\n> \n> Ante returned no visible result.`);
    });
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

  private wrapPlaceholder(markers: PlaceholderMarkers, triggerToken: string, body: string): string {
    return `${markers.blockStart}\n> [!ai] ${triggerToken}\n${body}\n${markers.blockEnd}`;
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

    const headerStart = content.indexOf("\n> [!ai] ", blockStartIndex);
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
