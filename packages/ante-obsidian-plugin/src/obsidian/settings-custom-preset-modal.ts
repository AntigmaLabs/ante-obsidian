import { Modal, Notice, Setting } from "obsidian";
import type TmdPlugin from "./main";
import { listResolvedPresets } from "../core/presets";

export class CustomPresetModal extends Modal {
  private nameValue: string;
  private instructionValue: string;

  constructor(
    private readonly pluginRef: TmdPlugin,
    private readonly onSaved: () => void,
    private readonly existingPreset: {
      id: string;
      name: string;
      instruction: string;
      enabled: boolean;
      sortOrder: number;
      interactionMode?: "inline" | "panel";
    } | null = null,
  ) {
    super(pluginRef.app);
    this.nameValue = existingPreset?.name ?? "";
    this.instructionValue = existingPreset?.instruction ?? "";
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("tmd-preset-modal");
    contentEl.empty();
    const titleSetting = new Setting(contentEl)
      .setName(this.existingPreset ? "Edit Custom Preset" : "Add Custom Preset")
      .setHeading();
    titleSetting.settingEl.addClass("tmd-preset-modal-title");

    const nameSetting = new Setting(contentEl)
      .setName("Preset name")
      .setDesc("Shown in the editor context menu.")
      .addText((text) => {
        text.setPlaceholder("Custom preset");
        text.setValue(this.nameValue);
        text.inputEl.focus();
        text.onChange((value) => {
          this.nameValue = value;
        });
      });
    nameSetting.settingEl.addClass("tmd-preset-modal-setting");

    const instructionSetting = new Setting(contentEl)
      .setName("Instruction")
      .setDesc("Used as the preset execution instructions.")
      .addTextArea((text) =>
        text
          .setPlaceholder(
            "Describe how this preset should operate on the current Markdown context.",
          )
          .setValue(this.instructionValue)
          .onChange((value) => {
            this.instructionValue = value;
          }),
      );
    instructionSetting.settingEl.addClass("tmd-preset-modal-setting", "is-textarea");

    const actionSetting = new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText("Confirm")
          .setCta()
          .onClick(async () => {
            await this.savePreset();
          }),
      )
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => {
          this.close();
        }),
      );
    actionSetting.settingEl.addClass("tmd-preset-modal-actions");
  }

  onClose(): void {
    this.modalEl.removeClass("tmd-preset-modal");
    this.contentEl.empty();
  }

  private async savePreset(): Promise<void> {
    const name = this.nameValue.trim();
    const instruction = this.instructionValue.trim();

    if (!name) {
      new Notice("Preset name is required");
      return;
    }
    if (!instruction) {
      new Notice("Instruction is required");
      return;
    }

    if (this.existingPreset) {
      const preset = this.pluginRef.settings.customPresets.find(
        (entry) => entry.id === this.existingPreset?.id,
      );
      if (!preset) {
        new Notice("Custom preset no longer exists");
        return;
      }
      preset.name = name;
      preset.instruction = instruction;
    } else {
      this.pluginRef.settings.customPresets.push({
        id: `custom-${crypto.randomUUID()}`,
        name,
        instruction,
        enabled: true,
        sortOrder: listResolvedPresets(this.pluginRef.settings).length,
        interactionMode: "inline",
      });
    }
    this.pluginRef.settings.customPresets.sort((left, right) => left.sortOrder - right.sortOrder);
    await this.pluginRef.saveSettings();
    this.close();
    this.onSaved();
  }
}
