import type { HostAdapter } from "./host-adapter";
import type { AnteRuntime } from "../runtime/ante-runtime";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createRuntimeFileArtifact,
  toDocumentChangeArtifactFromApprovalTool
} from "./artifacts";
import type {
  ContextSnapshot,
  DocumentChangeArtifact,
  PresetDefinition,
  RuntimeApprovalDecision,
  RuntimeEvent,
  RuntimeToolCall,
  RuntimeTelemetryState,
  RuntimeTimelineEntry,
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
const MAX_RUNTIME_TIMELINE_ENTRIES = 12;
const STAGED_PREVIEW_PREFIX = "tmd-stage-";

const isDebugEnabled = (): boolean => globalThis.localStorage?.getItem("tmd-debug") === "true";

const logDebug = (...args: unknown[]): void => {
  if (isDebugEnabled()) {
    console.info("[tmd task]", ...args);
  }
};

const matchesContextFilePath = (targetPath: string | null | undefined, context: ContextSnapshot): boolean => {
  const candidate = targetPath?.trim();
  const contextPath = context.filePath?.trim();
  if (!candidate || !contextPath) {
    return false;
  }
  if (candidate === contextPath) {
    return true;
  }
  const normalizedCandidate = candidate.replace(/\\/g, "/");
  const normalizedContext = contextPath.replace(/\\/g, "/");
  return normalizedCandidate.endsWith(`/${normalizedContext}`) || normalizedCandidate.endsWith(normalizedContext);
};

const isNativeFileEditingToolName = (name: string | null | undefined): boolean => {
  const normalized = name?.trim().toLowerCase();
  return normalized === "write" || normalized === "edit";
};

const isUserSkippedToolMessage = (value: string | null | undefined): boolean =>
  /tool call skipped by user/i.test(value ?? "");

const approvalHasOnlyFileEditingTools = (approval: NonNullable<TaskRecord["pendingApproval"]>): boolean =>
  approval.tools.length > 0 && approval.tools.every((tool) => isNativeFileEditingToolName(tool.name));

const sanitizeStagePath = (value: string): string => {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const sanitized = normalized
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, "-"))
    .join("/");
  return sanitized || "untitled.md";
};

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
}

export class TaskEngine {
  private state = createInitialState();
  private readonly listeners = new Set<StateListener>();
  private activeTaskId: string | null = null;
  private readonly pendingStdout = new Map<string, { chunks: string[]; timer: ReturnType<typeof setTimeout> | null }>();
  private readonly runtimeToolCalls = new Map<
    string,
    Map<string, { tool: RuntimeToolCall; targetPath: string | null; beforeText: string }>
  >();

  constructor(
    private readonly runtime: AnteRuntime,
    private readonly host: HostAdapter,
    private readonly resolvePresetById: (presetId: PresetId) => PresetDefinition,
    private readonly shouldPreserveFullStdout: () => boolean = () => false,
    private readonly getObsidianCliPromptBlock: () => string = () => ""
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
    if (decision === "Skip" || decision === "Abort") {
      const approvalToolIds = new Set(task.pendingApproval.tools.map((tool) => tool.id));
      this.patchArtifacts(taskId, (artifact) =>
        artifact.runtimeToolId && approvalToolIds.has(artifact.runtimeToolId) && artifact.applyState === "pending"
          ? { ...artifact, applyState: "discarded", applyError: undefined }
          : artifact
      );
      this.reconcileTaskStatus(taskId);
    }
    this.appendLog(taskId, "system", `Approval sent: ${decision}`);
  }

  async applyArtifact(taskId: string, artifactId: string, options?: { skipHost?: boolean }): Promise<void> {
    const artifact = this.getArtifact(taskId, artifactId);
    const task = this.getTask(taskId);
    const approvalBackedTool =
      artifact.runtimeToolId && task.pendingApproval?.tools.some((tool) => tool.id === artifact.runtimeToolId)
        ? task.pendingApproval.tools.find((tool) => tool.id === artifact.runtimeToolId)
        : undefined;

    if (approvalBackedTool && isNativeFileEditingToolName(approvalBackedTool.name)) {
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
        this.runtime.respondToApproval(task.pendingApproval!, "Skip");
        this.patchTask(taskId, { pendingApproval: undefined });
        this.appendLog(taskId, "system", "Approval sent: Skip");
        this.reconcileTaskStatus(taskId);
        return;
      } catch (error) {
        this.patchArtifact(taskId, artifactId, {
          applyState: "failed",
          applyError: error instanceof Error ? error.message : String(error)
        });
        this.reconcileTaskStatus(taskId);
        throw error;
      }
    }

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
    const task = this.getTask(taskId);
    const approvalBackedTool =
      artifact.runtimeToolId && task.pendingApproval?.tools.some((tool) => tool.id === artifact.runtimeToolId)
        ? task.pendingApproval.tools.find((tool) => tool.id === artifact.runtimeToolId)
        : undefined;

    if (approvalBackedTool && isNativeFileEditingToolName(approvalBackedTool.name)) {
      this.respondToTaskApproval(taskId, "Skip");
      return;
    }

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
      case "session.approval": {
        const shouldAutoStageApproval =
          request.kind === "chat" && approvalHasOnlyFileEditingTools(event.approval);
        await this.addArtifactsFromApproval(request, event.approval, shouldAutoStageApproval ? "staged-preview" : "approval");
        const task = this.getTask(request.taskId);
        if (shouldAutoStageApproval) {
          this.runtime.respondToApproval(event.approval, "Skip");
          this.appendLog(request.taskId, "system", "Staged file preview created; skipped Ante file write");
          this.patchTask(request.taskId, {
            pendingApproval: undefined,
            status: task.artifacts.length > 0 ? deriveTaskStatusFromArtifacts(task) : task.status
          });
          return;
        }
        this.patchTask(request.taskId, {
          pendingApproval: event.approval,
          status: task.artifacts.length > 0 ? deriveTaskStatusFromArtifacts(task) : task.status
        });
        return;
      }
      case "session.tool":
        await this.handleRuntimeToolEvent(request, event);
        return;
      case "process.update":
        this.patchTask(request.taskId, { processLane: event.process });
        return;
      case "session.thinking":
        this.updateTaskTelemetry(request.taskId, (telemetry) => ({
          ...telemetry,
          thinkingText:
            event.mode === "full"
              ? event.text
              : `${telemetry.thinkingText ?? ""}${event.text}`
        }));
        return;
      case "session.usage":
        this.updateTaskTelemetry(request.taskId, (telemetry) => ({
          ...telemetry,
          usage: event.usage
        }));
        return;
      case "session.compaction":
        this.updateTaskTelemetry(request.taskId, (telemetry) => ({
          ...telemetry,
          compacting: event.phase === "start",
          timeline: this.appendTelemetryTimeline(telemetry.timeline, {
            kind: event.phase === "start" ? "compaction-start" : "compaction-end",
            timestamp: new Date().toISOString()
          })
        }));
        return;
      case "session.info":
        this.updateTaskTelemetry(request.taskId, (telemetry) => ({
          ...telemetry,
          lastInfo: {
            level: event.level,
            message: event.message,
            timestamp: new Date().toISOString()
          },
          timeline: this.appendTelemetryTimeline(telemetry.timeline, {
            kind: event.level,
            message: event.message,
            timestamp: new Date().toISOString()
          })
        }));
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
      case "session.completed": {
        const task = this.getTask(request.taskId);
        this.patchTask(request.taskId, {
          pendingApproval: undefined,
          processLane: undefined,
          status: task.artifacts.length > 0 ? deriveTaskStatusFromArtifacts(task) : "completed",
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

  private getRuntimeToolState(taskId: string, toolId: string): {
    tool: RuntimeToolCall;
    targetPath: string | null;
    beforeText: string;
  } | null {
    return this.runtimeToolCalls.get(taskId)?.get(toolId) ?? null;
  }

  private setRuntimeToolState(
    taskId: string,
    toolId: string,
    value: { tool: RuntimeToolCall; targetPath: string | null; beforeText: string }
  ): void {
    const tools = this.runtimeToolCalls.get(taskId) ?? new Map<string, { tool: RuntimeToolCall; targetPath: string | null; beforeText: string }>();
    tools.set(toolId, value);
    this.runtimeToolCalls.set(taskId, tools);
  }

  private deleteRuntimeToolState(taskId: string, toolId: string): void {
    const tools = this.runtimeToolCalls.get(taskId);
    if (!tools) {
      return;
    }
    tools.delete(toolId);
    if (tools.size === 0) {
      this.runtimeToolCalls.delete(taskId);
    }
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

  private appendTelemetryTimeline(
    timeline: RuntimeTimelineEntry[],
    entry: RuntimeTimelineEntry
  ): RuntimeTimelineEntry[] {
    const next = [...timeline, entry];
    return next.slice(-MAX_RUNTIME_TIMELINE_ENTRIES);
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

  private reconcileTaskStatus(taskId: string): void {
    const task = this.getTask(taskId);
    this.patchTask(taskId, { status: deriveTaskStatusFromArtifacts(task) });
  }

  private async addArtifactsFromApproval(
    request: TaskRequest,
    approval: TaskRecord["pendingApproval"],
    runtimeMode: DocumentChangeArtifact["runtimeMode"] = "approval"
  ): Promise<void> {
    if (!approval) {
      return;
    }

    const task = this.getTask(request.taskId);
    const existingToolIds = new Set(task.artifacts.map((artifact) => artifact.runtimeToolId).filter(Boolean));
    const nextArtifacts = task.artifacts.slice();

    for (const tool of approval.tools) {
      if (existingToolIds.has(tool.id)) {
        continue;
      }

      const targetPath = this.resolveApprovalToolTargetPath(tool, request.context);
      if (!targetPath) {
        continue;
      }

      const beforeText = matchesContextFilePath(targetPath, request.context)
        ? request.context.documentText ?? ""
        : (await this.host.readFile(targetPath)) ?? "";
      const artifact = toDocumentChangeArtifactFromApprovalTool(tool, beforeText);
      if (!artifact) {
        if (["write", "edit"].includes(tool.name.trim().toLowerCase())) {
          logDebug(`approval artifact skipped tool=${tool.name} id=${tool.id} target=${targetPath}`);
        }
        continue;
      }

      const nextArtifact =
        runtimeMode === "staged-preview" ? await this.materializeStagedPreviewArtifact(artifact) : artifact;
      nextArtifacts.push({
        ...nextArtifact,
        runtimeMode
      });
      existingToolIds.add(tool.id);
      logDebug(
        `approval artifact created tool=${tool.name} id=${tool.id} target=${targetPath} operation=${nextArtifact.operation} mode=${runtimeMode}`,
      );
    }

    if (nextArtifacts.length === task.artifacts.length) {
      return;
    }

    this.patchTask(request.taskId, {
      artifacts: nextArtifacts
    });
  }

  private async materializeStagedPreviewArtifact(
    artifact: DocumentChangeArtifact
  ): Promise<DocumentChangeArtifact> {
    const stageRoot = mkdtempSync(join(tmpdir(), STAGED_PREVIEW_PREFIX));
    const relativePath = sanitizeStagePath(artifact.target.path);
    const baselinePath = join(stageRoot, "baseline", relativePath);
    const stagedPath = join(stageRoot, "staged", relativePath);
    mkdirSync(dirname(baselinePath), { recursive: true });
    mkdirSync(dirname(stagedPath), { recursive: true });
    writeFileSync(baselinePath, artifact.beforeText, "utf8");
    writeFileSync(stagedPath, artifact.afterText, "utf8");
    return {
      ...artifact,
      baselinePath,
      stagedPath,
      runtimeMode: "staged-preview"
    };
  }

  private resolveApprovalToolTargetPath(
    tool: NonNullable<TaskRecord["pendingApproval"]>["tools"][number],
    context: ContextSnapshot
  ): string | null {
    if (!tool.argsText?.trim()) {
      return context.filePath;
    }
    try {
      const parsed = JSON.parse(tool.argsText) as Record<string, unknown>;
      const pathCandidate = parsed.file_path ?? parsed.path ?? parsed.targetPath;
      return typeof pathCandidate === "string" && pathCandidate.trim() ? pathCandidate.trim() : context.filePath;
    } catch {
      return context.filePath;
    }
  }

  private async handleRuntimeToolEvent(
    request: TaskRequest,
    event: Extract<RuntimeEvent, { type: "session.tool" }>
  ): Promise<void> {
    const normalizedName = event.tool.name.trim().toLowerCase();
    if (event.phase === "start") {
      const targetPath = this.resolveRuntimeToolTargetPath(event.tool, request.context);
      this.setRuntimeToolState(request.taskId, event.tool.id, {
        tool: event.tool,
        targetPath,
        beforeText: matchesContextFilePath(targetPath, request.context) ? request.context.documentText ?? "" : ""
      });
      if (targetPath && !matchesContextFilePath(targetPath, request.context)) {
        const beforeText = (await this.host.readFile(targetPath)) ?? "";
        this.setRuntimeToolState(request.taskId, event.tool.id, {
          tool: event.tool,
          targetPath,
          beforeText
        });
      }
      if (normalizedName === "write") {
        const task = this.getTask(request.taskId);
        if (!task.artifacts.some((artifact) => artifact.runtimeToolId === event.tool.id)) {
          const syntheticApprovalTool = {
            id: event.tool.id,
            name: event.tool.name,
            argsText: event.tool.argsText
          };
          await this.addArtifactsFromApproval(request, {
            turnId: "",
            message: "",
            tools: [syntheticApprovalTool]
          });
        }
      }
      if (normalizedName === "write" || normalizedName === "edit") {
        logDebug(`tool start name=${event.tool.name} id=${event.tool.id} target=${targetPath ?? "none"}`);
      }
      return;
    }

    const cached = this.getRuntimeToolState(request.taskId, event.tool.id);
    const effectiveTool: RuntimeToolCall =
      cached == null
        ? event.tool
        : {
            ...cached.tool,
            ...event.tool,
            name: event.tool.name === "Tool" ? cached.tool.name : event.tool.name,
            argsText: event.tool.argsText ?? cached.tool.argsText
          };
    if (
      !effectiveTool.isError &&
      (normalizedName === "edit" || effectiveTool.name.trim().toLowerCase() === "edit") &&
      cached?.targetPath
    ) {
      const task = this.getTask(request.taskId);
      const afterText = (await this.host.readFile(cached.targetPath)) ?? "";
      if (!task.artifacts.some((artifact) => artifact.runtimeToolId === effectiveTool.id)) {
        const artifact = createRuntimeFileArtifact({
          toolId: effectiveTool.id,
          title: "Edit file",
          targetPath: cached.targetPath,
          beforeText: cached.beforeText,
          afterText,
          runtimeMode: "observed"
        });
        this.patchTask(request.taskId, {
          artifacts: [...task.artifacts, artifact]
        });
        logDebug(`tool artifact created name=${effectiveTool.name} id=${effectiveTool.id} target=${cached.targetPath}`);
      }
    }

    let matched = false;
    this.patchArtifacts(request.taskId, (artifact) => {
      if (artifact.runtimeToolId !== effectiveTool.id) {
        return artifact;
      }
      matched = true;
      const shouldIgnoreSkippedError =
        effectiveTool.isError === true &&
        isUserSkippedToolMessage(effectiveTool.resultText) &&
        (artifact.applyState === "applied" ||
          artifact.applyState === "discarded" ||
          artifact.runtimeMode === "staged-preview");
      if (shouldIgnoreSkippedError) {
        return artifact;
      }
      return {
        ...artifact,
        applyState: effectiveTool.isError ? "failed" : "applied",
        applyError: effectiveTool.isError ? effectiveTool.resultText ?? "Tool execution failed" : undefined
      };
    });
    if (effectiveTool.name.trim().toLowerCase() === "write" || effectiveTool.name.trim().toLowerCase() === "edit") {
      logDebug(
        `tool end name=${effectiveTool.name} id=${effectiveTool.id} matchedArtifact=${matched} status=${effectiveTool.status ?? ""} isError=${effectiveTool.isError === true}`,
      );
    }
    this.deleteRuntimeToolState(request.taskId, effectiveTool.id);
    this.reconcileTaskStatus(request.taskId);
  }

  private resolveRuntimeToolTargetPath(tool: RuntimeToolCall, context: ContextSnapshot): string | null {
    if (!tool.argsText?.trim()) {
      return context.filePath;
    }
    try {
      const parsed = JSON.parse(tool.argsText) as Record<string, unknown>;
      const candidate = parsed.file_path ?? parsed.path ?? parsed.targetPath;
      return typeof candidate === "string" && candidate.trim() ? candidate.trim() : context.filePath;
    } catch {
      return context.filePath;
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
