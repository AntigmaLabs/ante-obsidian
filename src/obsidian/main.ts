import { MarkdownView, Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import { TaskEngine } from "../core/task-engine";
import type { ContextSnapshot, PresetId } from "../core/types";
import { MentionTriggerService } from "./mention-trigger";
import { ObsidianHostAdapter } from "./host-adapter";
import { populateEditorMenu } from "./editor-menu";
import { TmdSettingTab } from "./settings-tab";
import { DEFAULT_SETTINGS, normalizeSettings, type TmdSettings } from "./settings";
import type { AnteRuntime } from "../runtime/ante-runtime";
import { createAnteRuntime } from "../runtime/create-ante-runtime";
import { TMD_DIFF_VIEW_TYPE, TmdDiffView } from "./diff-view";
import { TMD_CHAT_VIEW_TYPE, TmdChatView } from "./chat-view";
import { TMD_TERMINAL_VIEW_TYPE, TmdTerminalView } from "./terminal-view";
import type { TaskRecord } from "../core/types";
import { readAnteDefaults, type AnteDefaults } from "./ante-defaults";
import { normalizeEnvVarName, readCommandPathFromLoginShell, readEnvVarFromLoginShell } from "./shell-env";
import { ChatSessionManager } from "../core/chat-session-manager";
import type { ChatPersistenceState } from "../core/chat-types";
import { getResolvedPreset, listResolvedPresets } from "../core/presets";
import { AnteUpdater } from "./ante-updater";

interface TmdPluginData {
  settings?: Partial<TmdSettings>;
  chatState?: ChatPersistenceState | null;
}

export default class TmdPlugin extends Plugin {
  settings: TmdSettings = DEFAULT_SETTINGS;
  anteDefaults: AnteDefaults = {
    provider: DEFAULT_SETTINGS.anteProvider,
    model: DEFAULT_SETTINGS.anteModel
  };
  shellEnv: Record<string, string> = {};
  resolvedAnteCommand = "";
  hostAdapter!: ObsidianHostAdapter;
  taskEngine!: TaskEngine;
  chatManager!: ChatSessionManager;
  mentionTrigger!: MentionTriggerService;
  anteUpdater!: AnteUpdater;
  private runtime!: AnteRuntime;
  private pluginData: TmdPluginData = {};

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.loadAnteDefaults();
    await this.loadShellEnv();

    this.hostAdapter = new ObsidianHostAdapter(this.app);
    this.anteUpdater = new AnteUpdater();
    this.runtime = createAnteRuntime(() => {
      const resolved = this.getResolvedAnteTarget();
      const geminiEnvKey = normalizeEnvVarName(this.settings.geminiApiKeyEnvKey);
      const geminiApiKey =
        this.settings.geminiApiKey.trim() ||
        (geminiEnvKey ? this.shellEnv[geminiEnvKey]?.trim() ?? "" : "") ||
        (geminiEnvKey ? process.env[geminiEnvKey]?.trim() ?? "" : "");
      return {
        connectionMode: this.settings.connectionMode,
        command: "ante",
        argsJson: this.settings.argsJson,
        cwd: "",
        wsAddress: this.settings.wsAddress,
        model: resolved.model,
        provider: resolved.provider,
        autoApproveTools: this.settings.autoApproveAnteTools,
        env:
          resolved.provider === "gemini" && geminiEnvKey && geminiApiKey
            ? { [geminiEnvKey]: geminiApiKey }
            : {}
      };
    });
    this.taskEngine = new TaskEngine(
      this.runtime,
      this.hostAdapter,
      (presetId) => this.getPresetById(presetId),
      () => this.shouldShowFullProcessLogs()
    );
    this.chatManager = new ChatSessionManager(this, this.pluginData.chatState);
    this.taskEngine.subscribe((state) => {
      this.chatManager.syncFromTaskState(state);
    });
    this.mentionTrigger = new MentionTriggerService(this.app, this, () => this.settings.mentionTriggerDebug);

    this.registerView(TMD_DIFF_VIEW_TYPE, (leaf) => new TmdDiffView(leaf, this));
    this.registerView(TMD_CHAT_VIEW_TYPE, (leaf) => new TmdChatView(leaf, this));
    this.registerView(TMD_TERMINAL_VIEW_TYPE, (leaf) => new TmdTerminalView(leaf, this));

    this.addSettingTab(new TmdSettingTab(this));
    this.registerCommands();
    this.registerEditorMenu();
    this.registerMentionTrigger();
  }

  async onunload(): Promise<void> {
    this.mentionTrigger?.destroy();
    await this.runtime?.persistActiveSession().catch(() => {});
    this.chatManager?.dispose();
    this.runtime?.dispose();
    this.app.workspace.detachLeavesOfType(TMD_DIFF_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(TMD_CHAT_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(TMD_TERMINAL_VIEW_TYPE);
  }

  async saveSettings(): Promise<void> {
    await this.loadShellEnv();
    this.pluginData = {
      ...this.pluginData,
      settings: this.settings
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
  }

  async saveChatState(chatState: ChatPersistenceState): Promise<void> {
    this.pluginData = {
      ...this.pluginData,
      settings: this.settings,
      chatState
    };
    await this.saveData(this.pluginData);
  }

  private async handoffAnteSession(action: () => void | Promise<void>, reason: string): Promise<void> {
    console.info("[tmd session]", reason);
    await this.persistIdleAnteSession();
    await action();
  }

  async activateChatConversation(conversationId: string): Promise<void> {
    if (this.chatManager.getActiveConversation().id === conversationId) {
      return;
    }
    await this.handoffAnteSession(
      () => {
        this.chatManager.setActiveConversation(conversationId);
      },
      `Switching chat conversation · next=${conversationId}`
    );
  }

  async createChatConversation(context?: ContextSnapshot | null): Promise<void> {
    await this.handoffAnteSession(
      () => {
        this.chatManager.createConversation({ context: context ?? undefined });
      },
      "Creating new chat conversation"
    );
  }

  async deleteChatConversation(conversationId: string): Promise<void> {
    const sessionId = this.chatManager.getConversationRuntimeSessionId(conversationId);
    const activeSessionId = this.runtime.getActiveSessionId();
    console.info(
      "[tmd session]",
      `Deleting chat conversation · id=${conversationId} · session=${sessionId ?? "none"} · active=${activeSessionId ?? "none"}`
    );
    const removedTaskIds = this.chatManager.removeConversation(conversationId);
    this.taskEngine.clearTasks(removedTaskIds);
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
    const envKey = normalizeEnvVarName(this.settings.geminiApiKeyEnvKey);
    this.resolvedAnteCommand = await readCommandPathFromLoginShell("ante");
    if (!envKey) {
      this.shellEnv = {};
      return;
    }
    const value = await readEnvVarFromLoginShell(envKey);
    this.shellEnv = value ? { [envKey]: value } : {};
  }

  async refreshAnteEnvironment(): Promise<void> {
    await this.loadShellEnv();
    await this.loadAnteDefaults();
  }

  shouldShowFullProcessLogs(): boolean {
    return this.settings.showFullProcessLogs;
  }

  async runPresetFromContextMenu(presetId: PresetId): Promise<void> {
    try {
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
          triggerSource: "context-menu",
          captureChangesAsArtifacts: false
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
    void this.runtime.ensureWarmSession().catch(() => {
      // Ignore idle warmup failures here; the visible task path still surfaces errors.
    });
  }

  async openResultsView(): Promise<void> {
    await this.openDiffView();
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
            void this.openResultsView();
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
        void this.openResultsView();
        new Notice(failedArtifact.applyError);
        return;
      }
      this.handleNonArtifactTaskCompletion(task, sourceLabel);
    });
  }

  watchTaskForResults(taskId: string, sourceLabel: string): void {
    let settled = false;
    const unsubscribe = this.taskEngine.subscribe((state) => {
      if (settled) {
        return;
      }
      const task = state.tasks.find((entry) => entry.id === taskId);
      if (!task || task.status === "running") {
        return;
      }

      settled = true;
      unsubscribe();

      if (task.artifacts.length > 0) {
        void this.openResultsView();
        new Notice(`${sourceLabel} Ante diff is ready in Results`);
        return;
      }
      if (task.error) {
        new Notice(task.error);
        return;
      }
    });
  }

  private handleNonArtifactTaskCompletion(task: TaskRecord, sourceLabel: string): void {
    if (task.textResult?.text.trim()) {
      void this.openResultsView();
      new Notice(`${sourceLabel} Ante result is ready in Results`);
      return;
    }

    if (task.error) {
      void this.openResultsView();
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
      id: "open-tmd-results",
      name: "Open Results",
      callback: async () => this.openDiffView()
    });

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
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor) => {
        void this.mentionTrigger.handleEditorChange(editor);
      })
    );
  }

  private async openDiffView(): Promise<void> {
    const leaf = await this.ensureLeaf(TMD_DIFF_VIEW_TYPE);
    await leaf.setViewState({ type: TMD_DIFF_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private async ensureLeaf(viewType: string): Promise<WorkspaceLeaf> {
    let leaf = this.app.workspace.getLeavesOfType(viewType)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
    }
    return leaf;
  }
}
