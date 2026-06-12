export const renderSettingsSection = (
  containerEl: HTMLElement,
  options: {
    title: string;
    summary: string;
    className?: string;
  },
): HTMLDivElement => {
  const sectionEl = containerEl.createDiv({
    cls: ["tmd-settings-section", options.className].filter(Boolean).join(" "),
  });
  sectionEl.dataset.sectionTitle = options.title;
  const copyEl = sectionEl.createDiv({ cls: "tmd-settings-section-copy" });
  copyEl.createEl("p", {
    text: options.summary,
    cls: "tmd-settings-section-summary",
  });
  return sectionEl;
};
