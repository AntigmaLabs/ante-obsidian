import type { HostAdapter } from "./host-adapter";
import type { AnteRuntime } from "../runtime/ante-runtime";
import {
  createRuntimeFileArtifact,
  getArtifactTargetKey,
  mergeDocumentChangeArtifacts,
  toDocumentChangeArtifactFromApprovalTool
} from "./artifacts";
import type {
  ContextSnapshot,
  DocumentChangeArtifact,
  RuntimeEvent,
  RuntimeToolCall,
  RuntimeTelemetryState,
  RuntimeTimelineEntry,
  TaskRecord,
  TaskRequest,
} from "./types";
import {
  TaskArtifactManager,
  matchesContextFilePath,
  isNativeFileEditingToolName,
  isUserSkippedToolMessage,
  approvalHasOnlyFileEditingTools,
  deriveTaskStatusFromArtifacts
} from "./task-artifact-manager";
import type { TaskStdoutBuffer } from "./task-stdout-buffer";

const MAX_RUNTIME_TIMELINE_ENTRIES = 12;

const isDebugEnabled = (): boolean =>
  typeof window !== "undefined" && window.localStorage?.getItem("tmd-debug") === "true";

const logDebug = (...args: unknown[]): void => {
  if (isDebugEnabled()) {
    console.info("[tmd task event]", ...args);
  }
};

const shouldCoalesceArtifact = (
  existing: DocumentChangeArtifact,
  incoming: DocumentChangeArtifact
): boolean => {
  if (existing.applyState === "discarded" || existing.applyState === "failed") {
    return false;
  }
  if (
    existing.runtimeMode === "staged-preview" ||
    incoming.runtimeMode === "staged-preview"
  ) {
    return true;
  }
  if (existing.runtimeMode === "observed" || incoming.runtimeMode === "observed") {
    return false;
  }
  return existing.applyState === "pending" || existing.applyState === "applying";
};

export class TaskEventHandler {
  private readonly runtimeToolCalls = new Map<
    string,
    Map<string, { tool: RuntimeToolCall; targetPath: string | null; beforeText: string }>
  >();

  constructor(
    private readonly runtime: AnteRuntime,
    private readonly host: HostAdapter,
    private readonly artifactManager: TaskArtifactManager,
    private readonly stdoutBuffer: TaskStdoutBuffer,
    private readonly callbacks: {
      getTask: (taskId: string) => TaskRecord;
      patchTask: (taskId: string, patch: Partial<TaskRecord>) => void;
      patchArtifacts: (
        taskId: string,
        updater: (artifact: DocumentChangeArtifact) => DocumentChangeArtifact
      ) => void;
      updateTaskTelemetry: (
        taskId: string,
        updater: (telemetry: RuntimeTelemetryState) => RuntimeTelemetryState
      ) => void;
      appendLog: (taskId: string, stream: TaskRecord["logs"][number]["stream"], text: string) => void;
    }
  ) {}

  async handleRuntimeEvent(request: TaskRequest, event: RuntimeEvent): Promise<void> {
    if (!(event.type === "log" && event.stream === "stdout")) {
      this.stdoutBuffer.flush(request.taskId);
    }

    switch (event.type) {
      case "log":
        this.callbacks.appendLog(request.taskId, event.stream, event.text);
        return;
      case "runtime.session":
        this.callbacks.patchTask(request.taskId, { runtimeSession: event });
        return;
      case "session.approval": {
        const shouldAutoStageApproval =
          request.kind === "chat" && approvalHasOnlyFileEditingTools(event.approval);
        await this.addArtifactsFromApproval(request, event.approval, shouldAutoStageApproval ? "staged-preview" : "approval");
        const task = this.callbacks.getTask(request.taskId);
        if (shouldAutoStageApproval) {
          this.runtime.respondToApproval(event.approval, "Skip");
          this.callbacks.appendLog(request.taskId, "system", "Staged file preview created; skipped Ante file write");
          this.callbacks.patchTask(request.taskId, {
            pendingApproval: undefined,
            status: task.artifacts.length > 0 ? deriveTaskStatusFromArtifacts(task) : task.status
          });
          return;
        }
        this.callbacks.patchTask(request.taskId, {
          pendingApproval: event.approval,
          status: task.artifacts.length > 0 ? deriveTaskStatusFromArtifacts(task) : task.status
        });
        return;
      }
      case "session.tool":
        await this.handleRuntimeToolEvent(request, event);
        return;
      case "process.update":
        this.callbacks.patchTask(request.taskId, { processLane: event.process });
        return;
      case "session.thinking":
        this.callbacks.updateTaskTelemetry(request.taskId, (telemetry) => ({
          ...telemetry,
          thinkingText:
            event.mode === "full"
              ? event.text
              : `${telemetry.thinkingText ?? ""}${event.text}`
        }));
        return;
      case "session.usage":
        this.callbacks.updateTaskTelemetry(request.taskId, (telemetry) => ({
          ...telemetry,
          usage: event.usage
        }));
        return;
      case "session.compaction":
        this.callbacks.updateTaskTelemetry(request.taskId, (telemetry) => ({
          ...telemetry,
          compacting: event.phase === "start",
          timeline: this.appendTelemetryTimeline(telemetry.timeline, {
            kind: event.phase === "start" ? "compaction-start" : "compaction-end",
            timestamp: new Date().toISOString()
          })
        }));
        return;
      case "session.info":
        this.callbacks.updateTaskTelemetry(request.taskId, (telemetry) => ({
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
        this.callbacks.patchTask(request.taskId, {
          pendingApproval: undefined,
          textResult: {
            kind: "text",
            text: event.text
          }
        });
        return;
      case "session.completed": {
        const task = this.callbacks.getTask(request.taskId);
        this.callbacks.patchTask(request.taskId, {
          pendingApproval: undefined,
          processLane: undefined,
          status: task.artifacts.length > 0 ? deriveTaskStatusFromArtifacts(task) : "completed",
          endedAt: new Date().toISOString()
        });
        return;
      }
      case "session.failed":
        this.callbacks.patchTask(request.taskId, {
          pendingApproval: undefined,
          processLane: undefined,
          status: "failed",
          error: event.error,
          endedAt: new Date().toISOString()
        });
    }
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

  private appendTelemetryTimeline(
    timeline: RuntimeTimelineEntry[],
    entry: RuntimeTimelineEntry
  ): RuntimeTimelineEntry[] {
    const next = [...timeline, entry];
    return next.slice(-MAX_RUNTIME_TIMELINE_ENTRIES);
  }

  private async addArtifactsFromApproval(
    request: TaskRequest,
    approval: TaskRecord["pendingApproval"],
    runtimeMode: DocumentChangeArtifact["runtimeMode"] = "approval"
  ): Promise<void> {
    if (!approval) {
      return;
    }

    const task = this.callbacks.getTask(request.taskId);
    const existingToolIds = new Set(task.artifacts.map((artifact) => artifact.runtimeToolId).filter(Boolean));
    const nextArtifacts = task.artifacts.slice();
    let changed = false;

    for (const tool of approval.tools) {
      if (existingToolIds.has(tool.id)) {
        continue;
      }

      const targetPath = this.artifactManager.resolveApprovalToolTargetPath(tool, request.context);
      if (!targetPath) {
        continue;
      }

      const beforeText = matchesContextFilePath(targetPath, request.context)
        ? request.context.documentText ?? ""
        : (await this.host.readFile(targetPath)) ?? "";
      const artifact = toDocumentChangeArtifactFromApprovalTool(tool, beforeText, targetPath);
      if (!artifact) {
        if (["write", "edit"].includes(tool.name.trim().toLowerCase())) {
          logDebug(`approval artifact skipped tool=${tool.name} id=${tool.id} target=${targetPath}`);
        }
        continue;
      }

      const nextArtifact =
        runtimeMode === "staged-preview" ? await this.artifactManager.materializeStagedPreviewArtifact(artifact) : artifact;
      const artifactToAdd = {
        ...nextArtifact,
        runtimeMode
      };
      const existingIndex = nextArtifacts.findIndex(
        (existing) =>
          shouldCoalesceArtifact(existing, artifactToAdd) &&
          getArtifactTargetKey(existing) === getArtifactTargetKey(artifactToAdd)
      );
      if (existingIndex >= 0) {
        const existing = nextArtifacts[existingIndex]!;
        this.artifactManager.cleanupStagedPreview(existing);
        nextArtifacts[existingIndex] = mergeDocumentChangeArtifacts(existing, artifactToAdd);
      } else {
        nextArtifacts.push(artifactToAdd);
      }
      changed = true;
      existingToolIds.add(tool.id);
      logDebug(
        `approval artifact created tool=${tool.name} id=${tool.id} target=${targetPath} operation=${nextArtifact.operation} mode=${runtimeMode}`,
      );
    }

    if (!changed) {
      return;
    }

    this.callbacks.patchTask(request.taskId, {
      artifacts: nextArtifacts
    });
  }

  private async handleRuntimeToolEvent(
    request: TaskRequest,
    event: Extract<RuntimeEvent, { type: "session.tool" }>
  ): Promise<void> {
    const normalizedName = event.tool.name.trim().toLowerCase();
    if (event.phase === "start") {
      const targetPath = this.artifactManager.resolveRuntimeToolTargetPath(event.tool, request.context);
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
        const task = this.callbacks.getTask(request.taskId);
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
      const task = this.callbacks.getTask(request.taskId);
      const afterText = (await this.host.readFile(cached.targetPath)) ?? "";
      if (afterText !== cached.beforeText && !task.artifacts.some((artifact) => artifact.runtimeToolId === effectiveTool.id)) {
        const artifact = createRuntimeFileArtifact({
          toolId: effectiveTool.id,
          title: "Edit file",
          targetPath: cached.targetPath,
          beforeText: cached.beforeText,
          afterText,
          runtimeMode: "observed"
        });
        const existingIndex = task.artifacts.findIndex(
          (existing) =>
            shouldCoalesceArtifact(existing, artifact) &&
            getArtifactTargetKey(existing) === getArtifactTargetKey(artifact)
        );
        const nextArtifacts = task.artifacts.slice();
        if (existingIndex >= 0) {
          this.artifactManager.cleanupStagedPreview(nextArtifacts[existingIndex]!);
          nextArtifacts[existingIndex] = mergeDocumentChangeArtifacts(
            nextArtifacts[existingIndex]!,
            artifact
          );
        } else {
          nextArtifacts.push(artifact);
        }
        this.callbacks.patchTask(request.taskId, { artifacts: nextArtifacts });
        logDebug(`tool artifact created name=${effectiveTool.name} id=${effectiveTool.id} target=${cached.targetPath}`);
      }
    }

    let matched = false;
    this.callbacks.patchArtifacts(request.taskId, (artifact) => {
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
    this.artifactManager.reconcileTaskStatus(request.taskId);
  }
}
