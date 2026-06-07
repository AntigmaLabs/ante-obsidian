import { Notice, Setting, setIcon } from "obsidian";
import type TmdPlugin from "./main";
import { listResolvedPresets } from "../core/presets";
import { CustomPresetModal } from "./settings-custom-preset-modal";
import { renderSettingsSection } from "./settings-section-renderer";
import { showConfirmDialog } from "./dialogs";

export class SettingsPresetsRenderer {
  private draggingPresetId: string | null = null;

  constructor(
    private readonly pluginRef: TmdPlugin,
    private readonly onStateChanged: () => void
  ) {}

  render(containerEl: HTMLElement): HTMLDivElement {
    const sectionEl = renderSettingsSection(containerEl, {
      title: "Presets",
      summary: "Manage reusable actions, visibility, and the order shown in the editor menu."
    });
    sectionEl.addClass("tmd-preset-section");

    const headerRow = sectionEl.createDiv({ cls: "tmd-preset-toolbar" });
    const titleGroup = headerRow.createDiv({ cls: "tmd-preset-toolbar-copy" });
    titleGroup.createEl("div", { text: "Preset Library", cls: "tmd-preset-title" });

    const summary = titleGroup.createEl("p", { cls: "tmd-preset-summary" });
    summary.setText("Built-in and custom presets share one ordered library.");

    const newPresetButton = headerRow.createEl("button", { text: "New preset", cls: "mod-cta" });
    newPresetButton.addClass("tmd-preset-new-button");
    newPresetButton.addEventListener("click", () => {
      new CustomPresetModal(this.pluginRef, () => this.onStateChanged()).open();
    });

    const presets = listResolvedPresets(this.pluginRef.settings);
    const listEl = sectionEl.createDiv({ cls: "tmd-preset-list" });

    for (const preset of presets) {
      const isBuiltin = preset.source === "builtin";
      const typeLabel = isBuiltin ? "Built-in" : "Custom";
      const statusLabel = preset.enabled !== false ? "Visible" : "Hidden";
      const rowEl = listEl.createDiv({ cls: "tmd-preset-row" });
      rowEl.dataset.presetId = preset.id;
      const handleEl = rowEl.createDiv({ cls: "tmd-preset-handle" });
      handleEl.setAttribute("aria-label", `Drag to reorder ${preset.label}`);
      handleEl.draggable = true;
      for (let index = 0; index < 9; index += 1) {
        handleEl.createSpan({ cls: "tmd-preset-handle-dot" });
      }

      handleEl.addEventListener("dragstart", (event) => {
        this.draggingPresetId = preset.id;
        rowEl.addClass("is-dragging");
        event.dataTransfer?.setData("text/plain", preset.id);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
        }
      });

      handleEl.addEventListener("dragend", () => {
        this.draggingPresetId = null;
        this.clearPresetDragStyles(listEl);
      });

      rowEl.addEventListener("dragover", (event) => {
        if (!this.draggingPresetId || this.draggingPresetId === preset.id) {
          return;
        }
        event.preventDefault();
        this.clearPresetDragStyles(listEl);
        rowEl.addClass("is-drop-target");
        const rect = rowEl.getBoundingClientRect();
        rowEl.toggleClass("is-drop-after", event.clientY >= rect.top + rect.height / 2);
      });

      rowEl.addEventListener("dragleave", () => {
        rowEl.removeClass("is-drop-target", "is-drop-after");
      });

      rowEl.addEventListener("drop", async (event) => {
        if (!this.draggingPresetId || this.draggingPresetId === preset.id) {
          return;
        }
        event.preventDefault();
        const rect = rowEl.getBoundingClientRect();
        const insertAfter = event.clientY >= rect.top + rect.height / 2;
        await this.reorderPreset(this.draggingPresetId, preset.id, insertAfter);
      });

      const contentEl = rowEl.createDiv({ cls: "tmd-preset-content" });
      const copyEl = contentEl.createDiv({ cls: "tmd-preset-copy" });
      copyEl.createDiv({ cls: "tmd-preset-name", text: preset.label });
      copyEl.createDiv({ cls: "tmd-preset-meta", text: `${typeLabel} · ${statusLabel}` });

      const controlsEl = contentEl.createDiv({ cls: "tmd-preset-controls" });
      const toggleSetting = new Setting(controlsEl);
      toggleSetting.settingEl.addClass("tmd-preset-toggle-setting");
      toggleSetting.addToggle((toggle) =>
        toggle.setValue(preset.enabled !== false).onChange(async (value) => {
          await this.setPresetEnabled(preset.id, value, isBuiltin);
        })
      );

      const editButton = controlsEl.createEl("button", { cls: "clickable-icon" });
      editButton.addClass("tmd-preset-icon-button");
      if (isBuiltin) {
        editButton.disabled = true;
        editButton.setAttribute("aria-label", "Built-in preset content is fixed");
        setIcon(editButton, "lock");
      } else {
        editButton.setAttribute("aria-label", `Edit ${preset.label}`);
        setIcon(editButton, "pencil");
        editButton.addEventListener("click", () => {
          new CustomPresetModal(
            this.pluginRef,
            () => this.onStateChanged(),
            this.pluginRef.settings.customPresets.find((entry) => entry.id === preset.id) ?? null
          ).open();
        });
      }

      const deleteButton = controlsEl.createEl("button", { cls: "clickable-icon" });
      deleteButton.addClass("tmd-preset-icon-button");
      if (isBuiltin) {
        deleteButton.disabled = true;
        deleteButton.setAttribute("aria-label", "Built-in preset cannot be deleted");
        setIcon(deleteButton, "minus");
      } else {
        deleteButton.setAttribute("aria-label", `Delete ${preset.label}`);
        setIcon(deleteButton, "trash");
        deleteButton.addEventListener("click", async () => {
          await this.deleteCustomPreset(preset.id);
        });
      }
    }
    return sectionEl;
  }

  private async setPresetEnabled(presetId: string, enabled: boolean, isBuiltin: boolean): Promise<void> {
    if (isBuiltin) {
      const preset = this.pluginRef.settings.builtinPresetPreferences.find((entry) => entry.id === presetId);
      if (preset) {
        preset.enabled = enabled;
      }
    } else {
      const preset = this.pluginRef.settings.customPresets.find((entry) => entry.id === presetId);
      if (preset) {
        preset.enabled = enabled;
      }
    }
    await this.pluginRef.saveSettings();
    this.onStateChanged();
  }

  private async reorderPreset(sourcePresetId: string, targetPresetId: string, insertAfter: boolean): Promise<void> {
    const ordered = listResolvedPresets(this.pluginRef.settings);
    const sourceIndex = ordered.findIndex((preset) => preset.id === sourcePresetId);
    const targetIndex = ordered.findIndex((preset) => preset.id === targetPresetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
      return;
    }

    const [moved] = ordered.splice(sourceIndex, 1);
    const adjustedTargetIndex = ordered.findIndex((preset) => preset.id === targetPresetId);
    const insertionIndex = insertAfter ? adjustedTargetIndex + 1 : adjustedTargetIndex;
    ordered.splice(insertionIndex, 0, moved);

    this.applyPresetOrder(ordered);
    await this.pluginRef.saveSettings();
    this.draggingPresetId = null;
    this.onStateChanged();
  }

  private async deleteCustomPreset(presetId: string): Promise<void> {
    const preset = this.pluginRef.settings.customPresets.find((entry) => entry.id === presetId);
    if (!preset) {
      return;
    }

    const confirmed =
      !preset.instruction.trim() ||
      (await showConfirmDialog(this.pluginRef.app, {
        title: "Delete preset",
        message: `Delete custom preset "${preset.name}"?`,
        confirmText: "Delete"
      }));

    if (confirmed) {
      this.pluginRef.settings.customPresets = this.pluginRef.settings.customPresets.filter((entry) => entry.id !== presetId);
      this.applyPresetOrder();
      await this.pluginRef.saveSettings();
      this.onStateChanged();
      return;
    }

    new Notice("Deletion cancelled");
  }

  private applyPresetOrder(ordered = listResolvedPresets(this.pluginRef.settings)): void {
    ordered.forEach((preset, sortOrder) => {
      if (preset.source === "builtin") {
        const builtin = this.pluginRef.settings.builtinPresetPreferences.find((entry) => entry.id === preset.id);
        if (builtin) {
          builtin.sortOrder = sortOrder;
        }
      } else {
        const custom = this.pluginRef.settings.customPresets.find((entry) => entry.id === preset.id);
        if (custom) {
          custom.sortOrder = sortOrder;
        }
      }
    });
    this.pluginRef.settings.builtinPresetPreferences.sort((left, right) => left.sortOrder - right.sortOrder);
    this.pluginRef.settings.customPresets.sort((left, right) => left.sortOrder - right.sortOrder);
  }

  private clearPresetDragStyles(listEl: HTMLElement): void {
    for (const row of Array.from(listEl.querySelectorAll<HTMLElement>(".tmd-preset-row"))) {
      row.removeClass("is-dragging", "is-drop-target", "is-drop-after");
    }
  }
}
