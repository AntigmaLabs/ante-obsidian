import { DropdownComponent, Modal, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import { listResolvedPresets } from "../core/presets";
import type TmdPlugin from "./main";
import type { AnteVersionCheckResult } from "./ante-updater";
import type { PluginVersionCheckResult } from "./plugin-updater";
import {
  type AnteConnectionMode,
  ANTHROPIC_PROVIDER,
  GEMINI_PROVIDER,
  OPENAI_PROVIDER,
  PROVIDER_MODELS,
  getDefaultModelForProvider,
  normalizeProvider
} from "./settings";

export class TmdSettingTab extends PluginSettingTab {
  private draggingPresetId: string | null = null;
  private anteVersionState: AnteVersionCheckResult | null = null;
  private pluginVersionState: PluginVersionCheckResult | null = null;
  private checkingAnteVersion = false;
  private checkingPluginVersion = false;
  private upgradingAnte = false;

  constructor(private readonly pluginRef: TmdPlugin) {
    super(pluginRef.app, pluginRef);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("tmd-settings");
    containerEl.createEl("h2", { text: "Ante md Settings" });

    this.renderUpdatesSection(containerEl);

    new Setting(containerEl)
      .setName("Ante connection mode")
      .setDesc("Choose whether Ante md talks to Ante over stdin/stdout or WebSocket.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("stdio", "Local STDIO")
          .addOption("websocket", "WebSocket")
          .setValue(this.pluginRef.settings.connectionMode)
          .onChange(async (value) => {
            this.pluginRef.settings.connectionMode = this.normalizeConnectionMode(value);
            await this.pluginRef.saveSettings();
            this.display();
          })
      );

    if (this.pluginRef.settings.connectionMode === "stdio") {
      new Setting(containerEl)
        .setName("Ante arguments JSON")
        .setDesc('JSON string array passed to Ante. Default: `["serve","--stdio","--yolo"]`.')
        .addTextArea((text) =>
          text.setValue(this.pluginRef.settings.argsJson).onChange(async (value) => {
            this.pluginRef.settings.argsJson = value;
            await this.pluginRef.saveSettings();
          })
        );
    } else {
      new Setting(containerEl)
        .setName("Ante WebSocket address")
        .setDesc("Socket address passed to `ante serve --ws`. Example: `127.0.0.1:8765`.")
        .addText((text) =>
          text.setPlaceholder("127.0.0.1:8765").setValue(this.pluginRef.settings.wsAddress).onChange(async (value) => {
            this.pluginRef.settings.wsAddress = value.trim() || "127.0.0.1:8765";
            await this.pluginRef.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName("Ante arguments JSON")
        .setDesc('Additional JSON string array passed to Ante. Transport flags are managed by Ante md in WebSocket mode, so keep only extras such as `["--yolo"]`.')
        .addTextArea((text) =>
          text.setValue(this.pluginRef.settings.argsJson).onChange(async (value) => {
            this.pluginRef.settings.argsJson = value;
            await this.pluginRef.saveSettings();
          })
        );
    }

    new Setting(containerEl)
      .setName("Auto-approve Ante tools")
      .setDesc("Automatically approve Ante tool calls inside Ante md. Default: on.")
      .addToggle((toggle) =>
        toggle.setValue(this.pluginRef.settings.autoApproveAnteTools).onChange(async (value) => {
          this.pluginRef.settings.autoApproveAnteTools = value;
          await this.pluginRef.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Show full process logs")
      .setDesc("Show detailed runtime process information without hiding noisy system logs or truncating streamed output. Default: off.")
      .addToggle((toggle) =>
        toggle.setValue(this.pluginRef.settings.showFullProcessLogs).onChange(async (value) => {
          this.pluginRef.settings.showFullProcessLogs = value;
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
      const geminiSetting = new Setting(containerEl)
        .setName("Gemini credentials")
        .setDesc("Configure the env var name Ante reads for `x-goog-api-key`, and optionally override the Gemini API key locally.");

      geminiSetting.controlEl.addClass("tmd-gemini-setting");

      const envFieldEl = geminiSetting.controlEl.createDiv({ cls: "tmd-gemini-field" });
      envFieldEl.createSpan({ text: "Env key", cls: "tmd-gemini-field-label" });
      new Setting(envFieldEl).addText((text) => {
        text.inputEl.addClass("tmd-gemini-field-input");
        text.setPlaceholder("GEMINI_API_KEY").setValue(this.pluginRef.settings.geminiApiKeyEnvKey).onChange(async (value) => {
          this.pluginRef.settings.geminiApiKeyEnvKey = value.trim() || "GEMINI_API_KEY";
          await this.pluginRef.saveSettings();
        });
      });

      const keyFieldEl = geminiSetting.controlEl.createDiv({ cls: "tmd-gemini-field" });
      keyFieldEl.createSpan({ text: "API key", cls: "tmd-gemini-field-label" });
      new Setting(keyFieldEl).addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.addClass("tmd-gemini-field-input");
        text.setPlaceholder("AIza...").setValue(this.pluginRef.settings.geminiApiKey).onChange(async (value) => {
          this.pluginRef.settings.geminiApiKey = value.trim();
          await this.pluginRef.saveSettings();
        });
      });
    }

    this.renderPresetSection(containerEl);

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

  private renderUpdatesSection(containerEl: HTMLElement): void {
    const sectionEl = containerEl.createDiv({ cls: "tmd-updates-section" });
    sectionEl.createEl("h3", { text: "Updates", cls: "tmd-ante-update-title" });
    sectionEl.createEl("p", {
      text: "Check plugin and local runtime update status.",
      cls: "tmd-ante-update-summary"
    });

    const listEl = sectionEl.createDiv({ cls: "tmd-updates-list" });
    this.renderPluginUpdateItem(listEl);
    this.renderAnteUpdateItem(listEl);

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
    titleRowEl.createSpan({ cls: "tmd-update-item-title", text: "Ante md" });
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

  private decorateAnteActionButton(buttonEl: HTMLButtonElement, icon: string, label: string): void {
    const iconEl = buttonEl.createSpan({ cls: "tmd-ante-update-button-icon" });
    setIcon(iconEl, icon);
    buttonEl.createSpan({ text: label, cls: "tmd-ante-update-button-label" });
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

  private renderPresetSection(containerEl: HTMLElement): void {
    const sectionEl = containerEl.createDiv({ cls: "tmd-preset-section" });
    const headerRow = sectionEl.createDiv({ cls: "tmd-preset-toolbar" });
    const titleGroup = headerRow.createDiv({ cls: "tmd-preset-toolbar-copy" });
    titleGroup.createEl("h3", { text: "Presets", cls: "tmd-preset-title" });

    const summary = titleGroup.createEl("p", { cls: "tmd-preset-summary" });
    summary.setText("Visible presets appear in the editor context menu. Built-in presets can be reordered or hidden.");

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

  private getSelectedModel(): string {
    const models = PROVIDER_MODELS[this.pluginRef.settings.anteProvider];
    return models.includes(this.pluginRef.settings.anteModel as (typeof models)[number])
      ? this.pluginRef.settings.anteModel
      : getDefaultModelForProvider(this.pluginRef.settings.anteProvider);
  }

  private normalizeConnectionMode(value: string): AnteConnectionMode {
    return value === "websocket" ? "websocket" : "stdio";
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
