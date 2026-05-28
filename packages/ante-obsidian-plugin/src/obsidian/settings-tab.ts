import { DropdownComponent, PluginSettingTab, Setting } from "obsidian";
import {
  ANTE_DEFAULT_THINKING,
  ANTE_THINKING_LEVELS,
  type AnteThinkingPreference
} from "../core/ante-thinking";
import type TmdPlugin from "./main";
import {
  ANTHROPIC_PROVIDER,
  GEMINI_PROVIDER,
  normalizeProvider,
  AVAILABLE_PROVIDERS,
} from "./settings";
import { renderSettingsSection } from "./settings-section-renderer";
import {
  applyProviderOverrideSelection,
  getSelectedModelForProvider,
} from "./settings-tab-helpers";
import { SettingsUpdatesRenderer } from "./settings-updates-renderer";
import { SettingsPresetsRenderer } from "./settings-presets-renderer";

type SettingsTabId = "runtime" | "model" | "presets" | "more";

const THINKING_LABELS: Record<AnteThinkingPreference, string> = {
  [ANTE_DEFAULT_THINKING]: "Ante default",
  Disabled: "Disabled",
  Enabled: "Enabled",
  Deep: "Deep",
  Max: "Max"
};

export class TmdSettingTab extends PluginSettingTab {
  private activeTab: SettingsTabId = "runtime";
  private updatesRenderer: SettingsUpdatesRenderer | null = null;

  constructor(private readonly pluginRef: TmdPlugin) {
    super(pluginRef.app, pluginRef);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("tmd-settings");
    containerEl.createEl("h2", { text: "Ante Obsidian Settings" });

    const tabsEl = containerEl.createDiv({ cls: "tmd-settings-tabs" });
    const panelsEl = containerEl.createDiv({ cls: "tmd-settings-panels" });

    const runtimeSectionEl = this.createSettingsSection(
      panelsEl,
      "Runtime",
      "Connection, transport, execution behavior, and runtime diagnostics."
    );
    const modelSectionEl = this.createSettingsSection(
      panelsEl,
      "Model",
      "These settings override Ante defaults for this plugin. Actual availability still depends on your local Ante runtime."
    );
    
    // Delegate Presets rendering to SettingsPresetsRenderer
    const presetsRenderer = new SettingsPresetsRenderer(this.pluginRef, () => this.display());
    const presetsSectionEl = presetsRenderer.render(panelsEl);

    const advancedSectionEl = this.createSettingsSection(
      panelsEl,
      "More",
      "Low-level diagnostics and development-only helpers."
    );

    this.createTabButton(tabsEl, "runtime", "Runtime", runtimeSectionEl);
    this.createTabButton(tabsEl, "model", "Model", modelSectionEl);
    this.createTabButton(tabsEl, "presets", "Presets", presetsSectionEl);
    this.createTabButton(tabsEl, "more", "More", advancedSectionEl);

    // Delegate Updates rendering to SettingsUpdatesRenderer
    if (!this.updatesRenderer) {
      this.updatesRenderer = new SettingsUpdatesRenderer(this.pluginRef, () => this.display());
    }
    this.updatesRenderer.render(runtimeSectionEl);

    new Setting(runtimeSectionEl)
      .setName("Auto-approve Ante tools")
      .setDesc("Automatically approve Ante tool calls inside Ante Obsidian. Default: on.")
      .addToggle((toggle) =>
        toggle.setValue(this.pluginRef.settings.autoApproveAnteTools).onChange(async (value) => {
          this.pluginRef.settings.autoApproveAnteTools = value;
          await this.pluginRef.saveSettings();
        })
      );

    new Setting(runtimeSectionEl)
      .setName("Show full process logs")
      .setDesc("Show detailed runtime process information without hiding noisy system logs or truncating streamed output. Default: off.")
      .addToggle((toggle) =>
        toggle.setValue(this.pluginRef.settings.showFullProcessLogs).onChange(async (value) => {
          this.pluginRef.settings.showFullProcessLogs = value;
          await this.pluginRef.saveSettings();
        })
      );

    new Setting(runtimeSectionEl)
      .setName("Show chat runtime details")
      .setDesc("Show structured telemetry like thinking, token usage, and compaction events in Chat with Ante. Default: on.")
      .addToggle((toggle) =>
        toggle.setValue(this.pluginRef.settings.showChatRuntimeDetails).onChange(async (value) => {
          this.pluginRef.settings.showChatRuntimeDetails = value;
          await this.pluginRef.saveSettings();
        })
      );

    const anteDefaultTarget = this.pluginRef.anteDefaults;
    const resolvedAnteTarget = this.pluginRef.getResolvedAnteTarget();

    new Setting(modelSectionEl)
      .setName("Follow Ante")
      .setDesc("Use provider and model from Ante.")
      .addToggle((toggle) =>
        toggle.setValue(this.pluginRef.settings.useAnteDefaults).onChange(async (value) => {
          this.pluginRef.settings.useAnteDefaults = value;
          await this.pluginRef.saveSettings();
          this.display();
        })
      );

    new Setting(modelSectionEl).setName("Ante default").setDesc(`\`${anteDefaultTarget.provider}\` / \`${anteDefaultTarget.model}\``);

    new Setting(modelSectionEl)
      .setName("Think level")
      .setDesc("Optional plugin-level thinking override. Leave on Ante default to avoid sending a thinking override.")
      .addDropdown((dropdown) =>
        this.addThinkingOptions(dropdown)
          .setValue(this.pluginRef.settings.anteThinking)
          .onChange(async (value) => {
            this.pluginRef.settings.anteThinking = value as AnteThinkingPreference;
            await this.pluginRef.saveSettings();
          })
      );

    if (!this.pluginRef.settings.useAnteDefaults) {
      new Setting(modelSectionEl)
        .setName("Provider override")
        .setDesc("Ask Ante to use this provider. Final support and auth still depend on Ante.")
        .addDropdown((dropdown) => {
          for (const provider of AVAILABLE_PROVIDERS) {
            dropdown.addOption(provider.id, provider.label);
          }
          return dropdown
            .setValue(this.pluginRef.settings.anteProvider)
            .onChange(async (value) => {
              const provider = normalizeProvider(value);
              
              // Update provider first
              this.pluginRef.settings.anteProvider = provider;
              
              // Warm the model catalog from Ante runtime to get fresh list
              try {
                await this.pluginRef.warmAnteModelCatalog({
                  provider,
                  model: "",
                  thinking: this.pluginRef.settings.anteThinking,
                });
              } catch (e) {
                console.warn("Failed to warm model catalog for provider:", provider, e);
                // Continue with fallback to cached or hardcoded models
              }
              
              // Select valid model from loaded list (consistent with chat behavior)
              applyProviderOverrideSelection(
                this.pluginRef.settings,
                value,
                this.pluginRef.getAvailableModelNamesForProvider(provider)
              );
              
              await this.pluginRef.saveSettings();
              this.display();
            })
        });

      new Setting(modelSectionEl)
        .setName("Model override")
        .setDesc("Ask Ante to use this model for the selected provider.")
        .addDropdown((dropdown) =>
          this.addModelOptions(dropdown)
            .setValue(
              getSelectedModelForProvider(
                this.pluginRef.settings.anteModel,
                this.pluginRef.getAvailableModelNamesForProvider(this.pluginRef.settings.anteProvider),
              ),
            )
            .onChange(async (value) => {
              const currentProvider = normalizeProvider(
                this.pluginRef.settings.anteProvider
              );
              const availableModels = this.pluginRef.getAvailableModelNamesForProvider(
                currentProvider
              );
              // Validate model is in available list, fallback to first available if not
              this.pluginRef.settings.anteModel = getSelectedModelForProvider(
                value,
                availableModels
              );
              await this.pluginRef.saveSettings();
            })
        );

      new Setting(modelSectionEl).setName("Scope").setDesc("Overrides apply only in this plugin. Final availability depends on Ante.");
    }

    const effectiveProvider = this.pluginRef.settings.useAnteDefaults ? resolvedAnteTarget.provider : this.pluginRef.settings.anteProvider;

    if (effectiveProvider === GEMINI_PROVIDER) {
      this.renderCredentialSetting(
        modelSectionEl,
        "Gemini API key",
        "Set the env var name Ante reads for x-goog-api-key, and optionally override the local Gemini key here.",
        "GEMINI_API_KEY",
        "AIza...",
        this.pluginRef.settings.geminiApiKeyEnvKey,
        this.pluginRef.settings.geminiApiKey,
        async (value) => {
          this.pluginRef.settings.geminiApiKeyEnvKey = value.trim() || "GEMINI_API_KEY";
          await this.pluginRef.saveSettings();
        },
        async (value) => {
          this.pluginRef.settings.geminiApiKey = value.trim();
          await this.pluginRef.saveSettings();
        }
      );
    }

    if (effectiveProvider === ANTHROPIC_PROVIDER) {
      this.renderCredentialSetting(
        modelSectionEl,
        "Anthropic API key",
        "Set the env var name Ante reads for Anthropic, and optionally override the local API key here.",
        "ANTHROPIC_API_KEY",
        "sk-ant-...",
        this.pluginRef.settings.anthropicApiKeyEnvKey,
        this.pluginRef.settings.anthropicApiKey,
        async (value) => {
          this.pluginRef.settings.anthropicApiKeyEnvKey = value.trim() || "ANTHROPIC_API_KEY";
          await this.pluginRef.saveSettings();
        },
        async (value) => {
          this.pluginRef.settings.anthropicApiKey = value.trim();
          await this.pluginRef.saveSettings();
        }
      );
    }

    new Setting(advancedSectionEl)
      .setName("Mention trigger debug")
      .setDesc("Show a Notice when a mention trigger is detected.")
      .addToggle((toggle) =>
        toggle.setValue(this.pluginRef.settings.mentionTriggerDebug).onChange(async (value) => {
          this.pluginRef.settings.mentionTriggerDebug = value;
          await this.pluginRef.saveSettings();
        })
      );
  }

  private createTabButton(containerEl: HTMLElement, tabId: SettingsTabId, label: string, panelEl: HTMLElement): void {
    const buttonEl = containerEl.createEl("button", {
      text: label,
      cls: `tmd-settings-tab${this.activeTab === tabId ? " is-active" : ""}`
    });
    panelEl.toggleClass("is-active", this.activeTab === tabId);
    buttonEl.addEventListener("click", () => {
      this.activeTab = tabId;
      this.display();
    });
  }

  private createSettingsSection(containerEl: HTMLElement, title: string, summary: string): HTMLDivElement {
    return renderSettingsSection(containerEl, { title, summary });
  }

  private renderCredentialSetting(
    containerEl: HTMLElement,
    name: string,
    description: string,
    envPlaceholder: string,
    keyPlaceholder: string,
    envValue: string,
    keyValue: string,
    onEnvChange: (value: string) => Promise<void>,
    onKeyChange: (value: string) => Promise<void>
  ): void {
    const credentialSetting = new Setting(containerEl).setName(name).setDesc(description);
    credentialSetting.controlEl.addClass("tmd-gemini-setting");

    const envFieldEl = credentialSetting.controlEl.createDiv({ cls: "tmd-gemini-field" });
    envFieldEl.createSpan({ text: "Env key", cls: "tmd-gemini-field-label" });
    new Setting(envFieldEl).addText((text) => {
      text.inputEl.addClass("tmd-gemini-field-input");
      text.setPlaceholder(envPlaceholder).setValue(envValue).onChange((value) => {
        void onEnvChange(value);
      });
    });

    const keyFieldEl = credentialSetting.controlEl.createDiv({ cls: "tmd-gemini-field" });
    keyFieldEl.createSpan({ text: "API key", cls: "tmd-gemini-field-label" });
    new Setting(keyFieldEl).addText((text) => {
      text.inputEl.type = "password";
      text.inputEl.addClass("tmd-gemini-field-input");
      text.setPlaceholder(keyPlaceholder).setValue(keyValue).onChange((value) => {
        void onKeyChange(value);
      });
    });
  }

  private addModelOptions(dropdown: DropdownComponent): DropdownComponent {
    const models = this.pluginRef.getAvailableModelNamesForProvider(this.pluginRef.settings.anteProvider);
    for (const model of models) {
      dropdown.addOption(model, model);
    }
    if (models.length === 0) {
      const model = this.pluginRef.settings.anteModel.trim();
      dropdown.addOption(model, model || "Load models from Ante");
    }
    return dropdown;
  }

  private addThinkingOptions(dropdown: DropdownComponent): DropdownComponent {
    dropdown.addOption(ANTE_DEFAULT_THINKING, THINKING_LABELS[ANTE_DEFAULT_THINKING]);
    for (const thinking of ANTE_THINKING_LEVELS) {
      dropdown.addOption(thinking, THINKING_LABELS[thinking]);
    }
    return dropdown;
  }

  private getSelectedModel(): string {
    return getSelectedModelForProvider(
      this.pluginRef.settings.anteModel,
      this.pluginRef.getAvailableModelNamesForProvider(this.pluginRef.settings.anteProvider),
    );
  }
}
