import { shouldHandlePromptEnter, shouldStopFromPromptShortcut } from "../core/terminal-input";

export interface TerminalPromptWiringOptions {
  editorEl: HTMLDivElement;
  stopButtonEl: HTMLButtonElement;
  getEditorText: () => string;
  getIsComposing: () => boolean;
  setIsComposing: (value: boolean) => void;
  getHasRunningTask: () => boolean;
  onDraftChange: (text: string) => void;
  onStop: () => void;
  onSubmit: () => void;
  onNavigateHistory: (direction: "up" | "down") => void;
}

export const wireTerminalPrompt = (options: TerminalPromptWiringOptions): void => {
  options.stopButtonEl.addEventListener("click", () => {
    options.onStop();
  });

  options.editorEl.addEventListener("input", () => {
    const text = options.getEditorText();
    options.editorEl.classList.toggle("tmd-is-empty", text.length === 0);
    options.onDraftChange(text);
  });
  options.editorEl.addEventListener("compositionstart", () => {
    options.setIsComposing(true);
  });
  options.editorEl.addEventListener("compositionend", () => {
    options.setIsComposing(false);
  });
  options.editorEl.addEventListener("keydown", (event) => {
    if (
      shouldStopFromPromptShortcut({
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        key: event.key,
      })
    ) {
      if (options.getHasRunningTask()) {
        event.preventDefault();
        options.onStop();
        return;
      }
    }
    if (
      !shouldHandlePromptEnter({
        isComposing: options.getIsComposing(),
        eventIsComposing: event.isComposing,
      })
    ) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      options.onSubmit();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      options.onNavigateHistory("up");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      options.onNavigateHistory("down");
    }
  });
};
