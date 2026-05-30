import { PluginSettingTab, Setting, DropdownComponent, Notice, setIcon } from "obsidian";
import {
  ANTE_DEFAULT_THINKING,
  ANTE_THINKING_LEVELS,
  type AnteThinkingPreference
} from "../core/ante-thinking";
import type TmdPlugin from "./main";
import {
  AVAILABLE_PROVIDERS,
  OVERRIDE_PROVIDERS,
  normalizeProvider,
  type ProviderKeyConfig,
} from "./settings";
import { renderSettingsSection } from "./settings-section-renderer";
import { applyProviderOverrideSelection } from "./settings-tab-helpers";
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
  private isWarmingProvider = false;
  private warmingSessionId = 0;

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
      .setDesc(`Use provider and model from Ante. Current default: \`${anteDefaultTarget.provider}\` / \`${anteDefaultTarget.model}\``)
      .addToggle((toggle) =>
        toggle.setValue(this.pluginRef.settings.useAnteDefaults).onChange(async (value) => {
          this.pluginRef.settings.useAnteDefaults = value;
          await this.pluginRef.saveSettings();
          this.display();
        })
      );

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
      // ── Provider override ──────────────────────────────────────────────────
      // Only shows API-key providers (no OAuth/subscription providers).
      new Setting(modelSectionEl)
        .setName("Provider override")
        .setDesc(
          this.isWarmingProvider
            ? "Ask Ante to use this provider. Subscription providers (OAuth) are managed via the Ante TUI and excluded here. (🔄 Fetching model list from Ante...)"
            : "Ask Ante to use this provider. Subscription providers (OAuth) are managed via the Ante TUI and excluded here."
        )
        .addDropdown((dropdown) => {
          for (const provider of OVERRIDE_PROVIDERS) {
            dropdown.addOption(provider.id, provider.label);
          }
          // Ensure current value is in the override list; fall back to first entry
          const currentProvider = this.pluginRef.settings.anteProvider;
          const validId = OVERRIDE_PROVIDERS.some((p) => p.id === currentProvider)
            ? currentProvider
            : (OVERRIDE_PROVIDERS[0]?.id ?? currentProvider);
          return dropdown
            .setValue(validId)
            .onChange(async (value) => {
              const provider = normalizeProvider(value);

              // Update provider first
              this.pluginRef.settings.anteProvider = provider;

              // Select valid model from loaded list (consistent with chat behavior)
              applyProviderOverrideSelection(
                this.pluginRef.settings,
                value,
                this.pluginRef.getAvailableModelNamesForProvider(provider)
              );

              await this.pluginRef.saveSettings();

              // Set warming loading state and re-render instantly to display updated key fields
              const currentSessionId = ++this.warmingSessionId;
              this.isWarmingProvider = true;
              this.display();

              // Warm the model catalog from Ante runtime to get fresh list
              setTimeout(async () => {
                try {
                  await this.pluginRef.warmAnteModelCatalog({
                    provider,
                    model: "",
                    thinking: this.pluginRef.settings.anteThinking,
                  });
                } catch (e) {
                  console.warn("Failed to warm model catalog for provider:", provider, e);
                  // Continue with fallback to cached or default models
                } finally {
                  if (currentSessionId === this.warmingSessionId) {
                    this.isWarmingProvider = false;
                    this.display();
                  }
                }
              }, 50);
            });
        });

      // ── API key section (dynamic per provider) ─────────────────────────────
      // Determine the effective provider for credential rendering.
      // When "Follow Ante" is off, use the override; otherwise the resolved default.
      const effectiveProvider = this.pluginRef.settings.anteProvider;
      this.renderProviderCredentialSetting(modelSectionEl, effectiveProvider);
      this.renderCustomModelsSetting(modelSectionEl, effectiveProvider);
    } else {
      // "Follow Ante" is on — show credentials for whatever the resolved provider is.
      const effectiveProvider = resolvedAnteTarget.provider;
      this.renderProviderCredentialSetting(modelSectionEl, effectiveProvider);
      this.renderCustomModelsSetting(modelSectionEl, effectiveProvider);
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

  /**
   * Dynamically render API key fields for the given provider.
   * Reads the provider's metadata to determine the correct label, env key name,
   * and placeholder. OAuth providers and local provider show nothing.
   */
  private renderProviderCredentialSetting(containerEl: HTMLElement, providerId: string): void {
    const meta = AVAILABLE_PROVIDERS.find((p) => p.id === providerId);
    if (!meta || meta.authType !== "api-key" || !meta.defaultEnvKey) {
      // local (authType "none") and OAuth providers need no credential UI
      return;
    }

    const existing: ProviderKeyConfig = this.pluginRef.settings.providerKeys[providerId] ?? {
      envKey: meta.defaultEnvKey,
      apiKey: "",
    };

    this.renderCredentialSetting(
      containerEl,
      `${meta.label} API key`,
      this.isWarmingProvider
        ? `Set the env var name Ante reads for ${meta.label}, and optionally enter the key directly here. (🔄 Fetching model list from Ante...)`
        : `Set the env var name Ante reads for ${meta.label}, and optionally enter the key directly here.`,
      meta.defaultEnvKey,
      meta.keyPlaceholder ?? "",
      existing.envKey || meta.defaultEnvKey,
      existing.apiKey,
      async (value) => {
        this.pluginRef.settings.providerKeys[providerId] = {
          ...existing,
          envKey: value.trim() || meta.defaultEnvKey!,
        };
        // Keep legacy flat fields in sync for Gemini/Anthropic
        this.syncLegacyKeyFields(providerId);
        await this.pluginRef.saveSettings();
      },
      async (value) => {
        this.pluginRef.settings.providerKeys[providerId] = {
          ...existing,
          apiKey: value.trim(),
        };
        this.syncLegacyKeyFields(providerId);
        await this.pluginRef.saveSettings();
      }
    );
  }

  /** Keep the legacy flat fields (geminiApiKey etc.) in sync with providerKeys. */
  private syncLegacyKeyFields(providerId: string): void {
    const cfg = this.pluginRef.settings.providerKeys[providerId];
    if (!cfg) return;
    if (providerId === "gemini") {
      this.pluginRef.settings.geminiApiKey = cfg.apiKey;
      this.pluginRef.settings.geminiApiKeyEnvKey = cfg.envKey;
    } else if (providerId === "anthropic") {
      this.pluginRef.settings.anthropicApiKey = cfg.apiKey;
      this.pluginRef.settings.anthropicApiKeyEnvKey = cfg.envKey;
    }
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
    credentialSetting.settingEl.addClass("tmd-vertical-setting");
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
    
    const inputContainer = keyFieldEl.createDiv({ cls: "tmd-api-key-container" });
    let textInput: HTMLInputElement;
    new Setting(inputContainer).addText((text) => {
      textInput = text.inputEl;
      textInput.type = "password";
      textInput.addClass("tmd-gemini-field-input");
      text.setPlaceholder(keyPlaceholder).setValue(keyValue).onChange((value) => {
        void onKeyChange(value);
      });
    });

    const toggleBtn = inputContainer.createEl("button", {
      cls: "clickable-icon tmd-api-key-toggle-btn",
      attr: { type: "button", title: "Show API key" }
    });
    setIcon(toggleBtn, "eye");

    toggleBtn.addEventListener("click", () => {
      if (textInput.type === "password") {
        textInput.type = "text";
        setIcon(toggleBtn, "eye-off");
        toggleBtn.setAttribute("title", "Hide API key");
      } else {
        textInput.type = "password";
        setIcon(toggleBtn, "eye");
        toggleBtn.setAttribute("title", "Show API key");
      }
    });
  }

  private renderCustomModelsSetting(containerEl: HTMLElement, providerId: string): void {
    const meta = AVAILABLE_PROVIDERS.find((p) => p.id === providerId);
    if (!meta) return;

    // We only support custom models for non-oauth providers
    if (meta.authType === "oauth") {
      return;
    }

    const setting = new Setting(containerEl)
      .setName(`${meta.label} custom models`)
      .setDesc("Add or manage custom model IDs that will be merged into your available model list.");
    setting.settingEl.addClass("tmd-vertical-setting");

    // Tailor descriptions to be common and standard
    let placeholder = "e.g. custom-model-name";

    if (providerId === "openrouter") {
      placeholder = "e.g. anthropic/claude-3-5-sonnet";
    } else if (providerId === "openai-compatible") {
      placeholder = "e.g. qwen-max";
    } else if (providerId === "openai") {
      placeholder = "e.g. ft:gpt-4o-mini:my-org:...";
    } else if (providerId === "local") {
      placeholder = "e.g. llama3:8b";
    }

    const managerEl = setting.controlEl.createDiv({ cls: "tmd-custom-models-manager" });

    // 1. Render existing list using custom compact model list styling
    const currentModels = this.pluginRef.settings.customModels[providerId] ?? [];
    if (currentModels.length > 0) {
      const listEl = managerEl.createDiv({ cls: "tmd-preset-list" });
      currentModels.forEach((model, index) => {
        const rowEl = listEl.createDiv({ cls: "tmd-custom-model-preset-row" });
        
        const contentEl = rowEl.createDiv({ cls: "tmd-custom-model-preset-content" });
        
        const copyEl = contentEl.createDiv({ cls: "tmd-custom-model-preset-copy" });
        copyEl.createDiv({ cls: "tmd-custom-model-preset-name", text: model });
        
        const controlsEl = contentEl.createDiv({ cls: "tmd-preset-controls" });
        controlsEl.style.minWidth = "auto";
        controlsEl.style.flex = "0 0 auto";
        
        const deleteBtn = controlsEl.createEl("button", { cls: "clickable-icon tmd-preset-icon-button" });
        deleteBtn.setAttribute("aria-label", `Remove ${model}`);
        setIcon(deleteBtn, "trash");
        
        deleteBtn.addEventListener("click", async () => {
          const updated = [...currentModels];
          updated.splice(index, 1);
          if (updated.length > 0) {
            this.pluginRef.settings.customModels[providerId] = updated;
          } else {
            delete this.pluginRef.settings.customModels[providerId];
          }
          await this.pluginRef.saveSettings();
          this.display(); // Refresh settings tab to reflect changes
        });
      });
    }

    // 2. Render input row to add new model
    const addRowEl = managerEl.createDiv({ cls: "tmd-custom-model-add-row" });
    let inputEl: HTMLInputElement;
    new Setting(addRowEl).addText((text) => {
      inputEl = text.inputEl;
      inputEl.addClass("tmd-gemini-field-input");
      text.setPlaceholder(placeholder);
    });

    const addBtn = addRowEl.createEl("button", {
      cls: "tmd-custom-model-add-btn mod-cta",
      text: "Add",
      attr: { type: "button" }
    });

    const doAdd = async () => {
      const val = inputEl.value.trim();
      if (!val) return;

      const current = this.pluginRef.settings.customModels[providerId] ?? [];
      if (!current.includes(val)) {
        this.pluginRef.settings.customModels[providerId] = [...current, val];
        await this.pluginRef.saveSettings();
        this.display(); // Refresh settings tab to reflect changes
      } else {
        new Notice("Model ID already exists in custom list");
      }
    };

    addBtn.addEventListener("click", doAdd);
    inputEl!.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void doAdd();
      }
    });
  }

  private addThinkingOptions(dropdown: DropdownComponent): DropdownComponent {
    dropdown.addOption(ANTE_DEFAULT_THINKING, THINKING_LABELS[ANTE_DEFAULT_THINKING]);
    for (const thinking of ANTE_THINKING_LEVELS) {
      dropdown.addOption(thinking, THINKING_LABELS[thinking]);
    }
    return dropdown;
  }
}
