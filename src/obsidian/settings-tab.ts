import { PluginSettingTab, Setting } from "obsidian";
import type TmdPlugin from "./main";

export class TmdSettingTab extends PluginSettingTab {
  constructor(private readonly pluginRef: TmdPlugin) {
    super(pluginRef.app, pluginRef);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Tmd Settings" });

    new Setting(containerEl)
      .setName("Ante command")
      .setDesc('Executable used to launch Ante. Default: `ante`.')
      .addText((text) =>
        text.setValue(this.pluginRef.settings.command).onChange(async (value) => {
          this.pluginRef.settings.command = value.trim();
          await this.pluginRef.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Ante arguments JSON")
      .setDesc('JSON string array passed to Ante. Default: `["serve","--stdio","--yolo"]`.')
      .addTextArea((text) =>
        text.setValue(this.pluginRef.settings.argsJson).onChange(async (value) => {
          this.pluginRef.settings.argsJson = value;
          await this.pluginRef.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Working directory")
      .setDesc("Optional working directory used when launching Ante. Leave empty to inherit the current environment.")
      .addText((text) =>
        text.setValue(this.pluginRef.settings.cwd).onChange(async (value) => {
          this.pluginRef.settings.cwd = value;
          await this.pluginRef.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Ante model")
      .setDesc("Model passed to StartSession. This is a project default, not a machine-specific requirement.")
      .addText((text) =>
        text.setValue(this.pluginRef.settings.anteModel).onChange(async (value) => {
          this.pluginRef.settings.anteModel = value.trim();
          await this.pluginRef.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Ante provider")
      .setDesc("Provider passed to StartSession. This is a project default, not a machine-specific requirement.")
      .addText((text) =>
        text.setValue(this.pluginRef.settings.anteProvider).onChange(async (value) => {
          this.pluginRef.settings.anteProvider = value.trim();
          await this.pluginRef.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Mention trigger debug")
      .setDesc("Show a Notice when a mention trigger is detected.")
      .addToggle((toggle) =>
        toggle.setValue(this.pluginRef.settings.mentionTriggerDebug).onChange(async (value) => {
          this.pluginRef.settings.mentionTriggerDebug = value;
          await this.pluginRef.saveSettings();
        })
      );
  }
}
