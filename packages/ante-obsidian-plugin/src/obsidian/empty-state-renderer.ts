export const renderMissingAnteState = (
  container: HTMLElement,
  options: {
    className?: string
    title: string
    description: string
    onOpenSettings: () => void | Promise<void>
    onRefresh: () => void | Promise<void>
  },
): HTMLDivElement => {
  const empty = container.createDiv({
    cls: ["tmd-empty", options.className].filter(Boolean).join(" "),
  })
  empty.createEl("p", { text: options.title })
  empty.createEl("p", {
    cls: "tmd-meta",
    text: options.description,
  })
  const actionsEl = empty.createDiv({ cls: "tmd-empty-actions" })
  const settingsButton = actionsEl.createEl("button", {
    text: "Open settings",
    cls: "mod-cta",
  })
  settingsButton.addEventListener("click", () => {
    void options.onOpenSettings()
  })
  const refreshButton = actionsEl.createEl("button", {
    text: "Refresh runtime",
  })
  refreshButton.addEventListener("click", () => {
    void options.onRefresh()
  })
  return empty
}

export const renderSimpleEmptyState = (
  container: HTMLElement,
  options: {
    className?: string
    title: string
    description?: string
  },
): HTMLDivElement => {
  const empty = container.createDiv({
    cls: ["tmd-empty", options.className].filter(Boolean).join(" "),
  })
  empty.createEl("p", { text: options.title })
  if (options.description) {
    empty.createEl("p", {
      cls: "tmd-meta",
      text: options.description,
    })
  }
  return empty
}
