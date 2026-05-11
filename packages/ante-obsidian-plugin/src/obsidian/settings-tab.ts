import { DropdownComponent, Modal, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import {
  ANTE_DEFAULT_THINKING,
  ANTE_THINKING_LEVELS,
  type AnteThinkingPreference
} from "../core/ante-thinking";
import { listResolvedPresets } from "../core/presets";
import type TmdPlugin from "./main";
import type { AnteVersionCheckResult } from "./ante-updater";
import type { PluginVersionCheckResult } from "./plugin-updater";
import {
  ANTIX_PROVIDER,
  ANTHROPIC_PROVIDER,
  GEMINI_PROVIDER,
  OPENAI_PROVIDER,
  PROVIDER_MODELS,
  getDefaultModelForProvider,
  normalizeProvider
} from "./settings";
import { renderSettingsSection } from "./settings-section-renderer";
import {
  applyProviderOverrideSelection,
  getSelectedModelForProvider,
} from "./settings-tab-helpers";

type SettingsTabId = "runtime" | "model" | "presets" | "more";

const THINKING_LABELS: Record<AnteThinkingPreference, string> = {
  [ANTE_DEFAULT_THINKING]: "Ante default",
  Disabled: "Disabled",
  Enabled: "Enabled",
  Deep: "Deep",
  Max: "Max"
};

export class TmdSettingTab extends PluginSettingTab {
  private draggingPresetId: string | null = null;
  private anteVersionState: AnteVersionCheckResult | null = null;
  private pluginVersionState: PluginVersionCheckResult | null = null;
  private checkingAnteVersion = false;
  private checkingPluginVersion = false;
  private upgradingAnte = false;
  private activeTab: SettingsTabId = "runtime";

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
    const presetsSectionEl = this.renderPresetSection(panelsEl);
    const advancedSectionEl = this.createSettingsSection(
      panelsEl,
      "More",
      "Low-level diagnostics and development-only helpers."
    );

    this.createTabButton(tabsEl, "runtime", "Runtime", runtimeSectionEl);
    this.createTabButton(tabsEl, "model", "Model", modelSectionEl);
    this.createTabButton(tabsEl, "presets", "Presets", presetsSectionEl);
    this.createTabButton(tabsEl, "more", "More", advancedSectionEl);

    this.renderUpdatesSectionContent(runtimeSectionEl);

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
        .addDropdown((dropdown) =>
          dropdown
            .addOption(OPENAI_PROVIDER, "OpenAI Subscription")
            .addOption(GEMINI_PROVIDER, "Gemini API")
            .addOption(ANTHROPIC_PROVIDER, "Anthropic API")
            .addOption(ANTIX_PROVIDER, "Antix")
            .setValue(this.pluginRef.settings.anteProvider)
            .onChange(async (value) => {
              applyProviderOverrideSelection(this.pluginRef.settings, value);
              await this.pluginRef.saveSettings();
              this.display();
            })
        );

      new Setting(modelSectionEl)
        .setName("Model override")
        .setDesc("Ask Ante to use this model for the selected provider.")
        .addDropdown((dropdown) =>
          this.addModelOptions(dropdown)
            .setValue(
              getSelectedModelForProvider(
                this.pluginRef.settings.anteProvider,
                this.pluginRef.settings.anteModel,
              ),
            )
            .onChange(async (value) => {
              this.pluginRef.settings.anteModel = value;
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

  private renderUpdatesSectionContent(containerEl: HTMLElement): void {
    const sectionEl = containerEl.createDiv({ cls: "tmd-updates-section is-active" });
    sectionEl.createEl("p", {
      text: "Check plugin and local runtime update status.",
      cls: "tmd-ante-update-summary"
    });

    const listEl = sectionEl.createDiv({ cls: "tmd-updates-list" });
    this.renderPluginUpdateItem(listEl);
    this.renderAnteUpdateItem(listEl);
    this.renderObsidianCliItem(listEl);

    if (!this.pluginVersionState && !this.checkingPluginVersion) {
      void this.refreshPluginVersionState();
    }
    if (!this.anteVersionState && !this.checkingAnteVersion) {
      void this.refreshAnteVersionState();
    }
  }

  private renderPluginUpdateItem(containerEl: HTMLElement): void {
    const itemEl = containerEl.createDiv({ cls: `tmd-update-item ${this.getPluginStatusTone()}` });
    const iconEl = itemEl.createDiv({ cls: "tmd-update-item-icon" });
    setIcon(iconEl, this.getPluginStatusIcon());

    const bodyEl = itemEl.createDiv({ cls: "tmd-update-item-body" });
    const headerEl = bodyEl.createDiv({ cls: "tmd-update-item-header" });
    const titleRowEl = headerEl.createDiv({ cls: "tmd-update-item-title-row" });
    titleRowEl.createSpan({ cls: "tmd-update-item-title", text: "Ante Obsidian" });
    titleRowEl.createSpan({ cls: "tmd-update-item-status", text: this.getPluginUpdateStatusLabel() });

    bodyEl.createDiv({
      cls: "tmd-update-item-summary",
      text: this.getPluginUpdateSummary()
    });
    bodyEl.createDiv({
      cls: "tmd-update-item-meta",
      text: this.getPluginUpdateMeta()
    });

    const actionsEl = itemEl.createDiv({ cls: "tmd-update-item-actions" });
    const checkButton = actionsEl.createEl("button");
    checkButton.addClass("tmd-update-item-button");
    this.decorateAnteActionButton(
      checkButton,
      this.checkingPluginVersion ? "loader-circle" : "refresh-cw",
      this.checkingPluginVersion ? "Checking" : "Check"
    );
    checkButton.disabled = this.checkingPluginVersion;
    checkButton.addEventListener("click", () => {
      void this.refreshPluginVersionState();
    });

    if (this.pluginVersionState?.latestUrl) {
      const openButton = actionsEl.createEl("button", {
        cls: this.pluginVersionState.updateAvailable ? "mod-cta" : ""
      });
      openButton.addClass("tmd-update-item-button");
      this.decorateAnteActionButton(
        openButton,
        "external-link",
        this.pluginVersionState.updateAvailable ? "Open release" : "Open repo"
      );
      openButton.addEventListener("click", () => {
        window.open(this.pluginVersionState?.latestUrl, "_blank", "noopener");
      });
    }
  }

  private renderAnteUpdateItem(containerEl: HTMLElement): void {
    const itemEl = containerEl.createDiv({ cls: `tmd-update-item ${this.getAnteStatusTone()}` });
    const iconEl = itemEl.createDiv({ cls: "tmd-update-item-icon" });
    setIcon(iconEl, this.getAnteStatusIcon());

    const bodyEl = itemEl.createDiv({ cls: "tmd-update-item-body" });
    const headerEl = bodyEl.createDiv({ cls: "tmd-update-item-header" });
    const titleRowEl = headerEl.createDiv({ cls: "tmd-update-item-title-row" });
    titleRowEl.createSpan({ cls: "tmd-update-item-title", text: "Ante Runtime" });
    titleRowEl.createSpan({ cls: "tmd-update-item-status", text: this.getAnteUpdateStatusLabel() });

    bodyEl.createDiv({
      cls: "tmd-update-item-summary",
      text: this.getAnteUpdateSummary()
    });
    bodyEl.createDiv({
      cls: "tmd-update-item-meta",
      text: this.getAnteUpdateMeta()
    });

    const actionsEl = itemEl.createDiv({ cls: "tmd-update-item-actions" });
    const checkButton = actionsEl.createEl("button");
    checkButton.addClass("tmd-update-item-button");
    this.decorateAnteActionButton(
      checkButton,
      this.checkingAnteVersion ? "loader-circle" : "refresh-cw",
      this.checkingAnteVersion ? "Checking" : "Check"
    );
    checkButton.disabled = this.checkingAnteVersion || this.upgradingAnte;
    checkButton.addEventListener("click", () => {
      void this.refreshAnteVersionState();
    });

    if (this.anteVersionState?.updateAvailable || (!this.anteVersionState?.localVersion && !!this.anteVersionState?.latestVersion)) {
      const upgradeButton = actionsEl.createEl("button", { cls: "mod-cta" });
      upgradeButton.addClass("tmd-update-item-button");
      this.decorateAnteActionButton(
        upgradeButton,
        this.upgradingAnte ? "loader-circle" : this.anteVersionState?.localVersion ? "arrow-up-circle" : "download",
        this.upgradingAnte ? "Upgrading" : this.anteVersionState?.localVersion ? "Upgrade" : "Install"
      );
      upgradeButton.disabled = this.checkingAnteVersion || this.upgradingAnte;
      upgradeButton.addEventListener("click", () => {
        void this.handleAnteUpgrade();
      });
    }
  }

  private renderObsidianCliItem(containerEl: HTMLElement): void {
    const cliStatus = this.pluginRef.getObsidianCliStatus();
    const itemEl = containerEl.createDiv({ cls: `tmd-update-item ${this.getObsidianCliStatusTone()}` });
    const iconEl = itemEl.createDiv({ cls: "tmd-update-item-icon" });
    setIcon(iconEl, this.getObsidianCliStatusIcon());

    const bodyEl = itemEl.createDiv({ cls: "tmd-update-item-body" });
    const headerEl = bodyEl.createDiv({ cls: "tmd-update-item-header" });
    const titleRowEl = headerEl.createDiv({ cls: "tmd-update-item-title-row" });
    titleRowEl.createSpan({ cls: "tmd-update-item-title", text: "Obsidian CLI" });
    titleRowEl.createSpan({ cls: "tmd-update-item-status", text: this.getObsidianCliStatusLabel() });

    bodyEl.createDiv({
      cls: "tmd-update-item-summary",
      text: this.getObsidianCliSummary()
    });
    bodyEl.createDiv({
      cls: "tmd-update-item-meta",
      text: this.getObsidianCliMeta()
    });

    const actionsEl = itemEl.createDiv({ cls: "tmd-update-item-actions" });
    const toggleButton = actionsEl.createEl("button", {
      cls: cliStatus.available && this.pluginRef.settings.allowObsidianCli ? "mod-cta" : ""
    });
    toggleButton.addClass("tmd-update-item-button");
    this.decorateAnteActionButton(
      toggleButton,
      cliStatus.available ? (this.pluginRef.settings.allowObsidianCli ? "toggle-right" : "toggle-left") : "circle-slash",
      cliStatus.available ? (this.pluginRef.settings.allowObsidianCli ? "Enabled" : "Disabled") : "Unavailable"
    );
    toggleButton.disabled = !cliStatus.available;
    toggleButton.addEventListener("click", () => {
      void (async () => {
        if (!cliStatus.available) {
          return;
        }
        this.pluginRef.settings.allowObsidianCli = !this.pluginRef.settings.allowObsidianCli;
        await this.pluginRef.saveSettings();
        this.display();
      })();
    });

    const checkButton = actionsEl.createEl("button");
    checkButton.addClass("tmd-update-item-button");
    this.decorateAnteActionButton(checkButton, "refresh-cw", "Check");
    checkButton.addEventListener("click", () => {
      void (async () => {
        await this.pluginRef.refreshObsidianCliStatus();
        this.display();
      })();
    });

    const docsButton = actionsEl.createEl("button");
    docsButton.addClass("tmd-update-item-button");
    this.decorateAnteActionButton(docsButton, "external-link", "Open CLI docs");
    docsButton.addEventListener("click", () => {
      window.open("https://obsidian.md/zh/cli", "_blank", "noopener");
    });
  }

  private decorateAnteActionButton(buttonEl: HTMLButtonElement, icon: string, label: string): void {
    const iconEl = buttonEl.createSpan({ cls: "tmd-ante-update-button-icon" });
    setIcon(iconEl, icon);
    buttonEl.createSpan({ text: label, cls: "tmd-ante-update-button-label" });
  }

  private getObsidianCliStatusLabel(): string {
    const cliStatus = this.pluginRef.getObsidianCliStatus();
    if (!cliStatus.enabled) {
      return "Disabled";
    }
    if (cliStatus.available) {
      return "Available";
    }
    return "Not detected";
  }

  private getObsidianCliSummary(): string {
    const cliStatus = this.pluginRef.getObsidianCliStatus();
    if (!cliStatus.enabled) {
      return "Vault-aware CLI mode is turned off.";
    }
    if (cliStatus.available) {
      return "Lets Ante use Obsidian CLI for vault-aware tasks.";
    }
    return "Optional vault-aware mode is unavailable.";
  }

  private getObsidianCliMeta(): string {
    const cliStatus = this.pluginRef.getObsidianCliStatus();
    if (cliStatus.available) {
      return "";
    }
    return "Enable CLI in Obsidian Settings, add `obsidian` to PATH, and keep Obsidian running.";
  }

  private getObsidianCliStatusTone(): string {
    const cliStatus = this.pluginRef.getObsidianCliStatus();
    if (!cliStatus.enabled) {
      return "is-neutral";
    }
    return cliStatus.available ? "is-success" : "is-neutral";
  }

  private getObsidianCliStatusIcon(): string {
    const cliStatus = this.pluginRef.getObsidianCliStatus();
    if (!cliStatus.enabled) {
      return "toggle-left";
    }
    return cliStatus.available ? "app-window" : "circle-slash";
  }

  private getAnteUpdateStatusLabel(): string {
    if (this.upgradingAnte) {
      return "Upgrading";
    }
    if (this.checkingAnteVersion) {
      return "Checking";
    }
    if (!this.anteVersionState?.localVersion && this.anteVersionState?.latestVersion) {
      return "Not installed";
    }
    if (this.anteVersionState?.error) {
      return "Couldn’t check";
    }
    if (this.anteVersionState?.updateAvailable) {
      return "Update available";
    }
    if (this.anteVersionState?.localVersion && this.anteVersionState?.latestVersion) {
      return "Up to date";
    }
    return "Checking";
  }

  private getPluginUpdateStatusLabel(): string {
    if (this.checkingPluginVersion) {
      return "Checking";
    }
    if (this.pluginVersionState && !this.pluginVersionState.sourceAvailable) {
      return "No public feed";
    }
    if (this.pluginVersionState?.error) {
      return "Couldn’t check";
    }
    if (this.pluginVersionState?.updateAvailable) {
      return "Update available";
    }
    if (this.pluginVersionState?.latestVersion) {
      return "Up to date";
    }
    return "Checking";
  }

  private getPluginStatusTone(): string {
    if (this.checkingPluginVersion) {
      return "is-progress";
    }
    if (this.pluginVersionState && !this.pluginVersionState.sourceAvailable) {
      return "is-neutral";
    }
    if (this.pluginVersionState?.error) {
      return "is-error";
    }
    if (this.pluginVersionState?.updateAvailable) {
      return "is-warning";
    }
    if (this.pluginVersionState?.latestVersion) {
      return "is-success";
    }
    return "is-neutral";
  }

  private getPluginStatusIcon(): string {
    if (this.checkingPluginVersion) {
      return "refresh-cw";
    }
    if (this.pluginVersionState && !this.pluginVersionState.sourceAvailable) {
      return "info";
    }
    if (this.pluginVersionState?.error) {
      return "alert-triangle";
    }
    if (this.pluginVersionState?.updateAvailable) {
      return "arrow-up-circle";
    }
    if (this.pluginVersionState?.latestVersion) {
      return "badge-check";
    }
    return "refresh-cw";
  }

  private getAnteStatusTone(): string {
    if (this.upgradingAnte) {
      return "is-progress";
    }
    if (this.checkingAnteVersion) {
      return "is-progress";
    }
    if (!this.anteVersionState?.localVersion && this.anteVersionState?.latestVersion) {
      return "is-warning";
    }
    if (this.anteVersionState?.error) {
      return "is-error";
    }
    if (this.anteVersionState?.updateAvailable) {
      return "is-warning";
    }
    if (this.anteVersionState?.localVersion && this.anteVersionState?.latestVersion) {
      return "is-success";
    }
    return "is-neutral";
  }

  private getAnteStatusIcon(): string {
    if (this.upgradingAnte) {
      return "loader-circle";
    }
    if (this.checkingAnteVersion) {
      return "refresh-cw";
    }
    if (!this.anteVersionState?.localVersion && this.anteVersionState?.latestVersion) {
      return "download";
    }
    if (this.anteVersionState?.error) {
      return "alert-triangle";
    }
    if (this.anteVersionState?.updateAvailable) {
      return "arrow-up-circle";
    }
    if (this.anteVersionState?.localVersion && this.anteVersionState?.latestVersion) {
      return "badge-check";
    }
    return "refresh-cw";
  }

  private getPluginUpdateSummary(): string {
    if (this.checkingPluginVersion) {
      return "Checking the latest available plugin release.";
    }
    if (this.pluginVersionState && !this.pluginVersionState.sourceAvailable) {
      return "No public GitHub release feed is available for this repository.";
    }
    if (this.pluginVersionState?.error) {
      return "The plugin update source could not be reached right now.";
    }
    if (this.pluginVersionState?.updateAvailable) {
      return "A newer plugin version is available.";
    }
    if (this.pluginVersionState?.latestVersion) {
      return "This plugin build matches the latest visible release.";
    }
    return "Waiting to check the plugin version.";
  }

  private getPluginUpdateMeta(): string {
    const currentVersion = this.pluginVersionState?.currentVersion ?? this.pluginRef.manifest.version;
    if (this.pluginVersionState?.latestVersion) {
      return `Current ${currentVersion}  ->  Latest ${this.pluginVersionState.latestVersion}`;
    }
    return `Current ${currentVersion}`;
  }

  private getAnteUpdateSummary(): string {
    if (this.upgradingAnte) {
      return "Installing or upgrading the local Ante CLI.";
    }
    if (this.checkingAnteVersion) {
      return "Checking the local Ante CLI against the latest runtime channel.";
    }
    if (!this.anteVersionState?.localVersion && this.anteVersionState?.latestVersion) {
      return "Ante is not installed locally yet.";
    }
    if (this.anteVersionState?.error) {
      return "The runtime version could not be checked right now.";
    }
    if (this.anteVersionState?.updateAvailable) {
      return "A newer local Ante runtime is available.";
    }
    if (this.anteVersionState?.localVersion && this.anteVersionState?.latestVersion) {
      return "The local Ante runtime is already up to date.";
    }
    return "Waiting to check the local Ante runtime.";
  }

  private getAnteUpdateMeta(): string {
    const localVersion = this.anteVersionState?.localVersion ?? "not installed";
    if (this.anteVersionState?.latestVersion) {
      return `Local ${localVersion}  ->  Latest ${this.anteVersionState.latestVersion}`;
    }
    return `Local ${localVersion}`;
  }

  private async refreshAnteVersionState(): Promise<void> {
    if (this.checkingAnteVersion) {
      return;
    }

    this.checkingAnteVersion = true;
    this.display();
    try {
      this.anteVersionState = await this.pluginRef.anteUpdater.checkForUpdate();
    } finally {
      this.checkingAnteVersion = false;
      this.display();
    }
  }

  private async refreshPluginVersionState(): Promise<void> {
    if (this.checkingPluginVersion) {
      return;
    }

    this.checkingPluginVersion = true;
    this.display();
    try {
      this.pluginVersionState = await this.pluginRef.pluginUpdater.checkForUpdate();
    } finally {
      this.checkingPluginVersion = false;
      this.display();
    }
  }

  private async handleAnteUpgrade(): Promise<void> {
    if (this.upgradingAnte) {
      return;
    }
    if (!confirm("This will run the official Ante installer script for channel 'latest'. Continue?")) {
      return;
    }

    this.upgradingAnte = true;
    this.display();
    try {
      await this.pluginRef.anteUpdater.upgrade();
      await this.pluginRef.refreshAnteEnvironment();
      this.anteVersionState = await this.pluginRef.anteUpdater.checkForUpdate();
      new Notice(
        this.anteVersionState.localVersion ? `Ante upgraded to ${this.anteVersionState.localVersion}` : "Ante upgrade completed"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ante upgrade failed";
      this.anteVersionState = {
        localVersion: this.anteVersionState?.localVersion ?? null,
        latestVersion: this.anteVersionState?.latestVersion ?? null,
        updateAvailable: this.anteVersionState?.updateAvailable ?? false,
        checkedAt: new Date().toISOString(),
        error: message
      };
      new Notice(message);
    } finally {
      this.upgradingAnte = false;
      this.display();
    }
  }

  private renderPresetSection(containerEl: HTMLElement): HTMLDivElement {
    const sectionEl = this.createSettingsSection(
      containerEl,
      "Presets",
      "Manage reusable actions, visibility, and the order shown in the editor menu."
    );
    sectionEl.addClass("tmd-preset-section");
    const headerRow = sectionEl.createDiv({ cls: "tmd-preset-toolbar" });
    const titleGroup = headerRow.createDiv({ cls: "tmd-preset-toolbar-copy" });
    titleGroup.createEl("div", { text: "Preset Library", cls: "tmd-preset-title" });

    const summary = titleGroup.createEl("p", { cls: "tmd-preset-summary" });
    summary.setText("Built-in and custom presets share one ordered library.");

    const newPresetButton = headerRow.createEl("button", { text: "New preset", cls: "mod-cta" });
    newPresetButton.addClass("tmd-preset-new-button");
    newPresetButton.addEventListener("click", () => {
      new CustomPresetModal(this.pluginRef, () => this.display()).open();
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
            () => this.display(),
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
    this.display();
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
    this.display();
  }

  private async deleteCustomPreset(presetId: string): Promise<void> {
    const preset = this.pluginRef.settings.customPresets.find((entry) => entry.id === presetId);
    if (!preset) {
      return;
    }

    if (!preset.instruction.trim() || window.confirm(`Delete custom preset "${preset.name}"?`)) {
      this.pluginRef.settings.customPresets = this.pluginRef.settings.customPresets.filter((entry) => entry.id !== presetId);
      this.applyPresetOrder();
      await this.pluginRef.saveSettings();
      this.display();
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

  private addModelOptions(dropdown: DropdownComponent): DropdownComponent {
    const models = PROVIDER_MODELS[this.pluginRef.settings.anteProvider];
    for (const model of models) {
      dropdown.addOption(model, model);
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
      this.pluginRef.settings.anteProvider,
      this.pluginRef.settings.anteModel,
    );
  }
}

class CustomPresetModal extends Modal {
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
    } | null = null
  ) {
    super(pluginRef.app);
    this.nameValue = existingPreset?.name ?? "";
    this.instructionValue = existingPreset?.instruction ?? "";
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("tmd-preset-modal");
    contentEl.empty();
    contentEl.createEl("h3", {
      text: this.existingPreset ? "Edit Custom Preset" : "Add Custom Preset",
      cls: "tmd-preset-modal-title"
    });

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
          .setPlaceholder("Describe how this preset should operate on the current Markdown context.")
          .setValue(this.instructionValue)
          .onChange((value) => {
            this.instructionValue = value;
          })
      );
    instructionSetting.settingEl.addClass("tmd-preset-modal-setting", "is-textarea");

    const actionSetting = new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("Confirm").setCta().onClick(async () => {
          await this.savePreset();
        })
      )
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => {
          this.close();
        })
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
      const preset = this.pluginRef.settings.customPresets.find((entry) => entry.id === this.existingPreset?.id);
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
        interactionMode: "inline"
      });
    }
    this.pluginRef.settings.customPresets.sort((left, right) => left.sortOrder - right.sortOrder);
    await this.pluginRef.saveSettings();
    this.close();
    this.onSaved();
  }
}
