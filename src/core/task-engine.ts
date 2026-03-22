import type { HostAdapter } from "../obsidian/host-adapter";
import type { AnteServeRuntimeAdapter } from "../runtime/ante-serve-adapter";
import { toDocumentChangeArtifact } from "./artifacts";
import { getPreset } from "./presets";
import type {
  ContextSnapshot,
  DocumentChangeArtifact,
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

interface StartDocumentTaskInput {
  presetId: PresetId;
  triggerSource: Exclude<TaskTriggerSource, "console">;
  context?: ContextSnapshot | null;
  inlineInstruction?: string;
}

export class TaskEngine {
  private state = createInitialState();
  private readonly listeners = new Set<StateListener>();
  private activeTaskId: string | null = null;

  constructor(
    private readonly runtime: AnteServeRuntimeAdapter,
    private readonly host: HostAdapter
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
      preset: getPreset(input.presetId),
      context,
      inlineInstruction: input.inlineInstruction?.trim() ?? ""
    };
    await this.runTask(request);
    return request.taskId;
  }

  async startConsoleTask(prompt: string, followUp = false): Promise<string> {
    return this.startInteractiveTask("console", prompt, followUp);
  }

  async startTerminalTask(prompt: string, followUp = false): Promise<string> {
    return this.startInteractiveTask("terminal", prompt, followUp);
  }

  private async startInteractiveTask(triggerSource: "console" | "terminal", prompt: string, followUp: boolean): Promise<string> {
    const context = (await this.host.getPreferredContext()) ?? {
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
      preset: getPreset("default"),
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

  async applyArtifact(taskId: string, artifactId: string): Promise<void> {
    const artifact = this.getArtifact(taskId, artifactId);
    this.patchArtifact(taskId, artifactId, {
      applyState: "applying",
      applyError: undefined
    });

    try {
      await this.host.applyDocumentChange(artifact);
      this.patchArtifact(taskId, artifactId, { applyState: "applied" });
      this.patchTask(taskId, { status: "applied" });
    } catch (error) {
      this.patchArtifact(taskId, artifactId, {
        applyState: "failed",
        applyError: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  discardArtifact(taskId: string, artifactId: string): void {
    this.patchArtifact(taskId, artifactId, { applyState: "discarded", applyError: undefined });
    this.patchTask(taskId, { status: "discarded" });
  }

  async revertArtifact(taskId: string, artifactId: string): Promise<void> {
    const artifact = this.getArtifact(taskId, artifactId);
    this.patchArtifact(taskId, artifactId, {
      applyState: "reverting",
      applyError: undefined
    });

    try {
      await this.host.revertDocumentChange(artifact);
      this.patchArtifact(taskId, artifactId, { applyState: "reverted" });
      this.patchTask(taskId, { status: "completed" });
    } catch (error) {
      this.patchArtifact(taskId, artifactId, {
        applyState: "failed",
        applyError: error instanceof Error ? error.message : String(error)
      });
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
    }
  }

  private async handleRuntimeEvent(request: TaskRequest, event: RuntimeEvent): Promise<void> {
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
        const existingTargetText =
          event.change.operation === "create-file"
            ? ""
            : event.change.targetPath?.trim() && event.change.targetPath !== request.context.filePath
              ? (await this.host.readFile(event.change.targetPath)) ?? ""
              : request.context.documentText ?? "";
        const artifact = toDocumentChangeArtifact(event.change, request.context, existingTargetText);
        const task = this.getTask(request.taskId);
        this.patchTask(request.taskId, {
          artifacts: [artifact, ...task.artifacts],
          pendingApproval: undefined,
          status: "awaiting-apply"
        });
        return;
      }
      case "session.completed": {
        const task = this.getTask(request.taskId);
        this.patchTask(request.taskId, {
          pendingApproval: undefined,
          status: task.artifacts.length > 0 ? "awaiting-apply" : "completed",
          endedAt: new Date().toISOString()
        });
        return;
      }
      case "session.failed":
        this.patchTask(request.taskId, {
          pendingApproval: undefined,
          status: "failed",
          error: event.error,
          endedAt: new Date().toISOString()
        });
    }
  }

  private appendLog(taskId: string, stream: TaskRecord["logs"][number]["stream"], text: string): void {
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
    const task = this.state.tasks.find((entry) => entry.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }

  private getArtifact(taskId: string, artifactId: string): DocumentChangeArtifact {
    const artifact = this.getTask(taskId).artifacts.find((entry) => entry.id === artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    return artifact;
  }

  private patchTask(taskId: string, patch: Partial<TaskRecord>): void {
    this.state = {
      ...this.state,
      tasks: this.state.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task))
    };
    this.notify();
  }

  private patchArtifact(taskId: string, artifactId: string, patch: Partial<DocumentChangeArtifact>): void {
    const task = this.getTask(taskId);
    this.patchTask(taskId, {
      artifacts: task.artifacts.map((artifact) => (artifact.id === artifactId ? { ...artifact, ...patch } : artifact))
    });
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
