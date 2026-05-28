import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { HostAdapter } from "./host-adapter";
import type { AnteRuntime } from "../runtime/ante-runtime";
import type {
  ContextSnapshot,
  DocumentChangeArtifact,
  TaskRecord,
  RuntimeApprovalDecision,
} from "./types";

const STAGED_PREVIEW_PREFIX = "tmd-stage-";

export const isNativeFileEditingToolName = (name: string | null | undefined): boolean => {
  const normalized = name?.trim().toLowerCase();
  return normalized === "write" || normalized === "edit";
};

export const approvalHasOnlyFileEditingTools = (approval: NonNullable<TaskRecord["pendingApproval"]>): boolean =>
  approval.tools.length > 0 && approval.tools.every((tool) => isNativeFileEditingToolName(tool.name));

export const matchesContextFilePath = (targetPath: string | null | undefined, context: ContextSnapshot): boolean => {
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

export const isUserSkippedToolMessage = (value: string | null | undefined): boolean =>
  /tool call skipped by user/i.test(value ?? "");

export const deriveTaskStatusFromArtifacts = (task: TaskRecord): TaskRecord["status"] => {
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

const sanitizeStagePath = (value: string): string => {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const sanitized = normalized
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, "-"))
    .join("/");
  return sanitized || "untitled.md";
};

export class TaskArtifactManager {
  constructor(
    private readonly runtime: AnteRuntime,
    private readonly host: HostAdapter,
    private readonly callbacks: {
      getTask: (taskId: string) => TaskRecord;
      patchTask: (taskId: string, patch: Partial<TaskRecord>) => void;
      patchArtifact: (taskId: string, artifactId: string, patch: Partial<DocumentChangeArtifact>) => void;
      patchArtifacts: (
        taskId: string,
        updater: (artifact: DocumentChangeArtifact) => DocumentChangeArtifact
      ) => void;
      respondToTaskApproval: (taskId: string, decision: RuntimeApprovalDecision) => void;
      appendLog: (taskId: string, stream: TaskRecord["logs"][number]["stream"], text: string) => void;
      logDebug: (...args: unknown[]) => void;
    }
  ) {}

  private getArtifact(taskId: string, artifactId: string): DocumentChangeArtifact {
    const artifact = this.callbacks.getTask(taskId).artifacts.find((entry) => entry.id === artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    return artifact;
  }

  reconcileTaskStatus(taskId: string): void {
    const task = this.callbacks.getTask(taskId);
    this.callbacks.patchTask(taskId, { status: deriveTaskStatusFromArtifacts(task) });
  }

  cleanupStagedPreview(artifact: DocumentChangeArtifact): void {
    const stagedRoot = artifact.stagedRoot?.trim();
    if (!stagedRoot) {
      return;
    }
    try {
      rmSync(stagedRoot, { recursive: true, force: true });
    } catch (error) {
      this.callbacks.logDebug(
        `staged preview cleanup failed root=${stagedRoot} error=${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  cleanupArtifactsForTasks(tasks: TaskRecord[]): void {
    for (const task of tasks) {
      for (const artifact of task.artifacts) {
        this.cleanupStagedPreview(artifact);
      }
    }
  }

  resolveApprovalToolTargetPath(
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

  resolveRuntimeToolTargetPath(tool: { argsText?: string }, context: ContextSnapshot): string | null {
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

  async materializeStagedPreviewArtifact(
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
      stagedRoot: stageRoot,
      baselinePath,
      stagedPath,
      runtimeMode: "staged-preview"
    };
  }

  async applyArtifact(taskId: string, artifactId: string, options?: { skipHost?: boolean }): Promise<void> {
    const artifact = this.getArtifact(taskId, artifactId);
    const task = this.callbacks.getTask(taskId);
    const approvalBackedTool =
      artifact.runtimeToolId && task.pendingApproval?.tools.some((tool) => tool.id === artifact.runtimeToolId)
        ? task.pendingApproval.tools.find((tool) => tool.id === artifact.runtimeToolId)
        : undefined;

    if (approvalBackedTool && isNativeFileEditingToolName(approvalBackedTool.name)) {
      this.callbacks.patchArtifact(taskId, artifactId, {
        applyState: "applying",
        applyError: undefined
      });
      this.reconcileTaskStatus(taskId);
      try {
        if (!options?.skipHost) {
          await this.host.applyDocumentChange(artifact);
        }
        this.cleanupStagedPreview(artifact);
        this.callbacks.patchArtifact(taskId, artifactId, {
          applyState: "applied",
          baselinePath: undefined,
          stagedPath: undefined,
          stagedRoot: undefined
        });
        this.runtime.respondToApproval(task.pendingApproval!, "Skip");
        this.callbacks.patchTask(taskId, { pendingApproval: undefined });
        this.callbacks.appendLog(taskId, "system", "Approval sent: Skip");
        this.reconcileTaskStatus(taskId);
        return;
      } catch (error) {
        this.callbacks.patchArtifact(taskId, artifactId, {
          applyState: "failed",
          applyError: error instanceof Error ? error.message : String(error)
        });
        this.reconcileTaskStatus(taskId);
        throw error;
      }
    }

    this.callbacks.patchArtifact(taskId, artifactId, {
      applyState: "applying",
      applyError: undefined
    });
    this.reconcileTaskStatus(taskId);

    try {
      if (!options?.skipHost) {
        await this.host.applyDocumentChange(artifact);
      }
      this.cleanupStagedPreview(artifact);
      this.callbacks.patchArtifact(taskId, artifactId, {
        applyState: "applied",
        baselinePath: undefined,
        stagedPath: undefined,
        stagedRoot: undefined
      });
      this.reconcileTaskStatus(taskId);
    } catch (error) {
      this.callbacks.patchArtifact(taskId, artifactId, {
        applyState: "failed",
        applyError: error instanceof Error ? error.message : String(error)
      });
      this.reconcileTaskStatus(taskId);
      throw error;
    }
  }

  async discardArtifact(taskId: string, artifactId: string): Promise<void> {
    const artifact = this.getArtifact(taskId, artifactId);
    const task = this.callbacks.getTask(taskId);
    const approvalBackedTool =
      artifact.runtimeToolId && task.pendingApproval?.tools.some((tool) => tool.id === artifact.runtimeToolId)
        ? task.pendingApproval.tools.find((tool) => tool.id === artifact.runtimeToolId)
        : undefined;

    if (approvalBackedTool && isNativeFileEditingToolName(approvalBackedTool.name)) {
      this.callbacks.respondToTaskApproval(taskId, "Skip");
      return;
    }

    if (artifact.applyState === "applied") {
      this.callbacks.patchArtifact(taskId, artifactId, {
        applyState: "reverting",
        applyError: undefined
      });
      this.reconcileTaskStatus(taskId);

      try {
        await this.host.revertDocumentChange(artifact);
      } catch (error) {
        this.callbacks.patchArtifact(taskId, artifactId, {
          applyState: "failed",
          applyError: error instanceof Error ? error.message : String(error)
        });
        this.reconcileTaskStatus(taskId);
        throw error;
      }

      this.callbacks.patchArtifact(taskId, artifactId, {
        applyState: "pending",
        applyError: undefined
      });
      this.cleanupStagedPreview(artifact);
      this.callbacks.patchArtifact(taskId, artifactId, {
        baselinePath: undefined,
        stagedPath: undefined,
        stagedRoot: undefined
      });
      this.reconcileTaskStatus(taskId);
      return;
    }

    this.cleanupStagedPreview(artifact);
    this.callbacks.patchArtifact(taskId, artifactId, {
      applyState: "discarded",
      applyError: undefined,
      baselinePath: undefined,
      stagedPath: undefined,
      stagedRoot: undefined
    });
    this.reconcileTaskStatus(taskId);
  }

  async applyAllArtifacts(taskId: string): Promise<void> {
    const task = this.callbacks.getTask(taskId);
    const pendingArtifacts = task.artifacts.filter(
      (artifact) => artifact.applyState !== "applied" && artifact.applyState !== "discarded"
    );

    for (const artifact of pendingArtifacts) {
      await this.applyArtifact(taskId, artifact.id);
    }
  }

  async revertArtifact(taskId: string, artifactId: string): Promise<void> {
    const artifact = this.getArtifact(taskId, artifactId);
    this.callbacks.patchArtifact(taskId, artifactId, {
      applyState: "reverting",
      applyError: undefined
    });
    this.reconcileTaskStatus(taskId);

    try {
      await this.host.revertDocumentChange(artifact);
      this.cleanupStagedPreview(artifact);
      this.callbacks.patchArtifact(taskId, artifactId, {
        applyState: "reverted",
        baselinePath: undefined,
        stagedPath: undefined,
        stagedRoot: undefined
      });
      this.reconcileTaskStatus(taskId);
    } catch (error) {
      this.callbacks.patchArtifact(taskId, artifactId, {
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
}
