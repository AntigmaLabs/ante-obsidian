import { App, MarkdownView, Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import { resolveAnteThinkingPreference, type AnteThinkingLevel, type AnteThinkingPreference } from "../core/ante-thinking";
import { TaskEngine } from "../core/task-engine";
import type { ContextSnapshot, PresetId } from "../core/types";
import { MentionTriggerService } from "./mention-trigger";
import type { HostAdapter } from "../core/host-adapter";
import { ObsidianHostAdapter } from "./host-adapter";
import { populateEditorMenu } from "./editor-menu";
import { TmdSettingTab } from "./settings-tab";
import { DEFAULT_SETTINGS, normalizeSettings, AVAILABLE_PROVIDERS, type TmdSettings } from "./settings";
import type { AnteRuntime } from "../runtime/ante-runtime";
import { createAnteRuntime } from "../runtime/create-ante-runtime";
import { resolveCommandPath } from "../runtime/transport/ante-stdio-transport";
import { TMD_CHAT_VIEW_TYPE, TmdChatView } from "./chat-view";
import { TMD_TERMINAL_VIEW_TYPE, TmdTerminalView } from "./terminal-view";
import type { TaskRecord } from "../core/types";
import type { ChatConversationRecord } from "../core/chat-types";
import { readAnteDefaults, type AnteDefaults } from "./ante-defaults";
import { normalizeEnvVarName, readCommandPathFromLoginShell, readFullEnvFromLoginShell, selectResolvedCommandPath } from "./shell-env";
import { ChatSessionManager } from "../core/chat-session-manager";
import type { ChatPersistenceState } from "../core/chat-types";
import { getResolvedPreset, listResolvedPresets } from "../core/presets";
import { AnteUpdater } from "./ante-updater";
import { PluginUpdater } from "./plugin-updater";
import { buildAnteRuntimeConfig } from "./main-runtime-config";
import { ObsidianCliService, type ObsidianCliStatus } from "./obsidian-cli-service";

const ANTE_COMMAND = "ante";

interface TmdPluginData {
  settings?: Partial<TmdSettings>;
  chatState?: ChatPersistenceState | null;
  pluginUpdateState?: {
    lastNotifiedVersion?: string | null;
  } | null;
}

export default class TmdPlugin extends Plugin {
  settings: TmdSettings = DEFAULT_SETTINGS;
  anteDefaults: AnteDefaults = {
    provider: DEFAULT_SETTINGS.anteProvider,
    model: DEFAULT_SETTINGS.anteModel
  };
  shellEnv: Record<string, string> = {};
  resolvedAnteCommand = "";
  hostAdapter!: HostAdapter;
  taskEngine!: TaskEngine;
  chatManager!: ChatSessionManager;
  mentionTrigger!: MentionTriggerService;
  anteUpdater!: AnteUpdater;
  pluginUpdater!: PluginUpdater;
  obsidianCliStatus: ObsidianCliStatus = { available: false };
  private readonly obsidianCli = new ObsidianCliService();
  private readonly modelNamesByProvider = new Map<string, string[]>();
  private runtime!: AnteRuntime;
  private pluginData: TmdPluginData = {};
  private pluginUpdateState: { lastNotifiedVersion: string | null } = {
    lastNotifiedVersion: null
  };
  // Serializes concurrent conversation switches to prevent race conditions.
  private conversationSwitchLock: Promise<void> = Promise.resolve();
  // Debounce timer for editor-change events.
  private editorChangeDebounceTimer: number | null = null;
  private delayedInitializationComplete = false;
  private unsubscribeTaskEngine: (() => void) | null = null;

  async onload(): Promise<void> {
    // Load settings first; defer slow shell/defaults reads to background.
    await this.loadSettings();

    this.hostAdapter = new ObsidianHostAdapter(this.app);
    this.anteUpdater = new AnteUpdater();
    this.pluginUpdater = new PluginUpdater(this.manifest.version);
    this.runtime = createAnteRuntime(() => {
      return buildAnteRuntimeConfig({
        settings: this.settings,
        resolvedTarget: this.getResolvedAnteTarget(),
        shellEnv: this.shellEnv,
      });
    });
    this.taskEngine = new TaskEngine(
      this.runtime,
      this.hostAdapter,
      (presetId) => this.getPresetById(presetId),
      () => this.shouldShowFullProcessLogs(),
      () => this.getObsidianCliPromptBlock()
    );
    this.chatManager = new ChatSessionManager({ saveChatState: (chatState) => this.saveChatState(chatState) }, this.pluginData.chatState);
    this.unsubscribeTaskEngine = this.taskEngine.subscribe((state) => {
      for (const task of state.tasks) {
        this.captureRuntimeModelList(task.runtimeSession);
      }
      this.chatManager.syncFromTaskState(state);
    });
    this.mentionTrigger = new MentionTriggerService(this.app, this, () => this.settings.mentionTriggerDebug);

    this.registerView(TMD_CHAT_VIEW_TYPE, (leaf) => new TmdChatView(leaf, this));
    this.registerView(TMD_TERMINAL_VIEW_TYPE, (leaf) => new TmdTerminalView(leaf, this));

    this.addSettingTab(new TmdSettingTab(this));
    this.registerCommands();
    this.registerEditorMenu();
    this.registerMentionTrigger();
    void this.checkForPluginUpdateOnStartup();
    void this.refreshObsidianCliStatus();
    void this.delayedInitialization();
  }

  // Runs slow I/O (shell env, ante defaults) in the background so onload stays fast.
  private async delayedInitialization(): Promise<void> {
    try {
      await this.loadAnteDefaults();
      await this.loadShellEnv();
      this.delayedInitializationComplete = true;
      console.info("[tmd] Plugin fully initialized");
    } catch (error) {
      console.error("[tmd] Failed to complete delayed initialization:", error);
    }
  }

  async onunload(): Promise<void> {
    if (this.editorChangeDebounceTimer != null) {
      window.clearTimeout(this.editorChangeDebounceTimer);
      this.editorChangeDebounceTimer = null;
    }
    this.unsubscribeTaskEngine?.();

    this.mentionTrigger?.destroy();
    await this.runtime?.persistActiveSession().catch(() => {});
    this.chatManager?.dispose();
    this.runtime?.dispose();
    this.app.workspace.detachLeavesOfType(TMD_CHAT_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(TMD_TERMINAL_VIEW_TYPE);
  }

  async saveSettings(): Promise<void> {
    this.pluginData = {
      ...this.pluginData,
      settings: this.settings,
      pluginUpdateState: this.pluginUpdateState
    };
    await this.saveData(this.pluginData);
  }

  async loadSettings(): Promise<void> {
    const stored = await this.loadData();
    this.pluginData = (stored as TmdPluginData | null | undefined) ?? {};
    const legacySettings =
      this.pluginData.settings ??
      (stored && !("settings" in (stored as Record<string, unknown>)) ? (stored as Partial<TmdSettings>) : undefined);
    this.settings = normalizeSettings(legacySettings);
    this.pluginUpdateState = {
      lastNotifiedVersion:
        typeof this.pluginData.pluginUpdateState?.lastNotifiedVersion === "string"
          ? this.pluginData.pluginUpdateState.lastNotifiedVersion
          : null
    };
  }

  async saveChatState(chatState: ChatPersistenceState): Promise<void> {
    this.pluginData = {
      ...this.pluginData,
      settings: this.settings,
      chatState,
      pluginUpdateState: this.pluginUpdateState
    };
    await this.saveData(this.pluginData);
  }

  isAnteInstalled(): boolean {
    return this.resolvedAnteCommand.trim().length > 0;
  }

  async openPluginSettings(): Promise<void> {
    const setting = (this.app as App & {
      setting?: {
        open?: () => void;
        openTabById?: (id: string) => void;
      };
    }).setting;
    setting?.open?.();
    setting?.openTabById?.(this.manifest.id);
  }

  notifyAnteMissing(sourceLabel: string): void {
    new Notice(`${sourceLabel} needs the local Ante CLI. Open Ante Obsidian Settings to install Ante.`, 9000);
  }

  ensureAnteInstalled(sourceLabel: string): boolean {
    if (this.isAnteInstalled()) {
      return true;
    }
    this.notifyAnteMissing(sourceLabel);
    return false;
  }

  private async handoffAnteSession(action: () => void | Promise<void>, reason: string): Promise<void> {
    console.info("[tmd session]", reason);
    await this.persistIdleAnteSession();
    await action();
  }

  async activateChatConversation(conversationId: string): Promise<void> {
    const work = this.conversationSwitchLock.then(async () => {
      if (this.chatManager.getActiveConversation().id === conversationId) {
        return;
      }
      await this.handoffAnteSession(
        () => {
          this.chatManager.setActiveConversation(conversationId);
        },
        `Switching chat conversation · next=${conversationId}`
      );
    });
    // Swallow errors at the lock level so a failed switch doesn't break the chain.
    this.conversationSwitchLock = work.catch((error) => {
      console.error("[tmd] Failed to switch conversation:", error);
      new Notice("Failed to switch conversation. Please try again.");
    });
    return work;
  }

  async createChatConversation(context?: ContextSnapshot | null, options?: { forceNew?: boolean }): Promise<ChatConversationRecord> {
    let conversation: ChatConversationRecord | null = null;
    const work = this.conversationSwitchLock.then(async () => {
      await this.handoffAnteSession(
        () => {
          conversation = this.chatManager.createConversation({
            context: context ?? undefined,
            forceNew: options?.forceNew
          });
        },
        "Creating new chat conversation"
      );
    });
    this.conversationSwitchLock = work.catch((error) => {
      console.error("[tmd] Failed to create conversation:", error);
    });
    await work;
    return conversation ?? this.chatManager.getActiveConversation();
  }

  async deleteChatConversation(conversationId: string): Promise<void> {
    const work = this.conversationSwitchLock.then(async () => {
      const sessionId = this.chatManager.getConversationRuntimeSessionId(conversationId);
      const activeSessionId = this.runtime.getActiveSessionId();
      console.info(
        "[tmd session]",
        `Deleting chat conversation · id=${conversationId} · session=${sessionId ?? "none"} · active=${activeSessionId ?? "none"}`
      );
      const removedTaskIds = this.chatManager.removeConversation(conversationId);
      this.taskEngine.clearTasks(removedTaskIds);
    });
    this.conversationSwitchLock = work.catch((error) => {
      console.error("[tmd] Failed to delete conversation:", error);
    });
    return work;
  }

  async persistIdleAnteSession(): Promise<void> {
    if (this.taskEngine.hasActiveTask()) {
      console.info("[tmd session]", "Skipping Ante session persist because a task is still running");
      return;
    }
    console.info("[tmd session]", `Persisting idle Ante session · active=${this.runtime.getActiveSessionId() ?? "none"}`);
    await this.runtime.persistActiveSession();
  }

  async loadAnteDefaults(): Promise<void> {
    const defaults = await readAnteDefaults();
    if (defaults) {
      this.anteDefaults = defaults;
    }
  }

  async loadShellEnv(): Promise<void> {
    const [shellAnteCommand, fullEnv] = await Promise.all([
      readCommandPathFromLoginShell("ante"),
      readFullEnvFromLoginShell()
    ]);
    this.resolvedAnteCommand = selectResolvedCommandPath(
      shellAnteCommand,
      resolveCommandPath(ANTE_COMMAND, fullEnv),
      ANTE_COMMAND
    );
    const envMap: Record<string, string> = {};

    // Collect all env keys to load:
    //   1. Default env keys for every API-key provider in the built-in list
    //   2. Any custom env key names the user has configured per-provider
    const keysToLoad = new Set<string>();
    for (const provider of AVAILABLE_PROVIDERS) {
      if (provider.defaultEnvKey) {
        const key = normalizeEnvVarName(provider.defaultEnvKey);
        if (key) keysToLoad.add(key);
      }
    }
    for (const config of Object.values(this.settings.providerKeys)) {
      const key = normalizeEnvVarName(config.envKey);
      if (key) keysToLoad.add(key);
    }

    for (const envKey of keysToLoad) {
      const value = fullEnv[envKey];
      if (value) {
        envMap[envKey] = value;
      }
    }
    this.shellEnv = envMap;
  }

  async refreshAnteEnvironment(): Promise<void> {
    await this.loadShellEnv();
    await this.loadAnteDefaults();
  }

  shouldShowFullProcessLogs(): boolean {
    return this.settings.showFullProcessLogs;
  }

  shouldShowChatRuntimeDetails(): boolean {
    return this.settings.showChatRuntimeDetails;
  }

  async runPresetFromContextMenu(presetId: PresetId): Promise<void> {
    try {
      if (!this.ensureAnteInstalled("Ante Obsidian")) {
        return;
      }
      const context = await this.hostAdapter.getActiveContext();
      if (!context) {
        throw new Error("Open a Markdown note or select some text before running Ante");
      }

      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view?.editor && context.selection) {
        await this.mentionTrigger.runTaskWithPlaceholder({
          editor: view.editor,
          replaceFrom: context.selection.to,
          replaceTo: context.selection.to,
          context,
          presetId,
          triggerSource: "context-menu"
        });
        return;
      }

      const taskId = await this.taskEngine.startDocumentTask({
        presetId,
        triggerSource: "context-menu",
        context
      });
      this.watchTaskForAutoApply(taskId, "Context menu");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to run Ante preset");
    }
  }

  async openChatView(): Promise<void> {
    const leaf = await this.ensureLeaf(TMD_CHAT_VIEW_TYPE);
    await leaf.setViewState({ type: TMD_CHAT_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async openTerminalView(): Promise<void> {
    const leaf = await this.ensureLeaf(TMD_TERMINAL_VIEW_TYPE);
    await leaf.setViewState({ type: TMD_TERMINAL_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
    if (this.isAnteInstalled()) {
      void this.runtime.ensureWarmSession().catch(() => {
        // Ignore idle warmup failures here; the visible task path still surfaces errors.
      });
      return;
    }
    this.notifyAnteMissing("Ante Terminal");
  }

  watchTaskForAutoApply(taskId: string, sourceLabel: string): void {
    let settled = false;
    const unsubscribe = this.taskEngine.subscribe((state) => {
      if (settled) {
        return;
      }
      const task = state.tasks.find((entry) => entry.id === taskId);
      if (!task || task.status === "running") {
        return;
      }

      const pendingArtifacts = task.artifacts.filter((artifact) => artifact.applyState === "pending");
      const activeArtifacts = task.artifacts.filter(
        (artifact) => artifact.applyState === "applying" || artifact.applyState === "reverting"
      );
      if (pendingArtifacts.length > 0) {
        void (async () => {
          try {
            for (const artifact of pendingArtifacts) {
              await this.taskEngine.applyArtifact(task.id, artifact.id);
            }
            settled = true;
            unsubscribe();
            new Notice(`${sourceLabel} Ante changes applied`);
          } catch (error) {
            settled = true;
            unsubscribe();
            new Notice(error instanceof Error ? error.message : "Failed to apply Ante changes");
          }
        })();
        return;
      }
      if (activeArtifacts.length > 0) {
        return;
      }

      settled = true;
      unsubscribe();
      const failedArtifact = task.artifacts.find((artifact) => artifact.applyState === "failed");
      if (failedArtifact?.applyError) {
        new Notice(failedArtifact.applyError);
        return;
      }
      this.handleNonArtifactTaskCompletion(task, sourceLabel);
    });
  }

  private handleNonArtifactTaskCompletion(task: TaskRecord, sourceLabel: string): void {
    if (task.textResult?.text.trim()) {
      new Notice(`${sourceLabel} Ante result is ready`);
      return;
    }

    if (task.error) {
      new Notice(task.error);
      return;
    }

    new Notice(`${sourceLabel} Ante task finished`);
  }

  getResolvedAnteTarget(): AnteDefaults {
    if (this.settings.useAnteDefaults) {
      return this.anteDefaults;
    }
    return {
      provider: this.settings.anteProvider,
      model: this.settings.anteModel
    };
  }

  getModelNamesForProvider(provider: string, currentModel?: string): string[] {
    const models = this.getAvailableModelNamesForProvider(provider);
    const current = currentModel?.trim();
    if (models.length === 0 && current) {
      return [current, ...models];
    }
    return [...models];
  }

  getAvailableModelNamesForProvider(provider: string): string[] {
    const providerId = provider.trim();
    const cached = this.modelNamesByProvider.get(providerId) ?? [];
    const providerMeta = AVAILABLE_PROVIDERS.find((p) => p.id === providerId);
    const builtIn = providerMeta?.defaultModels ?? [];
    const custom = this.settings.customModels?.[providerId] ?? [];

    return [...new Set([...cached, ...builtIn, ...custom])];
  }

  getLastSelectedModelForProvider(provider: string): string {
    const providerId = provider.trim();
    return providerId ? (this.settings.lastSelectedModelsByProvider[providerId] ?? "") : "";
  }

  rememberLastSelectedModelForProvider(provider: string, model: string): void {
    const providerId = provider.trim();
    const modelId = model.trim();
    if (!providerId || !modelId) {
      return;
    }
    if (this.settings.lastSelectedModelsByProvider[providerId] === modelId) {
      return;
    }
    this.settings.lastSelectedModelsByProvider = {
      ...this.settings.lastSelectedModelsByProvider,
      [providerId]: modelId
    };
    void this.saveSettings().catch((error) => {
      console.error("[tmd] Failed to save last selected model:", error);
    });
  }

  /**
   * Returns the subset of AVAILABLE_PROVIDERS that the user has actually configured:
   * - OAuth providers: present if the corresponding auth token file exists on disk.
   * - API-key providers: present if a key is available via shellEnv or providerKeys.
   * - local (no-auth): always included.
   * Falls back to the full list if we cannot determine status (e.g. before delayed init).
   */
  getConfiguredProviders(): import("./settings").ProviderMeta[] {
    const { homedir } = require("node:os") as typeof import("node:os");
    const { join } = require("node:path") as typeof import("node:path");
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    const anteHome = (typeof process !== "undefined" && process.env?.ANTE_HOME) || join(homedir(), ".ante");

    // OAuth preset name → auth file base name mapping (based on ~/.ante/auth/ observations)
    const oauthAuthFile: Record<string, string> = {
      "openai-subscription": "openai",
      "anthropic-subscription": "anthropic",
      "antix": "antix",
    };

    return AVAILABLE_PROVIDERS.filter((p) => {
      if (p.authType === "none") {
        // local — always show
        return true;
      }
      if (p.authType === "oauth") {
        const fileName = oauthAuthFile[p.id];
        if (!fileName) return false;
        return existsSync(join(anteHome, "auth", `${fileName}.json`));
      }
      // api-key: show if any key source is non-empty
      const envKey = this.settings.providerKeys[p.id]?.envKey || p.defaultEnvKey || "";
      const hasShellKey = envKey ? Boolean(this.shellEnv[envKey]?.trim()) : false;
      const hasDirectKey = Boolean(this.settings.providerKeys[p.id]?.apiKey?.trim());
      return hasShellKey || hasDirectKey;
    });
  }


  async warmAnteModelCatalog(target?: { provider: string; model: string; thinking: AnteThinkingPreference }): Promise<void> {
    if (!this.isAnteInstalled()) {
      return;
    }
    console.info(`[tmd session] Warming model catalog for provider: ${target?.provider ?? "default"}`);
    await this.runtime.ensureWarmSession(target);
    const session = this.runtime.getActiveSessionInfo();
    console.info(`[tmd session] Warming complete. Session info:`, session);
    this.captureRuntimeModelList(session);
  }

  private captureRuntimeModelList(session: TaskRecord["runtimeSession"] | null | undefined): void {
    const provider = session?.activeProvider?.trim();
    const models = session?.availableModels?.map((model) => model.trim()).filter(Boolean) ?? [];
    if (provider) {
      console.info(`[tmd session] Active provider: ${provider}, Active model: ${session?.activeModel ?? "default"}, Available models:`, models);
    }
    if (!provider || models.length === 0) {
      return;
    }
    const uniqueModels = [...new Set(models)];
    this.modelNamesByProvider.set(provider, uniqueModels);
  }

  getResolvedAnteThinking(): AnteThinkingLevel | null {
    return resolveAnteThinkingPreference(this.settings.anteThinking);
  }

  getObsidianCliStatus(): ObsidianCliStatus & { enabled: boolean } {
    return {
      ...this.obsidianCliStatus,
      enabled: this.settings.allowObsidianCli
    };
  }

  getObsidianCliPromptBlock(): string {
    if (!this.settings.allowObsidianCli || !this.obsidianCliStatus.available) {
      return "";
    }

    return [
      "Obsidian CLI is available in this session.",
      "If needed, you may use the `obsidian` command for vault-aware operations.",
      "Reference: https://obsidian.md/zh/cli",
      "Prefer the current note/selection first. For Markdown edits, prefer returning Ante Obsidian JSON changes instead of modifying files directly through shell."
    ].join("\n");
  }

  async refreshObsidianCliStatus(): Promise<void> {
    this.obsidianCliStatus = await this.obsidianCli.checkStatus();
  }

  getAvailablePresets() {
    return listResolvedPresets(this.settings);
  }

  getVisiblePresets() {
    return this.getAvailablePresets().filter((preset) => preset.enabled !== false);
  }

  getPresetById(presetId: PresetId) {
    return getResolvedPreset(this.settings, presetId);
  }

  getPresetIcon(presetId: PresetId): string {
    if (presetId === "default") {
      return "bot";
    }
    if (presetId === "research") {
      return "search";
    }
    if (presetId === "plan") {
      return "list-todo";
    }
    if (presetId === "summary") {
      return "scroll-text";
    }
    return "wand-sparkles";
  }

  private registerCommands(): void {
    this.addCommand({
      id: "open-ante-chat",
      name: "Chat with Ante",
      callback: async () => this.openChatView()
    });

    this.addCommand({
      id: "open-ante-terminal",
      name: "Open Ante Terminal",
      callback: async () => this.openTerminalView()
    });

    this.addCommand({
      id: "run-ante-default",
      name: "Run @ante on current note",
      callback: async () => this.runPresetFromContextMenu("default")
    });

    this.addCommand({
      id: "run-ante-research",
      name: "Run @ante research on current note",
      callback: async () => this.runPresetFromContextMenu("research")
    });

    this.addCommand({
      id: "run-ante-plan",
      name: "Run @ante plan on current note",
      callback: async () => this.runPresetFromContextMenu("plan")
    });

    this.addCommand({
      id: "run-ante-summary",
      name: "Run @ante summary on current note",
      callback: async () => this.runPresetFromContextMenu("summary")
    });
  }

  private registerEditorMenu(): void {
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        populateEditorMenu(menu, editor, this);
      })
    );
  }

  private registerMentionTrigger(): void {
    // Debounce editor-change to avoid firing mention detection on every keystroke.
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor) => {
        if (this.editorChangeDebounceTimer != null) {
          window.clearTimeout(this.editorChangeDebounceTimer);
        }
        this.editorChangeDebounceTimer = window.setTimeout(() => {
          void this.mentionTrigger.handleEditorChange(editor);
          this.editorChangeDebounceTimer = null;
        }, 150);
      })
    );
  }

  private async ensureLeaf(viewType: string): Promise<WorkspaceLeaf> {
    let leaf = this.app.workspace.getLeavesOfType(viewType)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
    }
    return leaf;
  }

  private async checkForPluginUpdateOnStartup(): Promise<void> {
    const result = await this.pluginUpdater.checkForUpdate();
    if (!result.updateAvailable || !result.latestVersion) {
      return;
    }
    if (this.pluginUpdateState.lastNotifiedVersion === result.latestVersion) {
      return;
    }

    this.pluginUpdateState.lastNotifiedVersion = result.latestVersion;
    this.pluginData = {
      ...this.pluginData,
      settings: this.settings,
      pluginUpdateState: this.pluginUpdateState
    };
    await this.saveData(this.pluginData);
    new Notice(`Ante Obsidian ${result.latestVersion} is available. Open settings to review the update.`, 9000);
  }
}
