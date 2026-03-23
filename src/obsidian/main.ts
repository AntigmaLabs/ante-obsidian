import { Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import { TaskEngine } from "../core/task-engine";
import type { ContextSnapshot, PresetId } from "../core/types";
import { MentionTriggerService } from "./mention-trigger";
import { ObsidianHostAdapter } from "./host-adapter";
import { populateEditorMenu } from "./editor-menu";
import { TmdSettingTab } from "./settings-tab";
import { DEFAULT_SETTINGS, normalizeSettings, type TmdSettings } from "./settings";
import { AnteServeRuntimeAdapter } from "../runtime/ante-serve-adapter";
import { TMD_DIFF_VIEW_TYPE, TmdDiffView } from "./diff-view";
import { TMD_CONSOLE_VIEW_TYPE, TmdConsoleView } from "./console-view";
import { TMD_TERMINAL_VIEW_TYPE, TmdTerminalView } from "./terminal-view";
import type { TaskRecord } from "../core/types";
import { readAnteDefaults, type AnteDefaults } from "./ante-defaults";
import { normalizeEnvVarName, readCommandPathFromLoginShell, readEnvVarFromLoginShell } from "./shell-env";

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
  private runtime!: AnteServeRuntimeAdapter;
  private mentionTrigger!: MentionTriggerService;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.loadAnteDefaults();
    await this.loadShellEnv();

    this.hostAdapter = new ObsidianHostAdapter(this.app);
    this.runtime = new AnteServeRuntimeAdapter(() => {
      const resolved = this.getResolvedAnteTarget();
      const geminiEnvKey = normalizeEnvVarName(this.settings.geminiApiKeyEnvKey);
      const geminiApiKey =
        this.settings.geminiApiKey.trim() ||
        (geminiEnvKey ? this.shellEnv[geminiEnvKey]?.trim() ?? "" : "") ||
        (geminiEnvKey ? process.env[geminiEnvKey]?.trim() ?? "" : "");
      return {
        command: this.getResolvedAnteCommand(),
        argsJson: this.settings.argsJson,
        cwd: this.settings.cwd,
        model: resolved.model,
        provider: resolved.provider,
        autoApproveTools: this.settings.autoApproveAnteTools,
        env:
          resolved.provider === "gemini" && geminiEnvKey && geminiApiKey
            ? { [geminiEnvKey]: geminiApiKey }
            : {}
      };
    });
    this.taskEngine = new TaskEngine(this.runtime, this.hostAdapter);
    this.mentionTrigger = new MentionTriggerService(this.app, this, () => this.settings.mentionTriggerDebug);

    this.registerView(TMD_DIFF_VIEW_TYPE, (leaf) => new TmdDiffView(leaf, this));
    this.registerView(TMD_CONSOLE_VIEW_TYPE, (leaf) => new TmdConsoleView(leaf, this));
    this.registerView(TMD_TERMINAL_VIEW_TYPE, (leaf) => new TmdTerminalView(leaf, this));

    this.addSettingTab(new TmdSettingTab(this));
    this.registerCommands();
    this.registerEditorMenu();
    this.registerMentionTrigger();
  }

  async onunload(): Promise<void> {
    this.mentionTrigger?.destroy();
    this.runtime?.dispose();
    this.app.workspace.detachLeavesOfType(TMD_DIFF_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(TMD_CONSOLE_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(TMD_TERMINAL_VIEW_TYPE);
  }

  async saveSettings(): Promise<void> {
    await this.loadShellEnv();
    await this.saveData(this.settings);
  }

  async loadSettings(): Promise<void> {
    const stored = await this.loadData();
    this.settings = normalizeSettings(stored as Partial<TmdSettings> | null | undefined);
  }

  async loadAnteDefaults(): Promise<void> {
    const defaults = await readAnteDefaults();
    if (defaults) {
      this.anteDefaults = defaults;
    }
  }

  async loadShellEnv(): Promise<void> {
    const envKey = normalizeEnvVarName(this.settings.geminiApiKeyEnvKey);
    const commandValue = this.settings.command.trim();
    this.resolvedAnteCommand = !commandValue || commandValue === DEFAULT_SETTINGS.command ? await readCommandPathFromLoginShell("ante") : "";
    if (!envKey) {
      this.shellEnv = {};
      return;
    }
    const value = await readEnvVarFromLoginShell(envKey);
    this.shellEnv = value ? { [envKey]: value } : {};
  }

  async runMentionTask(presetId: PresetId, context: ContextSnapshot, inlineInstruction: string): Promise<string> {
    return this.taskEngine.startDocumentTask({
      presetId,
      triggerSource: "mention",
      context,
      inlineInstruction
    });
  }

  async runPresetFromContextMenu(presetId: PresetId): Promise<void> {
    try {
      const context = await this.hostAdapter.getActiveContext();
      if (!context) {
        throw new Error("Open a Markdown note or select some text before running Ante");
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

  async openConsoleView(): Promise<void> {
    const leaf = await this.ensureLeaf(TMD_CONSOLE_VIEW_TYPE);
    await leaf.setViewState({ type: TMD_CONSOLE_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async openTerminalView(): Promise<void> {
    const leaf = await this.ensureLeaf(TMD_TERMINAL_VIEW_TYPE);
    await leaf.setViewState({ type: TMD_TERMINAL_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
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
        new Notice(`${sourceLabel} Ante diff is ready in Tmd Results`);
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
      new Notice(`${sourceLabel} Ante result is ready in Tmd Results`);
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

  getResolvedAnteCommand(): string {
    const configured = this.settings.command.trim();
    if (!configured || configured === DEFAULT_SETTINGS.command) {
      return this.resolvedAnteCommand || DEFAULT_SETTINGS.command;
    }
    return configured;
  }

  private registerCommands(): void {
    this.addCommand({
      id: "open-tmd-results",
      name: "Open Tmd Results",
      callback: async () => this.openDiffView()
    });

    this.addCommand({
      id: "open-ante-console",
      name: "Open Ante Console",
      callback: async () => this.openConsoleView()
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
