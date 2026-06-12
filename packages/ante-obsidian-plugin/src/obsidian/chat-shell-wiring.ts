import { shouldHandlePromptEnter } from "../core/terminal-input";

export interface ChatSidebarWiringOptions {
  sidebarToggleEl: HTMLButtonElement;
  newChatButtonEl: HTMLButtonElement;
  onToggleSidebar: () => void;
  onCreateChat: () => void;
}

export const wireChatSidebar = (options: ChatSidebarWiringOptions): void => {
  options.sidebarToggleEl.addEventListener("click", () => {
    options.onToggleSidebar();
  });
  options.newChatButtonEl.addEventListener("click", () => {
    options.onCreateChat();
  });
};

export interface ChatComposerWiringOptions {
  composerEl: HTMLTextAreaElement;
  composerActionButtonEl: HTMLButtonElement;
  getIsComposing: () => boolean;
  setIsComposing: (value: boolean) => void;
  onInput: () => void;
  onSubmit: () => void;
  onStop: () => void;
}

export const wireChatComposer = (options: ChatComposerWiringOptions): void => {
  options.composerEl.addEventListener("compositionstart", () => {
    options.setIsComposing(true);
  });
  options.composerEl.addEventListener("compositionend", () => {
    options.setIsComposing(false);
  });
  options.composerEl.addEventListener("input", () => {
    options.onInput();
  });
  options.composerEl.addEventListener("keydown", (event) => {
    if (
      !shouldHandlePromptEnter({
        isComposing: options.getIsComposing(),
        eventIsComposing: event.isComposing,
      })
    ) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      options.onSubmit();
    }
  });

  options.composerActionButtonEl.addEventListener("click", () => {
    if (options.composerActionButtonEl.dataset.action === "stop") {
      options.onStop();
      return;
    }
    options.onSubmit();
  });
};
