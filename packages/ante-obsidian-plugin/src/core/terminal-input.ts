export interface PromptHistoryState {
  promptHistory: string[];
  historyIndex: number;
  draftPrompt: string;
  nextText: string;
}

export interface PromptKeydownState {
  isComposing: boolean;
  eventIsComposing?: boolean;
}

export interface PromptStopShortcutState {
  ctrlKey: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  key: string;
}

export const shouldHandlePromptEnter = (
  state: PromptKeydownState,
): boolean =>
  !state.isComposing &&
  !Boolean(state.eventIsComposing)

export const shouldStopFromPromptShortcut = (
  state: PromptStopShortcutState,
): boolean =>
  state.ctrlKey &&
  !Boolean(state.metaKey) &&
  !Boolean(state.shiftKey) &&
  !Boolean(state.altKey) &&
  state.key.toLowerCase() === "c"

export const navigatePromptHistory = (
  promptHistory: string[],
  historyIndex: number,
  draftPrompt: string,
  currentText: string,
  direction: "up" | "down",
): PromptHistoryState => {
  if (promptHistory.length === 0) {
    return {
      promptHistory,
      historyIndex,
      draftPrompt,
      nextText: currentText,
    }
  }

  if (direction === "up") {
    if (historyIndex === -1) {
      return {
        promptHistory,
        historyIndex: promptHistory.length - 1,
        draftPrompt: currentText,
        nextText: promptHistory[promptHistory.length - 1] ?? "",
      }
    }
    const nextIndex = Math.max(0, historyIndex - 1)
    return {
      promptHistory,
      historyIndex: nextIndex,
      draftPrompt,
      nextText: promptHistory[nextIndex] ?? "",
    }
  }

  if (historyIndex === -1) {
    return {
      promptHistory,
      historyIndex,
      draftPrompt,
      nextText: currentText,
    }
  }

  if (historyIndex < promptHistory.length - 1) {
    const nextIndex = historyIndex + 1
    return {
      promptHistory,
      historyIndex: nextIndex,
      draftPrompt,
      nextText: promptHistory[nextIndex] ?? "",
    }
  }

  return {
    promptHistory,
    historyIndex: -1,
    draftPrompt,
    nextText: draftPrompt,
  }
}
