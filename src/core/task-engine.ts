import type { HostAdapter } from "../obsidian/host-adapter";
import type { AnteRuntime } from "../runtime/ante-runtime";
import { getArtifactTargetPath, toDocumentChangeArtifact } from "./artifacts";
import type {
  ContextSnapshot,
  DocumentChangeArtifact,
  PresetDefinition,
  RuntimeChangeSuggestion,
  RuntimeApprovalDecision,
  RuntimeEvent,
  TaskRecord,
  TaskRequest,
  TmdState,
  TaskTriggerSource,
  PresetId
} from "./types";
import { createInitialState } from "./types";

type StateListener = (state: TmdState) => void;

const MAX_STDOUT_BUFFER_CHARS = 16000;
const STDOUT_FLUSH_INTERVAL_MS = 100;

const appendStdoutPreview = (existing: string, incoming: string, preserveFullText: boolean): string => {
  if (!incoming) {
    return existing;
  }

  const combined = existing + incoming;
  if (preserveFullText) {
    return combined;
  }
  if (combined.length <= MAX_STDOUT_BUFFER_CHARS) {
    return combined;
  }

  return combined.slice(-MAX_STDOUT_BUFFER_CHARS);
};

const deriveTaskStatusFromArtifacts = (task: TaskRecord): TaskRecord["status"] => {
  if (task.artifacts.length === 0) {
    return task.status;
  }

  const states = task.artifacts.map((artifact) => artifact.applyState);

  if (states.some((state) => state === "failed")) {
    return "failed";
  }
  if (states.some((state) => state === "pending" || state === "applying" || state === "reverting")) {
    return "awaiting-apply";
  }
  if (states.every((state) => state === "applied")) {
    return "applied";
  }
  if (states.every((state) => state === "discarded")) {
    return "discarded";
  }
  return "completed";
};

interface StartDocumentTaskInput {
  presetId: PresetId;
  triggerSource: Exclude<TaskTriggerSource, "chat">;
  context?: ContextSnapshot | null;
  inlineInstruction?: string;
  captureChangesAsArtifacts?: boolean;
}

export class TaskEngine {
  private state = createInitialState();
  private readonly listeners = new Set<StateListener>();
  private activeTaskId: string | null = null;
  private readonly pendingStdout = new Map<string, { chunks: string[]; timer: ReturnType<typeof setTimeout> | null }>();

  constructor(
    private readonly runtime: AnteRuntime,
    private readonly host: HostAdapter,
    private readonly resolvePresetById: (presetId: PresetId) => PresetDefinition,
    private readonly shouldPreserveFullStdout: () => boolean = () => false
  ) {}

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
      captureChangesAsArtifacts: input.captureChangesAsArtifacts ?? true
    };
    await this.runTask(request);
    return request.taskId;
  }

  async startChatTask(prompt: string, followUp = false, contextOverride?: ContextSnapshot | null): Promise<string> {
    return this.startInteractiveTask("chat", prompt, followUp, contextOverride);
  }

  async queueChatTask(
    taskId: string,
    prompt: string,
    followUp = false,
    contextOverride?: ContextSnapshot | null,
    runtimeSessionId?: string | null
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
      mode: followUp ? "followup" : "initial",
      followUpPrompt: followUp ? prompt.trim() : undefined,
      runtimeSessionId: followUp ? runtimeSessionId ?? undefined : undefined
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
    contextOverride?: ContextSnapshot | null
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
      mode: followUp ? "followup" : "initial",
      followUpPrompt: followUp ? prompt.trim() : undefined,
      runtimeSessionId: followUp ? latestSession?.sessionId : undefined
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
    const remainingTasks = this.state.tasks.filter((task) => task.triggerSource !== triggerSource);
    const removedTaskIds = new Set(
      this.state.tasks
        .filter((task) => task.triggerSource === triggerSource)
        .map((task) => task.id)
    );

    for (const taskId of removedTaskIds) {
      const pending = this.pendingStdout.get(taskId);
      if (pending?.timer != null) {
        clearTimeout(pending.timer);
      }
      this.pendingStdout.delete(taskId);
    }

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
    const remainingTasks = this.state.tasks.filter((task) => !removedTaskIds.has(task.id));

    for (const taskId of removedTaskIds) {
      const pending = this.pendingStdout.get(taskId);
      if (pending?.timer != null) {
        clearTimeout(pending.timer);
      }
      this.pendingStdout.delete(taskId);
    }

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
    this.appendLog(taskId, "system", `Approval sent: ${decision}`);
  }

  async applyArtifact(taskId: string, artifactId: string, options?: { skipHost?: boolean }): Promise<void> {
    const artifact = this.getArtifact(taskId, artifactId);
    this.patchArtifact(taskId, artifactId, {
      applyState: "applying",
      applyError: undefined
    });
    this.reconcileTaskStatus(taskId);

    try {
      if (!options?.skipHost) {
        await this.host.applyDocumentChange(artifact);
      }
      this.patchArtifact(taskId, artifactId, { applyState: "applied" });
      this.reconcileTaskStatus(taskId);
    } catch (error) {
      this.patchArtifact(taskId, artifactId, {
        applyState: "failed",
        applyError: error instanceof Error ? error.message : String(error)
      });
      this.reconcileTaskStatus(taskId);
      throw error;
    }
  }

  async discardArtifact(taskId: string, artifactId: string): Promise<void> {
    const artifact = this.getArtifact(taskId, artifactId);

    if (artifact.applyState === "applied") {
      this.patchArtifact(taskId, artifactId, {
        applyState: "reverting",
        applyError: undefined
      });
      this.reconcileTaskStatus(taskId);

      try {
        await this.host.revertDocumentChange(artifact);
      } catch (error) {
        this.patchArtifact(taskId, artifactId, {
          applyState: "failed",
          applyError: error instanceof Error ? error.message : String(error)
        });
        this.reconcileTaskStatus(taskId);
        throw error;
      }

      this.patchArtifact(taskId, artifactId, {
        applyState: "pending",
        applyError: undefined
      });
      this.reconcileTaskStatus(taskId);
      return;
    }

    this.patchArtifact(taskId, artifactId, { applyState: "discarded", applyError: undefined });
    this.reconcileTaskStatus(taskId);
  }

  async applyAllArtifacts(taskId: string): Promise<void> {
    const task = this.getTask(taskId);
    const pendingArtifacts = task.artifacts.filter(
      (artifact) => artifact.applyState !== "applied" && artifact.applyState !== "discarded"
    );

    for (const artifact of pendingArtifacts) {
      await this.applyArtifact(taskId, artifact.id);
    }
  }

  async revertArtifact(taskId: string, artifactId: string): Promise<void> {
    const artifact = this.getArtifact(taskId, artifactId);
    this.patchArtifact(taskId, artifactId, {
      applyState: "reverting",
      applyError: undefined
    });
    this.reconcileTaskStatus(taskId);

    try {
      await this.host.revertDocumentChange(artifact);
      this.patchArtifact(taskId, artifactId, { applyState: "reverted" });
      this.reconcileTaskStatus(taskId);
    } catch (error) {
      this.patchArtifact(taskId, artifactId, {
        applyState: "failed",
        applyError: error instanceof Error ? error.message : String(error)
      });
      this.reconcileTaskStatus(taskId);
      throw error;
    }
  }

  async revealArtifact(taskId: string, artifactId: string): Promise<void> {
    const artifact = this.getArtifact(taskId, artifactId);
    await this.host.revealDocumentChange(artifact);
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
          void this.handleRuntimeEvent(request, event);
        },
        onExit: (result) => {
          this.flushPendingStdout(request.taskId);
          if (result.status === "cancelled") {
            this.patchTask(request.taskId, {
              pendingApproval: undefined,
              status: "failed",
              error: "Ante task cancelled",
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
                status: task.artifacts.length > 0 ? "awaiting-apply" : "completed",
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

  private async handleRuntimeEvent(request: TaskRequest, event: RuntimeEvent): Promise<void> {
    if (!(event.type === "log" && event.stream === "stdout")) {
      this.flushPendingStdout(request.taskId);
    }

    switch (event.type) {
      case "log":
        this.appendLog(request.taskId, event.stream, event.text);
        return;
      case "runtime.session":
        this.patchTask(request.taskId, { runtimeSession: event });
        return;
      case "session.approval":
        this.patchTask(request.taskId, { pendingApproval: event.approval });
        return;
      case "process.update":
        this.patchTask(request.taskId, { processLane: event.process });
        return;
      case "result.text":
        this.patchTask(request.taskId, {
          pendingApproval: undefined,
          textResult: {
            kind: "text",
            text: event.text
          }
        });
        return;
      case "result.change": {
        if (request.captureChangesAsArtifacts === false) {
          await this.captureInlineAndArtifactChanges(request, [event.change]);
          return;
        }
        await this.addArtifactsFromChanges(request, [event.change]);
        return;
      }
      case "result.changes":
        if (request.captureChangesAsArtifacts === false) {
          await this.captureInlineAndArtifactChanges(request, event.changes);
          return;
        }
        await this.addArtifactsFromChanges(request, event.changes);
        return;
      case "session.completed": {
        const task = this.getTask(request.taskId);
        this.patchTask(request.taskId, {
          pendingApproval: undefined,
          processLane: undefined,
          status: task.artifacts.length > 0 ? "awaiting-apply" : "completed",
          endedAt: new Date().toISOString()
        });
        return;
      }
      case "session.failed":
        this.patchTask(request.taskId, {
          pendingApproval: undefined,
          processLane: undefined,
          status: "failed",
          error: event.error,
          endedAt: new Date().toISOString()
        });
    }
  }

  private appendLog(taskId: string, stream: TaskRecord["logs"][number]["stream"], text: string): void {
    if (stream === "stdout") {
      this.queueStdout(taskId, text);
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

  private queueStdout(taskId: string, text: string): void {
    const pending = this.pendingStdout.get(taskId) ?? { chunks: [], timer: null };
    pending.chunks.push(text);
    if (pending.timer == null) {
      pending.timer = setTimeout(() => {
        this.flushPendingStdout(taskId);
      }, STDOUT_FLUSH_INTERVAL_MS);
    }
    this.pendingStdout.set(taskId, pending);
  }

  private flushPendingStdout(taskId: string): void {
    const pending = this.pendingStdout.get(taskId);
    if (!pending || pending.chunks.length === 0) {
      if (pending?.timer != null) {
        clearTimeout(pending.timer);
        this.pendingStdout.delete(taskId);
      }
      return;
    }

    if (pending.timer != null) {
      clearTimeout(pending.timer);
    }

    this.pendingStdout.delete(taskId);
    const task = this.getTask(taskId);
    this.patchTask(taskId, {
      stdoutText: appendStdoutPreview(task.stdoutText, pending.chunks.join(""), this.shouldPreserveFullStdout())
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

  private reconcileTaskStatus(taskId: string): void {
    const task = this.getTask(taskId);
    this.patchTask(taskId, { status: deriveTaskStatusFromArtifacts(task) });
  }

  private appendInlineChanges(taskId: string, changes: RuntimeChangeSuggestion[]): void {
    const task = this.getTask(taskId);
    this.patchTask(taskId, {
      inlineChanges: [...(task.inlineChanges ?? []), ...changes],
      pendingApproval: undefined
    });
  }

  private async captureInlineAndArtifactChanges(request: TaskRequest, changes: RuntimeChangeSuggestion[]): Promise<void> {
    const { inlineChanges, artifactChanges } = this.partitionInlineAndArtifactChanges(request, changes);

    if (inlineChanges.length > 0) {
      this.appendInlineChanges(request.taskId, inlineChanges);
    }
    if (artifactChanges.length > 0) {
      await this.addArtifactsFromChanges(request, artifactChanges);
    }
  }

  private partitionInlineAndArtifactChanges(
    request: TaskRequest,
    changes: RuntimeChangeSuggestion[]
  ): { inlineChanges: RuntimeChangeSuggestion[]; artifactChanges: RuntimeChangeSuggestion[] } {
    const inlineChanges: RuntimeChangeSuggestion[] = [];
    const artifactChanges: RuntimeChangeSuggestion[] = [];

    for (const change of changes) {
      const isInlineEligible =
        (change.operation === "append-block" || change.operation === "replace-selection") &&
        (!change.targetPath || change.targetPath === request.context.filePath);

      if (isInlineEligible) {
        inlineChanges.push(change);
      } else {
        artifactChanges.push(change);
      }
    }

    return { inlineChanges, artifactChanges };
  }

  private async addArtifactsFromChanges(request: TaskRequest, changes: RuntimeChangeSuggestion[]): Promise<void> {
    const task = this.getTask(request.taskId);
    const existingArtifactsByTarget = new Map<string, DocumentChangeArtifact>();
    for (const artifact of task.artifacts) {
      existingArtifactsByTarget.set(getArtifactTargetPath(artifact), artifact);
    }

    const workingTexts = new Map<string, string>();

    for (const change of changes) {
      const targetPath = this.resolveChangeTargetPath(change, request.context);
      if (!targetPath) {
        continue;
      }

      const existingTargetText =
        workingTexts.get(targetPath) ??
        (change.operation === "create-file"
          ? ""
          : targetPath !== request.context.filePath
            ? (await this.host.readFile(targetPath)) ?? ""
            : request.context.documentText ?? "");

      const contextForChange: ContextSnapshot =
        targetPath === request.context.filePath
          ? {
              ...request.context,
              documentText: existingTargetText
            }
          : request.context;

      const artifact = this.normalizeArtifactToFileUnit(
        toDocumentChangeArtifact(change, contextForChange, existingTargetText)
      );
      workingTexts.set(targetPath, artifact.afterText);
      existingArtifactsByTarget.set(
        targetPath,
        this.mergeArtifactsByFile(existingArtifactsByTarget.get(targetPath), artifact)
      );
    }

    this.patchTask(request.taskId, {
      artifacts: [...existingArtifactsByTarget.values()],
      pendingApproval: undefined,
      status: "awaiting-apply"
    });
  }

  private resolveChangeTargetPath(change: RuntimeChangeSuggestion, context: ContextSnapshot): string | null {
    if (change.operation === "create-file") {
      return change.targetPath?.trim() || null;
    }
    return change.targetPath?.trim() || context.filePath;
  }

  private normalizeArtifactToFileUnit(artifact: DocumentChangeArtifact): DocumentChangeArtifact {
    const path = getArtifactTargetPath(artifact);
    return {
      ...artifact,
      operation: artifact.operation === "create-file" ? "create-file" : "replace-file",
      target: {
        type: "file",
        path
      }
    };
  }

  private mergeArtifactsByFile(
    previous: DocumentChangeArtifact | undefined,
    next: DocumentChangeArtifact
  ): DocumentChangeArtifact {
    if (!previous) {
      return next;
    }

    return {
      ...next,
      id: previous.id,
      operation: previous.operation === "create-file" ? "create-file" : next.operation,
      beforeText: previous.beforeText,
      sourceChanges: [...previous.sourceChanges, ...next.sourceChanges],
      applyState: previous.applyState === "applied" ? "pending" : next.applyState,
      applyError: undefined
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
