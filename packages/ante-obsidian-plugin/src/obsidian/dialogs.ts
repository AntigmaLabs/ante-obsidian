import { Modal, Setting } from "obsidian";

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  cta?: boolean;
}

export const showConfirmDialog = (
  app: import("obsidian").App,
  options: ConfirmDialogOptions,
): Promise<boolean> =>
  new Promise((resolve) => {
    const modal = new ConfirmDialog(app, options, resolve);
    modal.open();
  });

export const showPromptDialog = (
  app: import("obsidian").App,
  options: { title: string; initialValue?: string; placeholder?: string; submitText?: string },
): Promise<string | null> =>
  new Promise((resolve) => {
    const modal = new PromptDialog(app, options, resolve);
    modal.open();
  });

class ConfirmDialog extends Modal {
  private didResolve = false;

  constructor(
    app: import("obsidian").App,
    private readonly options: ConfirmDialogOptions,
    private readonly resolve: (value: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    new Setting(contentEl).setName(this.options.title).setHeading();
    contentEl.createEl("p", { text: this.options.message });

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText(this.options.cancelText ?? "Cancel").onClick(() => {
          this.finish(false);
        }),
      )
      .addButton((button) => {
        button.setButtonText(this.options.confirmText ?? "Continue").onClick(() => {
          this.finish(true);
        });
        if (this.options.cta !== false) {
          button.setCta();
        }
      });
  }

  onClose(): void {
    if (!this.didResolve) {
      this.didResolve = true;
      this.resolve(false);
    }
    this.contentEl.empty();
  }

  private finish(value: boolean): void {
    this.didResolve = true;
    this.resolve(value);
    this.close();
  }
}

class PromptDialog extends Modal {
  private inputEl: HTMLInputElement | null = null;
  private didResolve = false;

  constructor(
    app: import("obsidian").App,
    private readonly options: {
      title: string;
      initialValue?: string;
      placeholder?: string;
      submitText?: string;
    },
    private readonly resolve: (value: string | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    new Setting(contentEl).setName(this.options.title).setHeading();

    new Setting(contentEl).addText((text) => {
      this.inputEl = text.inputEl;
      text.setValue(this.options.initialValue ?? "").setPlaceholder(this.options.placeholder ?? "");
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.submit();
        }
      });
    });

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => {
          this.finish(null);
        }),
      )
      .addButton((button) =>
        button
          .setButtonText(this.options.submitText ?? "Save")
          .setCta()
          .onClick(() => {
            this.submit();
          }),
      );

    this.inputEl?.focus();
    this.inputEl?.select();
  }

  onClose(): void {
    if (!this.didResolve) {
      this.didResolve = true;
      this.resolve(null);
    }
    this.contentEl.empty();
  }

  private submit(): void {
    this.finish(this.inputEl?.value ?? "");
  }

  private finish(value: string | null): void {
    this.didResolve = true;
    this.resolve(value);
    this.close();
  }
}
