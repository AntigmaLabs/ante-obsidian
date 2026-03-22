import { DropdownComponent, PluginSettingTab, Setting } from "obsidian";
import type TmdPlugin from "./main";
import {
  ANTHROPIC_PROVIDER,
  GEMINI_PROVIDER,
  OPENAI_PROVIDER,
  PROVIDER_MODELS,
  getDefaultModelForProvider,
  normalizeProvider
} from "./settings";

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
      .setName("Auto-approve Ante tools")
      .setDesc("Automatically approve Ante tool calls inside Tmd. Default: on.")
      .addToggle((toggle) =>
        toggle.setValue(this.pluginRef.settings.autoApproveAnteTools).onChange(async (value) => {
          this.pluginRef.settings.autoApproveAnteTools = value;
          await this.pluginRef.saveSettings();
        })
      );

    const resolvedAnteTarget = this.pluginRef.getResolvedAnteTarget();

    new Setting(containerEl)
      .setName("Use Ante defaults")
      .setDesc(`Read provider/model from ~/.ante/settings.json. Current detected: \`${resolvedAnteTarget.provider}\` / \`${resolvedAnteTarget.model}\`.`)
      .addToggle((toggle) =>
        toggle.setValue(this.pluginRef.settings.useAnteDefaults).onChange(async (value) => {
          this.pluginRef.settings.useAnteDefaults = value;
          await this.pluginRef.saveSettings();
          this.display();
        })
      );

    if (!this.pluginRef.settings.useAnteDefaults) {
      new Setting(containerEl)
        .setName("Ante provider")
        .setDesc("Matches Ante provider naming. `openai-subscription` uses your ChatGPT subscription; `gemini` uses Gemini API credentials.")
        .addDropdown((dropdown) =>
          dropdown
            .addOption(OPENAI_PROVIDER, "OpenAI Subscription")
            .addOption(GEMINI_PROVIDER, "Gemini API")
            .addOption(ANTHROPIC_PROVIDER, "Anthropic API")
            .setValue(this.pluginRef.settings.anteProvider)
            .onChange(async (value) => {
              const provider = normalizeProvider(value);
              this.pluginRef.settings.anteProvider = provider;
              this.pluginRef.settings.anteModel = getDefaultModelForProvider(provider);
              await this.pluginRef.saveSettings();
              this.display();
            })
        );

      new Setting(containerEl)
        .setName("Ante model")
        .setDesc("Model options follow the selected Ante provider.")
        .addDropdown((dropdown) =>
          this.addModelOptions(dropdown)
            .setValue(this.getSelectedModel())
            .onChange(async (value) => {
              this.pluginRef.settings.anteModel = value;
              await this.pluginRef.saveSettings();
            })
        );
    }

    if ((this.pluginRef.settings.useAnteDefaults ? resolvedAnteTarget.provider : this.pluginRef.settings.anteProvider) === GEMINI_PROVIDER) {
      new Setting(containerEl)
        .setName("Gemini env key")
        .setDesc("Ante expects Gemini auth via header `x-goog-api-key` sourced from this environment variable. Default: `GEMINI_API_KEY`.")
        .addText((text) =>
          text.setPlaceholder("GEMINI_API_KEY").setValue(this.pluginRef.settings.geminiApiKeyEnvKey).onChange(async (value) => {
            this.pluginRef.settings.geminiApiKeyEnvKey = value.trim() || "GEMINI_API_KEY";
            await this.pluginRef.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName("Gemini API key")
        .setDesc("Optional local override. Leave empty to reuse the key already available to Ante in your environment.")
        .addText((text) => {
          text.inputEl.type = "password";
          text.setPlaceholder("AIza...");
          text.setValue(this.pluginRef.settings.geminiApiKey);
          text.onChange(async (value) => {
            this.pluginRef.settings.geminiApiKey = value.trim();
            await this.pluginRef.saveSettings();
          });
        });
    }

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

  private addModelOptions(dropdown: DropdownComponent): DropdownComponent {
    const models = PROVIDER_MODELS[this.pluginRef.settings.anteProvider];
    for (const model of models) {
      dropdown.addOption(model, model);
    }
    return dropdown;
  }

  private getSelectedModel(): string {
    const models = PROVIDER_MODELS[this.pluginRef.settings.anteProvider];
    return models.includes(this.pluginRef.settings.anteModel as (typeof models)[number])
      ? this.pluginRef.settings.anteModel
      : getDefaultModelForProvider(this.pluginRef.settings.anteProvider);
  }
}
