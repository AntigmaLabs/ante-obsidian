import { Modal, type App } from "obsidian"

export class ChatProviderSwitchModal extends Modal {
  constructor(
    app: App,
    private readonly providerLabel: string,
    private readonly onConfirm: () => void,
  ) {
    super(app)
  }

  onOpen(): void {
    this.modalEl.addClass("tmd-provider-switch-modal")
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl("h3", { text: "Start a new chat?" })
    contentEl.createEl("p", {
      text: `Switching to ${this.providerLabel} starts a new Ante session in a new chat. The current chat will stay unchanged.`,
    })
    const actionsEl = contentEl.createDiv({ cls: "tmd-provider-switch-actions" })
    const confirmButton = actionsEl.createEl("button", {
      text: "Start new chat",
      cls: "mod-cta",
    })
    confirmButton.addEventListener("click", () => {
      this.close()
      this.onConfirm()
    })
    const cancelButton = actionsEl.createEl("button", { text: "Cancel" })
    cancelButton.addEventListener("click", () => {
      this.close()
    })
  }

  onClose(): void {
    this.modalEl.removeClass("tmd-provider-switch-modal")
    this.contentEl.empty()
  }
}
