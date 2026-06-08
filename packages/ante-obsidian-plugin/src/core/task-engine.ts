import type { HostAdapter } from "./host-adapter";
import type { AnteRuntime } from "../runtime/ante-runtime";
import type {
  ContextSnapshot,
  DocumentChangeArtifact,
  PresetDefinition,
  RuntimeApprovalDecision,
  RuntimeTelemetryState,
  TaskRecord,
  TaskRequest,
  TmdState,
  TaskTriggerSource,
  PresetId
} from "./types";
import { createInitialState } from "./types";
import { TaskStdoutBuffer } from "./task-stdout-buffer";
import { TaskArtifactManager, deriveTaskStatusFromArtifacts } from "./task-artifact-manager";
import { TaskEventHandler } from "./task-event-handler";

type StateListener = (state: TmdState) => void;

const logDebug = (...args: unknown[]): void => {
  void args;
};

interface StartDocumentTaskInput {
  presetId: PresetId;
  triggerSource: Exclude<TaskTriggerSource, "chat">;
  context?: ContextSnapshot | null;
  inlineInstruction?: string;
}

export class TaskEngine {
  private state = createInitialState();
  private readonly listeners = new Set<StateListener>();
  private activeTaskId: string | null = null;

  private readonly stdoutBuffer: TaskStdoutBuffer;
  private readonly artifactManager: TaskArtifactManager;
  private readonly eventHandler: TaskEventHandler;

  constructor(
    private readonly runtime: AnteRuntime,
    private readonly host: HostAdapter,
    private readonly resolvePresetById: (presetId: PresetId) => PresetDefinition,
    private readonly shouldPreserveFullStdout: () => boolean = () => false,
    private readonly getObsidianCliPromptBlock: () => string = () => ""
  ) {
    this.stdoutBuffer = new TaskStdoutBuffer(
      this.shouldPreserveFullStdout,
      (taskId, incomingChunksCombined) => {
        const task = this.getTask(taskId);
        this.patchTask(taskId, {
          stdoutText: this.stdoutBuffer.appendStdoutPreview(task.stdoutText, incomingChunksCombined)
        });
      }
    );

    this.artifactManager = new TaskArtifactManager(
      this.runtime,
      this.host,
      {
        getTask: (taskId) => this.getTask(taskId),
        patchTask: (taskId, patch) => this.patchTask(taskId, patch),
        patchArtifact: (taskId, artifactId, patch) => this.patchArtifact(taskId, artifactId, patch),
        patchArtifacts: (taskId, updater) => this.patchArtifacts(taskId, updater),
        respondToTaskApproval: (taskId, decision) => this.respondToTaskApproval(taskId, decision),
        appendLog: (taskId, stream, text) => this.appendLog(taskId, stream, text),
        logDebug: (...args) => logDebug(...args)
      }
    );

    this.eventHandler = new TaskEventHandler(
      this.runtime,
      this.host,
      this.artifactManager,
      this.stdoutBuffer,
      {
        getTask: (taskId) => this.getTask(taskId),
        patchTask: (taskId, patch) => this.patchTask(taskId, patch),
        patchArtifacts: (taskId, updater) => this.patchArtifacts(taskId, updater),
        updateTaskTelemetry: (taskId, updater) => this.updateTaskTelemetry(taskId, updater),
        appendLog: (taskId, stream, text) => this.appendLog(taskId, stream, text)
      }
    );
  }

  getState(): TmdState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async startDocumentTask(input: StartDocumentTaskInput): Promise<string> {
    const context = input.context ?? (await this.host.getActiveContext());
    if (!context || (!context.documentText?.trim() && !context.selection?.text.trim())) {
      throw new Error("Open a Markdown note or select some text before running Ante");
    }

    const request: TaskRequest = {
      taskId: crypto.randomUUID(),
      kind: "document",
      triggerSource: input.triggerSource,
      preset: this.resolvePresetById(input.presetId),
      context,
      inlineInstruction: input.inlineInstruction?.trim() ?? "",
      obsidianCliPromptBlock: this.getObsidianCliPromptBlock()
    };
    await this.runTask(request);
    return request.taskId;
  }

  async startChatTask(
    prompt: string,
    followUp = false,
    contextOverride?: ContextSnapshot | null,
    runtimeTarget?: TaskRequest["runtimeTarget"]
  ): Promise<string> {
    return this.startInteractiveTask(
      "chat",
      prompt,
      followUp,
      contextOverride,
      runtimeTarget
    );
  }

  async queueChatTask(
    taskId: string,
    prompt: string,
    followUp = false,
    contextOverride?: ContextSnapshot | null,
    runtimeSessionId?: string | null,
    runtimeTarget?: TaskRequest["runtimeTarget"]
  ): Promise<string> {
    const context = contextOverride ?? (await this.host.getPreferredContext()) ?? {
      vaultPath: null,
      filePath: null,
      noteTitle: null,
      documentText: null,
      selection: null
    };

    const request: TaskRequest = {
      taskId,
      kind: "chat",
      triggerSource: "chat",
      preset: this.resolvePresetById("default"),
      context,
      inlineInstruction: prompt.trim(),
      obsidianCliPromptBlock: this.getObsidianCliPromptBlock(),
      mode: followUp ? "followup" : "initial",
      followUpPrompt: followUp ? prompt.trim() : undefined,
      runtimeSessionId: followUp ? runtimeSessionId ?? undefined : undefined,
      runtimeTarget
    };
    await this.runTask(request);
    return request.taskId;
  }

  async startTerminalTask(prompt: string, followUp = false, contextOverride?: ContextSnapshot | null): Promise<string> {
    return this.startInteractiveTask("terminal", prompt, followUp, contextOverride);
  }

  private async startInteractiveTask(
    triggerSource: "chat" | "terminal",
    prompt: string,
    followUp: boolean,
    contextOverride?: ContextSnapshot | null,
    runtimeTarget?: TaskRequest["runtimeTarget"]
  ): Promise<string> {
    const context = contextOverride ?? (await this.host.getPreferredContext()) ?? {
      vaultPath: null,
      filePath: null,
      noteTitle: null,
      documentText: null,
      selection: null
    };
    const latestSession = this.state.tasks.find(
      (task) => task.triggerSource === triggerSource && task.runtimeSession?.sessionId
    )?.runtimeSession;

    const request: TaskRequest = {
      taskId: crypto.randomUUID(),
      kind: triggerSource,
      triggerSource,
      preset: this.resolvePresetById("default"),
      context,
      inlineInstruction: prompt.trim(),
      obsidianCliPromptBlock: this.getObsidianCliPromptBlock(),
      mode: followUp ? "followup" : "initial",
      followUpPrompt: followUp ? prompt.trim() : undefined,
      runtimeSessionId: followUp ? latestSession?.sessionId : undefined,
      runtimeTarget
    };
    await this.runTask(request);
    return request.taskId;
  }

  cancelActiveTask(): void {
    this.runtime.cancelActiveRun();
  }

  hasActiveTask(): boolean {
    return this.activeTaskId != null;
  }

  clearTasksByTriggerSource(triggerSource: TaskTriggerSource): void {
    const removedTasks = this.state.tasks.filter((task) => task.triggerSource === triggerSource);
    const remainingTasks = this.state.tasks.filter((task) => task.triggerSource !== triggerSource);
    const removedTaskIds = new Set(removedTasks.map((task) => task.id));

    for (const taskId of removedTaskIds) {
      this.stdoutBuffer.clear(taskId);
    }
    this.artifactManager.cleanupArtifactsForTasks(removedTasks);

    const currentTaskId =
      this.state.currentTaskId && removedTaskIds.has(this.state.currentTaskId)
        ? null
        : this.state.currentTaskId;

    this.state = {
      ...this.state,
      currentTaskId,
      tasks: remainingTasks
    };
    this.notify();
  }

  clearTasks(taskIds: string[]): void {
    if (taskIds.length === 0) {
      return;
    }
    const removedTaskIds = new Set(taskIds);
    const removedTasks = this.state.tasks.filter((task) => removedTaskIds.has(task.id));
    const remainingTasks = this.state.tasks.filter((task) => !removedTaskIds.has(task.id));

    for (const taskId of removedTaskIds) {
      this.stdoutBuffer.clear(taskId);
    }
    this.artifactManager.cleanupArtifactsForTasks(removedTasks);

    const currentTaskId =
      this.state.currentTaskId && removedTaskIds.has(this.state.currentTaskId)
        ? null
        : this.state.currentTaskId;

    if (this.activeTaskId && removedTaskIds.has(this.activeTaskId)) {
      this.activeTaskId = null;
    }

    this.state = {
      ...this.state,
      currentTaskId,
      tasks: remainingTasks
    };
    this.notify();
  }

  respondToTaskApproval(taskId: string, decision: RuntimeApprovalDecision): void {
    const task = this.getTask(taskId);
    if (!task.pendingApproval) {
      throw new Error("No pending Ante approval for this task");
    }
    if (this.activeTaskId !== taskId) {
      throw new Error("This Ante task is no longer active");
    }

    this.runtime.respondToApproval(task.pendingApproval, decision);
    this.patchTask(taskId, { pendingApproval: undefined });
    if (decision === "Skip" || decision === "Abort") {
      const approvalToolIds = new Set(task.pendingApproval.tools.map((tool) => tool.id));
      this.patchArtifacts(taskId, (artifact) => {
        if (!(artifact.runtimeToolId && approvalToolIds.has(artifact.runtimeToolId) && artifact.applyState === "pending")) {
          return artifact;
        }
        this.artifactManager.cleanupStagedPreview(artifact);
        return {
          ...artifact,
          applyState: "discarded",
          applyError: undefined,
          baselinePath: undefined,
          stagedPath: undefined,
          stagedRoot: undefined
        };
      });
      this.artifactManager.reconcileTaskStatus(taskId);
    }
    this.appendLog(taskId, "system", `Approval sent: ${decision}`);
  }

  async applyArtifact(taskId: string, artifactId: string, options?: { skipHost?: boolean }): Promise<void> {
    await this.artifactManager.applyArtifact(taskId, artifactId, options);
  }

  async discardArtifact(taskId: string, artifactId: string): Promise<void> {
    await this.artifactManager.discardArtifact(taskId, artifactId);
  }

  async applyAllArtifacts(taskId: string): Promise<void> {
    await this.artifactManager.applyAllArtifacts(taskId);
  }

  async revertArtifact(taskId: string, artifactId: string): Promise<void> {
    await this.artifactManager.revertArtifact(taskId, artifactId);
  }

  async revealArtifact(taskId: string, artifactId: string): Promise<void> {
    await this.artifactManager.revealArtifact(taskId, artifactId);
  }

  private async runTask(request: TaskRequest): Promise<void> {
    if (this.activeTaskId) {
      throw new Error("Wait for the current Ante task to finish");
    }

    const task: TaskRecord = {
      id: request.taskId,
      kind: request.kind,
      preset: request.preset,
      triggerSource: request.triggerSource,
      inlineInstruction: request.inlineInstruction,
      context: request.context,
      status: "running",
      logs: [],
      stdoutText: "",
      artifacts: [],
      pendingApproval: undefined,
      startedAt: new Date().toISOString()
    };

    this.activeTaskId = request.taskId;
    this.state = {
      ...this.state,
      currentTaskId: request.taskId,
      tasks: [task, ...this.state.tasks]
    };
    this.notify();

    try {
      this.runtime.run(request, {
        onEvent: (event) => {
          void this.eventHandler.handleRuntimeEvent(request, event);
        },
        onExit: (result) => {
          this.stdoutBuffer.flush(request.taskId);
          if (result.status === "cancelled") {
            this.patchTask(request.taskId, {
              pendingApproval: undefined,
              processLane: undefined,
              status: "cancelled",
              error: undefined,
              endedAt: new Date().toISOString()
            });
          } else if (result.status === "failed" && result.error) {
            this.patchTask(request.taskId, {
              pendingApproval: undefined,
              status: "failed",
              error: result.error,
              endedAt: new Date().toISOString()
            });
          } else if (result.status === "completed") {
            const task = this.getTask(request.taskId);
            if (task.status === "running") {
              this.patchTask(request.taskId, {
                pendingApproval: undefined,
                processLane: undefined,
                status: task.artifacts.length > 0 ? deriveTaskStatusFromArtifacts(task) : "completed",
                endedAt: new Date().toISOString()
              });
            }
          }
          if (this.activeTaskId === request.taskId) {
            this.activeTaskId = null;
          }
        }
      });
    } catch (error) {
      this.patchTask(request.taskId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        endedAt: new Date().toISOString()
      });
      if (this.activeTaskId === request.taskId) {
        this.activeTaskId = null;
      }
      throw error;
    }
  }

  private appendLog(taskId: string, stream: TaskRecord["logs"][number]["stream"], text: string): void {
    if (stream === "stdout") {
      this.stdoutBuffer.queue(taskId, text);
      return;
    }

    const task = this.getTask(taskId);
    this.patchTask(taskId, {
      logs: [
        ...task.logs,
        {
          stream,
          text,
          timestamp: new Date().toISOString()
        }
      ]
    });
  }

  private getTask(taskId: string): TaskRecord {
    const taskIndex = this.getTaskIndex(taskId);
    const task = this.state.tasks[taskIndex];
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }

  private getTaskIndex(taskId: string): number {
    const taskIndex = this.state.tasks.findIndex((entry) => entry.id === taskId);
    if (taskIndex === -1) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return taskIndex;
  }

  private getArtifact(taskId: string, artifactId: string): DocumentChangeArtifact {
    const artifact = this.getTask(taskId).artifacts.find((entry) => entry.id === artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    return artifact;
  }

  private patchTask(taskId: string, patch: Partial<TaskRecord>): void {
    const taskIndex = this.getTaskIndex(taskId);
    const currentTask = this.state.tasks[taskIndex];
    const patchEntries = Object.entries(patch) as [keyof TaskRecord, TaskRecord[keyof TaskRecord]][];
    if (patchEntries.every(([key, value]) => currentTask[key] === value)) {
      return;
    }
    const nextTask = { ...currentTask, ...patch };

    const nextTasks = this.state.tasks.slice();
    nextTasks[taskIndex] = nextTask;
    this.state = {
      ...this.state,
      tasks: nextTasks
    };
    this.notify();
  }

  private updateTaskTelemetry(
    taskId: string,
    updater: (telemetry: RuntimeTelemetryState) => RuntimeTelemetryState
  ): void {
    const task = this.getTask(taskId);
    const currentTelemetry: RuntimeTelemetryState = task.telemetry
      ? {
          ...task.telemetry,
          usage: task.telemetry.usage ? { ...task.telemetry.usage } : undefined,
          lastInfo: task.telemetry.lastInfo ? { ...task.telemetry.lastInfo } : undefined,
          timeline: [...task.telemetry.timeline]
        }
      : {
          timeline: []
        };
    this.patchTask(taskId, {
      telemetry: updater(currentTelemetry)
    });
  }

  private patchArtifact(taskId: string, artifactId: string, patch: Partial<DocumentChangeArtifact>): void {
    const task = this.getTask(taskId);
    const artifactIndex = task.artifacts.findIndex((artifact) => artifact.id === artifactId);
    if (artifactIndex === -1) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    const nextArtifacts = task.artifacts.slice();
    nextArtifacts[artifactIndex] = {
      ...nextArtifacts[artifactIndex],
      ...patch
    };

    this.patchTask(taskId, {
      artifacts: nextArtifacts
    });
  }

  private patchArtifacts(
    taskId: string,
    updater: (artifact: DocumentChangeArtifact) => DocumentChangeArtifact
  ): void {
    const task = this.getTask(taskId);
    const nextArtifacts = task.artifacts.map((artifact) => updater(artifact));
    const changed = nextArtifacts.some((artifact, index) => artifact !== task.artifacts[index]);
    if (!changed) {
      return;
    }
    this.patchTask(taskId, { artifacts: nextArtifacts });
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
