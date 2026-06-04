import { PluginSettingTab, Setting, DropdownComponent, Notice, setIcon } from "obsidian";
import {
  ANTE_DEFAULT_THINKING,
  ANTE_THINKING_LEVELS,
  type AnteThinkingPreference
} from "../core/ante-thinking";
import type TmdPlugin from "./main";
import {
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
      "These settings override Ante CLI defaults for this plugin. Actual availability still depends on your local Ante CLI."
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

    if (this.pluginRef.isAnteInstalled() && this.isProviderCredentialMissing(resolvedAnteTarget.provider)) {
      const warningEl = modelSectionEl.createDiv({ cls: "tmd-settings-warning-banner" });
      const targetProvider = resolvedAnteTarget.provider;
      const meta = this.pluginRef.getProviderMeta(targetProvider);
      const providerLabel = this.pluginRef.getProviderLabel(targetProvider);

      if (this.pluginRef.settings.useAnteDefaults) {
        warningEl.createDiv({
          text: `⚠️ Credential missing: No active session found for '${providerLabel}'. Please choose one of the following to resolve:`,
          cls: "tmd-settings-warning-title"
        });
        const listEl = warningEl.createEl("ol", { cls: "tmd-settings-warning-list" });
        listEl.createEl("li", {
          text: `Run the 'ante' command in your terminal to complete the authentication config in the local Ante CLI.`
        });
        listEl.createEl("li", {
          text: `Or, turn off 'Follow Ante CLI' below to directly select and configure an API Key for your preferred provider inside the plugin settings.`
        });
      } else {
        warningEl.createDiv({
          text: `⚠️ API Key missing: Your '${providerLabel}' API key is not configured. Please resolve using one of the following methods:`,
          cls: "tmd-settings-warning-title"
        });
        const listEl = warningEl.createEl("ol", { cls: "tmd-settings-warning-list" });
        listEl.createEl("li", {
          text: `Enter your ${providerLabel} API key directly below, or ensure the environment variable '${meta?.envKey || ""}' is set in your system shell.`
        });
        listEl.createEl("li", {
          text: `Or, choose another provider from the 'Provider override' dropdown below and configure its API key.`
        });
        listEl.createEl("li", {
          text: `Or, run the 'ante' command in your terminal to complete the configuration/auth in the local Ante CLI, and then enable 'Follow Ante CLI' below.`
        });
      }
    }

    new Setting(modelSectionEl)
      .setName("Follow Ante CLI")
      .setDesc(`Use provider and model from Ante CLI. Current default: \`${anteDefaultTarget.provider}\` / \`${anteDefaultTarget.model}\``)
      .addToggle((toggle) =>
        toggle.setValue(this.pluginRef.settings.useAnteDefaults).onChange(async (value) => {
          this.pluginRef.settings.useAnteDefaults = value;
          await this.pluginRef.saveSettings();
          this.display();
        })
      );

    if (!this.pluginRef.settings.useAnteDefaults) {
      // ── Provider override ──────────────────────────────────────────────────
      // Only shows API-key providers (no OAuth/subscription providers).
      const overrideProviders = this.pluginRef.getOverrideProviders();
      if (overrideProviders.length === 0) {
        const hintEl = modelSectionEl.createDiv({ cls: "tmd-settings-warning-banner" });
        hintEl.createDiv({
          text: `⚠️ No provider catalog: run the 'ante' command once, or update Ante (the 'ante catalog' command requires a newer version), then reopen settings.`,
          cls: "tmd-settings-warning-title"
        });
      } else {
        new Setting(modelSectionEl)
          .setName("Provider override")
          .setDesc("Ask Ante to use this provider. Subscription providers (OAuth) are managed via the Ante TUI and excluded here.")
          .addDropdown((dropdown) => {
            for (const provider of overrideProviders) {
              dropdown.addOption(provider.id, provider.label);
            }
            // Ensure current value is in the override list; fall back to first entry
            const currentProvider = this.pluginRef.settings.anteProvider;
            const validId = overrideProviders.some((p) => p.id === currentProvider)
              ? currentProvider
              : (overrideProviders[0]?.id ?? currentProvider);
            return dropdown
              .setValue(validId)
              .onChange(async (value) => {
                const provider = normalizeProvider(value);

                // Update provider first
                this.pluginRef.settings.anteProvider = provider;

                // Select a valid model from the catalog list (consistent with chat behavior)
                applyProviderOverrideSelection(
                  this.pluginRef.settings,
                  value,
                  this.pluginRef.getAvailableModelNamesForProvider(provider)
                );

                await this.pluginRef.saveSettings();
                // Re-render to show the new provider's credential + model fields.
                this.display();
              });
          });
      }

      // ── API key section (dynamic per provider) ─────────────────────────────
      // Determine the effective provider for credential rendering.
      // When "Follow Ante CLI" is off, use the override; otherwise the resolved default.
      const effectiveProvider = this.pluginRef.settings.anteProvider;
      this.renderProviderCredentialSetting(modelSectionEl, effectiveProvider);
      this.renderCustomModelsSetting(modelSectionEl, effectiveProvider);
    } else {
      // "Follow Ante CLI" is on — show credentials for whatever the resolved provider is.
      const effectiveProvider = resolvedAnteTarget.provider;
      this.renderProviderCredentialSetting(modelSectionEl, effectiveProvider);
      this.renderCustomModelsSetting(modelSectionEl, effectiveProvider);
    }

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
      cls: `tmd-settings-tab${this.activeTab === tabId ? " is-active" : ""}`
    });
    buttonEl.createSpan({ text: label });
    if (this.shouldShowTabDot(tabId)) {
      const dotEl = buttonEl.createSpan({ cls: "tmd-tab-dot tmd-pulse" });
      if (tabId === "runtime") {
        dotEl.addClass("is-warning");
      } else if (tabId === "model") {
        dotEl.addClass("is-danger");
      }
    }
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
    const meta = this.pluginRef.getProviderMeta(providerId);
    if (!meta || meta.authType !== "api-key" || !meta.envKey) {
      // local (authType "none") and OAuth providers need no credential UI
      return;
    }
    const defaultEnvKey = meta.envKey;

    const existing: ProviderKeyConfig = this.pluginRef.settings.providerKeys[providerId] ?? {
      envKey: defaultEnvKey,
      apiKey: "",
    };

    let envValue = existing.envKey || defaultEnvKey;
    let keyValue = existing.apiKey;

    const checkDetected = (env: string, key: string): boolean => {
      const hasShellKey = env ? Boolean(this.pluginRef.shellEnv[env]?.trim()) : false;
      const hasProcessKey = (env && typeof process !== "undefined" && process.env)
        ? Boolean(process.env[env]?.trim())
        : false;
      return (hasShellKey || hasProcessKey) && !key.trim();
    };

    const isEnvKeyDetected = checkDetected(envValue, keyValue);
    let updateElements: ((env: string, key: string) => void) | null = null;

    this.renderCredentialSetting(
      containerEl,
      `${meta.label} API key`,
      `Set the env var name Ante reads for ${meta.label}, and optionally enter the key directly here.`,
      defaultEnvKey,
      meta.keyPlaceholder ?? "",
      envValue,
      keyValue,
      isEnvKeyDetected,
      (badgeEl, hintEl) => {
        updateElements = (env, key) => {
          const detected = checkDetected(env, key);
          badgeEl.style.display = detected ? "inline-flex" : "none";
          hintEl.style.display = detected ? "block" : "none";
        };
      },
      async (value) => {
        envValue = value.trim() || defaultEnvKey;
        this.pluginRef.settings.providerKeys[providerId] = {
          ...existing,
          envKey: envValue,
          apiKey: keyValue,
        };
        // Keep legacy flat fields in sync for Gemini/Anthropic
        this.syncLegacyKeyFields(providerId);
        await this.pluginRef.saveSettings();
        if (updateElements) {
          updateElements(envValue, keyValue);
        }
      },
      async (value) => {
        keyValue = value.trim();
        this.pluginRef.settings.providerKeys[providerId] = {
          ...existing,
          envKey: envValue,
          apiKey: keyValue,
        };
        this.syncLegacyKeyFields(providerId);
        await this.pluginRef.saveSettings();
        if (updateElements) {
          updateElements(envValue, keyValue);
        }
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
    isEnvKeyDetected: boolean,
    registerElements: (badgeEl: HTMLSpanElement, hintEl: HTMLDivElement) => void,
    onEnvChange: (value: string) => Promise<void>,
    onKeyChange: (value: string) => Promise<void>
  ): void {
    const credentialSetting = new Setting(containerEl).setName(name).setDesc(description);
    credentialSetting.settingEl.addClass("tmd-vertical-setting");
    credentialSetting.controlEl.addClass("tmd-gemini-setting");

    const envFieldEl = credentialSetting.controlEl.createDiv({ cls: "tmd-gemini-field" });
    const labelRow = envFieldEl.createDiv({ cls: "tmd-field-label-row" });
    labelRow.createSpan({ text: "Env key", cls: "tmd-gemini-field-label" });
    
    const badgeEl = labelRow.createSpan({
      text: "✓ Detected in shell environment",
      cls: "tmd-env-detected-badge"
    });
    if (!isEnvKeyDetected) {
      badgeEl.style.display = "none";
    }

    new Setting(envFieldEl).addText((text) => {
      text.inputEl.addClass("tmd-gemini-field-input");
      text.setPlaceholder(envPlaceholder).setValue(envValue).onChange((value) => {
        void onEnvChange(value);
      });
    });

    const keyFieldEl = credentialSetting.controlEl.createDiv({ cls: "tmd-gemini-field" });
    const keyLabelRow = keyFieldEl.createDiv({ cls: "tmd-field-label-row" });
    keyLabelRow.createSpan({ text: "API key", cls: "tmd-gemini-field-label" });
    
    const hintEl = keyFieldEl.createDiv({
      text: "Already detected in environment. No need to enter, but you can choose to override.",
      cls: "tmd-api-key-hint-override"
    });
    if (!isEnvKeyDetected) {
      hintEl.style.display = "none";
    }
    
    registerElements(badgeEl, hintEl);

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
    const meta = this.pluginRef.getProviderMeta(providerId);
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

  private isProviderCredentialMissing(providerId: string): boolean {
    const meta = this.pluginRef.getProviderMeta(providerId);
    if (!meta) return true;
    if (meta.authType === "none") {
      return false; // local - no auth needed
    }
    if (meta.authType === "oauth") {
      try {
        const { homedir } = require("node:os");
        const { join } = require("node:path");
        const { existsSync } = require("node:fs");
        const anteHome = (typeof process !== "undefined" && process.env?.ANTE_HOME) || join(homedir(), ".ante");
        // The OAuth preset id doubles as the auth-file basename Ante writes.
        if (!meta.oauthPreset) return true;
        return !existsSync(join(anteHome, "auth", `${meta.oauthPreset}.json`));
      } catch {
        return true;
      }
    }
    // api-key
    const keyConfig = this.pluginRef.settings.providerKeys[providerId];
    const envKey = keyConfig?.envKey || meta.envKey || "";
    const hasDirectKey = Boolean(keyConfig?.apiKey?.trim());
    const hasShellKey = envKey ? Boolean(this.pluginRef.shellEnv[envKey]?.trim()) : false;
    const hasProcessKey = (envKey && typeof process !== "undefined" && process.env) ? Boolean(process.env[envKey]?.trim()) : false;
    return !(hasDirectKey || hasShellKey || hasProcessKey);
  }

  private shouldShowTabDot(tabId: SettingsTabId): boolean {
    const isInstalled = this.pluginRef.isAnteInstalled();
    if (tabId === "runtime") {
      return !isInstalled;
    }
    if (tabId === "model") {
      if (!isInstalled) {
        return false; // Don't show model warning if CLI is not even installed yet
      }
      const target = this.pluginRef.getResolvedAnteTarget();
      return this.isProviderCredentialMissing(target.provider);
    }
    return false;
  }

  private addThinkingOptions(dropdown: DropdownComponent): DropdownComponent {
    dropdown.addOption(ANTE_DEFAULT_THINKING, THINKING_LABELS[ANTE_DEFAULT_THINKING]);
    for (const thinking of ANTE_THINKING_LEVELS) {
      dropdown.addOption(thinking, THINKING_LABELS[thinking]);
    }
    return dropdown;
  }
}
