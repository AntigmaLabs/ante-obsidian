import { Notice, Setting, setIcon, FileSystemAdapter } from "obsidian";
import type TmdPlugin from "./main";
import type { AnteVersionCheckResult } from "./ante-updater";
import type { PluginVersionCheckResult } from "./plugin-updater";

export class SettingsUpdatesRenderer {
  private anteVersionState: AnteVersionCheckResult | null = null;
  private pluginVersionState: PluginVersionCheckResult | null = null;
  private checkingAnteVersion = false;
  private checkingPluginVersion = false;
  private upgradingAnte = false;

  constructor(
    private readonly pluginRef: TmdPlugin,
    private readonly onStateChanged: () => void
  ) {}

  render(containerEl: HTMLElement): void {
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
    const iconName = this.getPluginStatusIcon();
    if (this.checkingPluginVersion) {
      iconEl.addClass("tmd-spin");
    }
    setIcon(iconEl, iconName);

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
      this.decorateAnteActionButton(openButton, "external-link", "Repo");
      openButton.addEventListener("click", () => {
        window.open(this.pluginVersionState?.latestUrl, "_blank", "noopener");
      });
    }

    if (this.pluginVersionState?.updateAvailable) {
      const adapter = this.pluginRef.app.vault.adapter;
      const vaultPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "/path/to/your/vault";
      const installScript = `curl -sS https://raw.githubusercontent.com/AntigmaLabs/ante-obsidian/main/scripts/install.sh | bash -s -- "${vaultPath}"`;

      const scriptContainer = itemEl.createDiv({ cls: "tmd-update-script-container" });
      scriptContainer.createEl("div", { 
        text: "Run this command in your terminal to update the plugin:", 
        cls: "tmd-update-script-label" 
      });

      const rowEl = scriptContainer.createDiv({ cls: "tmd-update-script-row" });
      const codeBlock = rowEl.createEl("pre", { cls: "tmd-update-script-code" });
      codeBlock.createEl("code", { text: installScript });

      const copyBtn = rowEl.createEl("button", { 
        text: "Copy command", 
        cls: "tmd-update-script-copy-btn" 
      });
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(installScript)
          .then(() => {
            new Notice("Plugin update command copied to clipboard!");
          })
          .catch((error) => {
            new Notice(error instanceof Error ? error.message : "Failed to copy command");
          });
      });
    }
  }

  private renderAnteUpdateItem(containerEl: HTMLElement): void {
    const itemEl = containerEl.createDiv({ cls: `tmd-update-item ${this.getAnteStatusTone()}` });
    const iconEl = itemEl.createDiv({ cls: "tmd-update-item-icon" });
    const iconName = this.getAnteStatusIcon();
    if (this.checkingAnteVersion || this.upgradingAnte) {
      iconEl.addClass("tmd-spin");
    }
    setIcon(iconEl, iconName);

    const bodyEl = itemEl.createDiv({ cls: "tmd-update-item-body" });
    const headerEl = bodyEl.createDiv({ cls: "tmd-update-item-header" });
    const titleRowEl = headerEl.createDiv({ cls: "tmd-update-item-title-row" });
    titleRowEl.createSpan({ cls: "tmd-update-item-title", text: "Ante CLI" });
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
        this.onStateChanged();
      })();
    });

    const checkButton = actionsEl.createEl("button");
    checkButton.addClass("tmd-update-item-button");
    this.decorateAnteActionButton(checkButton, "refresh-cw", "Check");
    checkButton.addEventListener("click", () => {
      void (async () => {
        await this.pluginRef.refreshObsidianCliStatus();
        this.onStateChanged();
      })();
    });

    const docsButton = actionsEl.createEl("button");
    docsButton.addClass("tmd-update-item-button");
    this.decorateAnteActionButton(docsButton, "external-link", "Docs");
    docsButton.addEventListener("click", () => {
      window.open("https://obsidian.md/zh/cli", "_blank", "noopener");
    });
  }

  private decorateAnteActionButton(buttonEl: HTMLButtonElement, icon: string, label: string): void {
    const iconEl = buttonEl.createSpan({ cls: "tmd-ante-update-button-icon" });
    if (icon === "loader-circle") {
      iconEl.addClass("tmd-spin");
    }
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
      return "Checking the local Ante CLI against the latest release channel.";
    }
    if (!this.anteVersionState?.localVersion && this.anteVersionState?.latestVersion) {
      return "Ante is not installed locally yet.";
    }
    if (this.anteVersionState?.error) {
      return "The CLI version could not be checked right now.";
    }
    if (this.anteVersionState?.updateAvailable) {
      return "A newer local Ante CLI is available.";
    }
    if (this.anteVersionState?.localVersion && this.anteVersionState?.latestVersion) {
      return "The local Ante CLI is already up to date.";
    }
    return "Waiting to check the local Ante CLI.";
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
    this.onStateChanged();
    try {
      this.anteVersionState = await this.pluginRef.anteUpdater.checkForUpdate();
    } finally {
      this.checkingAnteVersion = false;
      this.onStateChanged();
    }
  }

  private async refreshPluginVersionState(): Promise<void> {
    if (this.checkingPluginVersion) {
      return;
    }

    this.checkingPluginVersion = true;
    this.onStateChanged();
    try {
      this.pluginVersionState = await this.pluginRef.pluginUpdater.checkForUpdate();
    } finally {
      this.checkingPluginVersion = false;
      this.onStateChanged();
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
    this.onStateChanged();
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
      this.onStateChanged();
    }
  }
}
