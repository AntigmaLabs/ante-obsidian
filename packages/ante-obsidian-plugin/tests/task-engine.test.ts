import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile as readFsFile } from "node:fs/promises";
import { TaskEngine } from "../src/core/task-engine";
import { BUILTIN_PRESETS } from "../src/core/presets";
import type {
  ContextSnapshot,
  DocumentChangeArtifact,
  PresetId,
  RuntimeApprovalDecision,
  RuntimeEvent,
  TaskRequest
} from "../src/core/types";

const context: ContextSnapshot = {
  vaultPath: "/vaults/test",
  filePath: "Note.md",
  noteTitle: "Note",
  documentText: "alpha\n",
  selection: null
};

class RuntimeStub {
  public readonly approvals: Array<{ turnId: string; decision: RuntimeApprovalDecision }> = [];

  constructor(private readonly emit: (request: TaskRequest, onEvent: (event: RuntimeEvent) => void) => void) {}

  async ensureWarmSession(): Promise<void> {}

  run(
    request: TaskRequest,
    observer: {
      onEvent: (event: RuntimeEvent) => void;
      onExit: (result: { status: "completed" | "failed" | "cancelled"; error?: string }) => void;
    }
  ): void {
    this.emit(request, observer.onEvent);
    observer.onExit({ status: "completed" });
  }

  cancelActiveRun(): void {}

  respondToApproval(approval: unknown, decision: RuntimeApprovalDecision): void {
    const request = approval as { turnId?: string };
    this.approvals.push({ turnId: request.turnId ?? "", decision });
  }

  async persistActiveSession(): Promise<void> {}

  getActiveSessionId(): string | null {
    return null;
  }

  dispose(): void {}
}

class CancelledRuntimeStub extends RuntimeStub {
  constructor() {
    super(() => {});
  }

  override run(
    _request: TaskRequest,
    observer: {
      onEvent: (event: RuntimeEvent) => void;
      onExit: (result: { status: "completed" | "failed" | "cancelled"; error?: string }) => void;
    }
  ): void {
    observer.onExit({ status: "cancelled" });
  }
}

class HangingRuntimeStub extends RuntimeStub {
  override run(
    request: TaskRequest,
    observer: {
      onEvent: (event: RuntimeEvent) => void;
      onExit: (result: { status: "completed" | "failed" | "cancelled"; error?: string }) => void;
    }
  ): void {
    this.emit(request, observer.onEvent);
  }
}

class HostStub {
  public appliedChanges = 0;

  async getActiveContext(): Promise<ContextSnapshot | null> {
    return context;
  }

  async getPreferredContext(): Promise<ContextSnapshot | null> {
    return context;
  }

  async capturePreferredContext(): Promise<ContextSnapshot | null> {
    return context;
  }

  async readFile(_path: string): Promise<string | null> {
    return null;
  }

  async applyDocumentChange(_change: DocumentChangeArtifact): Promise<void> {
    this.appliedChanges += 1;
  }

  async revertDocumentChange(_change: DocumentChangeArtifact): Promise<void> {}

  async revealDocumentChange(_change: DocumentChangeArtifact): Promise<void> {}
}

class MutableHostStub extends HostStub {
  constructor(private readonly files: Record<string, string>) {
    super();
  }

  override async readFile(path: string): Promise<string | null> {
    return this.files[path] ?? null;
  }

  setFile(path: string, content: string): void {
    this.files[path] = content;
  }
}

const resolvePresetById = (presetId: PresetId) => BUILTIN_PRESETS[presetId];

test("stdout chunks are aggregated outside the visible log list", async () => {
  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({ type: "log", stream: "stdout", text: "alpha" });
    onEvent({ type: "log", stream: "stdout", text: " beta" });
    onEvent({ type: "log", stream: "system", text: "done" });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never, resolvePresetById);
  await engine.startDocumentTask({
    presetId: "default",
    triggerSource: "mention",
    context,
    inlineInstruction: "Stream text"
  });

  const task = engine.getState().tasks[0];
  assert.ok(task);
  assert.equal(task?.stdoutText, "alpha beta");
  assert.equal(task?.logs.length, 1);
  assert.equal(task?.logs[0]?.stream, "system");
  assert.equal(task?.logs[0]?.text, "done");
});

test("stdout preview buffer is capped", async () => {
  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({ type: "log", stream: "stdout", text: "a".repeat(12000) });
    onEvent({ type: "log", stream: "stdout", text: "b".repeat(12000) });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never, resolvePresetById);
  await engine.startDocumentTask({
    presetId: "default",
    triggerSource: "mention",
    context,
    inlineInstruction: "Stream long text"
  });

  const task = engine.getState().tasks[0];
  assert.ok(task);
  assert.equal(task?.stdoutText.length, 16000);
  assert.match(task?.stdoutText ?? "", /^a*b+$/);
});

test("full process logs mode preserves complete stdout", async () => {
  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({ type: "log", stream: "stdout", text: "a".repeat(12000) });
    onEvent({ type: "log", stream: "stdout", text: "b".repeat(12000) });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never, resolvePresetById, () => true);
  await engine.startDocumentTask({
    presetId: "default",
    triggerSource: "mention",
    context,
    inlineInstruction: "Stream long text"
  });

  const task = engine.getState().tasks[0];
  assert.ok(task);
  assert.equal(task?.stdoutText.length, 24000);
  assert.equal(task?.stdoutText, `${"a".repeat(12000)}${"b".repeat(12000)}`);
});

test("startChatTask creates a chat task with chat trigger source", async () => {
  let capturedRequest: TaskRequest | null = null;
  const runtime = new RuntimeStub((request, onEvent) => {
    capturedRequest = request;
    onEvent({ type: "result.text", text: "hello from chat" });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never, resolvePresetById);
  await engine.startChatTask("Start a chat");

  assert.ok(capturedRequest);
  assert.equal(capturedRequest?.kind, "chat");
  assert.equal(capturedRequest?.triggerSource, "chat");
  assert.equal(capturedRequest?.mode, "initial");
  assert.equal(capturedRequest?.runtimeTarget, undefined);

  const task = engine.getState().tasks[0];
  assert.ok(task);
  assert.equal(task?.kind, "chat");
  assert.equal(task?.triggerSource, "chat");
  assert.equal(task?.textResult?.text, "hello from chat");
});

test("queueChatTask forwards runtime target overrides", async () => {
  let capturedRequest: TaskRequest | null = null;
  const runtime = new RuntimeStub((request, onEvent) => {
    capturedRequest = request;
    onEvent({ type: "result.text", text: "done" });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never, resolvePresetById);
  await engine.queueChatTask(
    "task-1",
    "Use Gemini",
    false,
    context,
    null,
    { provider: "gemini", model: "gemini-3-flash-preview", thinking: "Deep" }
  );

  assert.deepEqual(capturedRequest?.runtimeTarget, {
    provider: "gemini",
    model: "gemini-3-flash-preview",
    thinking: "Deep"
  });
});

test("startChatTask follow-up reuses the latest chat session id", async () => {
  const seenRequests: TaskRequest[] = [];
  let runCount = 0;
  const runtime = new RuntimeStub((request, onEvent) => {
    seenRequests.push(request);
    runCount += 1;
    onEvent({
      type: "runtime.session",
      provider: "ante",
      sessionId: runCount === 1 ? "session-1" : "session-2"
    });
    onEvent({ type: "result.text", text: runCount === 1 ? "first" : "second" });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never, resolvePresetById);
  await engine.startChatTask("First turn");
  await engine.startChatTask("Second turn", true);

  assert.equal(seenRequests.length, 2);
  assert.equal(seenRequests[0]?.runtimeSessionId, undefined);
  assert.equal(seenRequests[0]?.mode, "initial");
  assert.equal(seenRequests[1]?.mode, "followup");
  assert.equal(seenRequests[1]?.runtimeSessionId, "session-1");
  assert.equal(seenRequests[1]?.followUpPrompt, "Second turn");
});

test("hasActiveTask becomes false after task completion even when currentTaskId is retained", async () => {
  const runtime = new RuntimeStub((_request, _onEvent) => {});
  const engine = new TaskEngine(runtime as never, new HostStub() as never, resolvePresetById);

  await engine.startChatTask("hello");

  assert.equal(engine.getState().currentTaskId != null, true);
  assert.equal(engine.hasActiveTask(), false);
});

test("cancelled runtime exits are preserved as cancelled tasks instead of failed tasks", async () => {
  const engine = new TaskEngine(new CancelledRuntimeStub() as never, new HostStub() as never, resolvePresetById);

  await engine.startChatTask("stop this");

  const task = engine.getState().tasks[0];
  assert.ok(task);
  assert.equal(task?.status, "cancelled");
  assert.equal(task?.error, undefined);
});

test("clearTasksByTriggerSource removes only chat tasks", async () => {
  const runtime = new RuntimeStub((request, onEvent) => {
    onEvent({ type: "result.text", text: request.inlineInstruction });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never, resolvePresetById);
  await engine.startChatTask("Chat turn");
  await engine.startTerminalTask("Terminal turn");

  engine.clearTasksByTriggerSource("chat");

  const tasks = engine.getState().tasks;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.triggerSource, "terminal");
  assert.equal(tasks[0]?.inlineInstruction, "Terminal turn");
});

test("startDocumentTask accepts a custom preset resolved at runtime", async () => {
  let capturedRequest: TaskRequest | null = null;
  const runtime = new RuntimeStub((request, onEvent) => {
    capturedRequest = request;
    onEvent({ type: "result.text", text: "done" });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never, (presetId) =>
    presetId === "custom-1"
      ? {
          id: "custom-1",
          label: "Custom 1",
          goal: "Execute a custom preset.",
          systemInstructions: "Rewrite the content more clearly.",
          source: "custom",
          enabled: true,
          sortOrder: 4,
          interactionMode: "inline"
        }
      : BUILTIN_PRESETS[presetId]
  );

  await engine.startDocumentTask({
    presetId: "custom-1",
    triggerSource: "context-menu",
    context,
    inlineInstruction: "Use the custom preset"
  });

  assert.equal(capturedRequest?.preset.id, "custom-1");
  assert.equal(capturedRequest?.preset.systemInstructions, "Rewrite the content more clearly.");
});

test("native Write approvals create applied diff artifacts from tool args", async () => {
  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({
      type: "session.approval",
      approval: {
        turnId: "turn-1",
        message: "approve write",
        tools: [
          {
            id: "tool-write-1",
            name: "Write",
            argsText: JSON.stringify({
              file_path: "Note.md",
              content: "alpha\nbeta\n"
            })
          }
        ]
      }
    });
    onEvent({
      type: "session.tool",
      phase: "end",
      tool: {
        id: "tool-write-1",
        name: "Write",
        resultText: JSON.stringify({ lines_written: 2 }),
        status: "Completed",
        isError: false
      }
    });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never, resolvePresetById);
  await engine.startDocumentTask({
    presetId: "default",
    triggerSource: "mention",
    context,
    inlineInstruction: "Add beta"
  });

  const task = engine.getState().tasks[0];
  assert.ok(task);
  assert.equal(task?.artifacts.length, 1);
  assert.equal(task?.artifacts[0]?.beforeText, "alpha\n");
  assert.equal(task?.artifacts[0]?.afterText, "alpha\nbeta\n");
  assert.equal(task?.artifacts[0]?.runtimeToolId, "tool-write-1");
  assert.equal(task?.artifacts[0]?.applyState, "applied");
  assert.equal(task?.status, "applied");
});

test("native Edit approvals create preview diff artifacts before execution", async () => {
  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({
      type: "session.approval",
      approval: {
        turnId: "turn-1",
        message: "approve edit",
        tools: [
          {
            id: "tool-edit-approval-1",
            name: "Edit",
            argsText: JSON.stringify({
              file_path: "Note.md",
              old_string: "alpha\n",
              new_string: "alpha\nbeta\n",
              replace_all: false
            })
          }
        ]
      }
    });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never, resolvePresetById);
  await engine.startDocumentTask({
    presetId: "default",
    triggerSource: "mention",
    context,
    inlineInstruction: "Preview edit"
  });

  const task = engine.getState().tasks[0];
  assert.ok(task);
  assert.equal(task?.artifacts.length, 1);
  assert.equal(task?.artifacts[0]?.runtimeToolId, "tool-edit-approval-1");
  assert.equal(task?.artifacts[0]?.beforeText, "alpha\n");
  assert.equal(task?.artifacts[0]?.afterText, "alpha\nbeta\n");
  assert.equal(task?.artifacts[0]?.applyState, "pending");
  assert.equal(task?.status, "awaiting-apply");
});

test("native file-edit approval pauses switch the task to awaiting-apply before runtime exit", async () => {
  const runtime = new HangingRuntimeStub((_request, onEvent) => {
    onEvent({
      type: "session.approval",
      approval: {
        turnId: "turn-1",
        message: "approve edit",
        tools: [
          {
            id: "tool-edit-approval-1",
            name: "Edit",
            argsText: JSON.stringify({
              file_path: "Note.md",
              old_string: "alpha\n",
              new_string: "alpha\nbeta\n",
              replace_all: false
            })
          }
        ]
      }
    });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never, resolvePresetById);
  const taskId = await engine.startDocumentTask({
    presetId: "default",
    triggerSource: "mention",
    context,
    inlineInstruction: "Preview edit"
  });

  const task = engine.getState().tasks.find((entry) => entry.id === taskId);
  assert.ok(task);
  assert.equal(task?.artifacts.length, 1);
  assert.equal(task?.status, "awaiting-apply");
  assert.equal(task?.pendingApproval?.turnId, "turn-1");
});

test("chat file-edit approvals are staged locally and auto-skipped in Ante", async () => {
  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({
      type: "session.approval",
      approval: {
        turnId: "turn-chat-1",
        message: "approve write",
        tools: [
          {
            id: "tool-write-chat-1",
            name: "Write",
            argsText: JSON.stringify({
              file_path: "Note.md",
              content: "alpha\nbeta\n"
            })
          }
        ]
      }
    });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never, resolvePresetById);
  await engine.startChatTask("Preview beta");

  const task = engine.getState().tasks[0];
  assert.ok(task);
  assert.equal(task?.kind, "chat");
  assert.equal(task?.pendingApproval, undefined);
  assert.equal(task?.artifacts.length, 1);
  assert.equal(task?.artifacts[0]?.runtimeMode, "staged-preview");
  assert.equal(task?.artifacts[0]?.applyState, "pending");
  assert.equal(task?.status, "awaiting-apply");
  assert.equal(runtime.approvals.length, 1);
  assert.deepEqual(runtime.approvals[0], { turnId: "turn-chat-1", decision: "Skip" });
  assert.equal(await readFsFile(task!.artifacts[0]!.baselinePath!, "utf8"), "alpha\n");
  assert.equal(await readFsFile(task!.artifacts[0]!.stagedPath!, "utf8"), "alpha\nbeta\n");
});

test("applying a staged chat preview cleans up its temp directory", async () => {
  const host = new HostStub();
  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({
      type: "session.approval",
      approval: {
        turnId: "turn-chat-1",
        message: "approve write",
        tools: [
          {
            id: "tool-write-chat-1",
            name: "Write",
            argsText: JSON.stringify({
              file_path: "Note.md",
              content: "alpha\nbeta\n"
            })
          }
        ]
      }
    });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, host as never, resolvePresetById);
  await engine.startChatTask("Preview beta");

  const task = engine.getState().tasks[0];
  assert.ok(task);
  const artifact = task.artifacts[0];
  assert.ok(artifact?.stagedRoot);
  assert.equal(existsSync(artifact.stagedRoot), true);

  await engine.applyArtifact(task.id, artifact.id);

  const updatedArtifact = engine.getState().tasks[0]?.artifacts[0];
  assert.ok(updatedArtifact);
  assert.equal(host.appliedChanges, 1);
  assert.equal(existsSync(artifact.stagedRoot), false);
  assert.equal(updatedArtifact?.stagedRoot, undefined);
  assert.equal(updatedArtifact?.baselinePath, undefined);
  assert.equal(updatedArtifact?.stagedPath, undefined);
});

test("discarding a staged chat preview cleans up its temp directory", async () => {
  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({
      type: "session.approval",
      approval: {
        turnId: "turn-chat-1",
        message: "approve write",
        tools: [
          {
            id: "tool-write-chat-1",
            name: "Write",
            argsText: JSON.stringify({
              file_path: "Note.md",
              content: "alpha\nbeta\n"
            })
          }
        ]
      }
    });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never, resolvePresetById);
  await engine.startChatTask("Preview beta");

  const task = engine.getState().tasks[0];
  assert.ok(task);
  const artifact = task.artifacts[0];
  assert.ok(artifact?.stagedRoot);
  assert.equal(existsSync(artifact.stagedRoot), true);

  await engine.discardArtifact(task.id, artifact.id);

  const updatedArtifact = engine.getState().tasks[0]?.artifacts[0];
  assert.ok(updatedArtifact);
  assert.equal(existsSync(artifact.stagedRoot), false);
  assert.equal(updatedArtifact?.applyState, "discarded");
  assert.equal(updatedArtifact?.stagedRoot, undefined);
});

test("clearing chat tasks cleans up staged preview temp directories", async () => {
  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({
      type: "session.approval",
      approval: {
        turnId: "turn-chat-1",
        message: "approve write",
        tools: [
          {
            id: "tool-write-chat-1",
            name: "Write",
            argsText: JSON.stringify({
              file_path: "Note.md",
              content: "alpha\nbeta\n"
            })
          }
        ]
      }
    });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never, resolvePresetById);
  await engine.startChatTask("Preview beta");

  const task = engine.getState().tasks[0];
  assert.ok(task);
  const artifact = task.artifacts[0];
  assert.ok(artifact?.stagedRoot);
  assert.equal(existsSync(artifact.stagedRoot), true);

  engine.clearTasks([task.id]);

  assert.equal(existsSync(artifact.stagedRoot), false);
  assert.equal(engine.getState().tasks.length, 0);
});

test("native Edit tools create artifacts from file snapshots on tool end", async () => {
  const path = "Note.md";
  const host = new MutableHostStub({ [path]: "alpha\n" });
  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({
      type: "session.tool",
      phase: "start",
      tool: {
        id: "tool-edit-1",
        name: "Edit",
        argsText: JSON.stringify({
          file_path: path,
          old_string: "alpha\n",
          new_string: "alpha\nbeta\n"
        })
      }
    });
    host.setFile(path, "alpha\nbeta\n");
    onEvent({
      type: "session.tool",
      phase: "end",
      tool: {
        id: "tool-edit-1",
        name: "Tool",
        resultText: JSON.stringify({ patch: { lines: ["+beta"] } }),
        status: "Completed",
        isError: false
      }
    });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, host as never, resolvePresetById);
  await engine.startDocumentTask({
    presetId: "default",
    triggerSource: "mention",
    context,
    inlineInstruction: "Add beta with edit"
  });

  const task = engine.getState().tasks[0];
  assert.ok(task);
  assert.equal(task?.artifacts.length, 1);
  assert.equal(task?.artifacts[0]?.beforeText, "alpha\n");
  assert.equal(task?.artifacts[0]?.afterText, "alpha\nbeta\n");
  assert.equal(task?.artifacts[0]?.runtimeToolId, "tool-edit-1");
  assert.equal(task?.artifacts[0]?.applyState, "applied");
});

test("failed Edit followed by successful Write only keeps the successful diff artifact", async () => {
  const path = "Note.md";
  const host = new MutableHostStub({ [path]: "alpha\n" });
  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({
      type: "session.tool",
      phase: "start",
      tool: {
        id: "tool-edit-1",
        name: "Edit",
        argsText: JSON.stringify({
          file_path: path,
          old_string: "alpha\n",
          new_string: "alpha\nbeta\n",
          replace_all: false
        })
      }
    });
    onEvent({
      type: "session.tool",
      phase: "end",
      tool: {
        id: "tool-edit-1",
        name: "Tool",
        resultText: "old_string found 2 times",
        status: "Failed",
        isError: true
      }
    });
    onEvent({
      type: "session.approval",
      approval: {
        turnId: "turn-1",
        message: "approve write",
        tools: [
          {
            id: "tool-write-1",
            name: "Write",
            argsText: JSON.stringify({
              file_path: path,
              content: "alpha\nbeta\n"
            })
          }
        ]
      }
    });
    host.setFile(path, "alpha\nbeta\n");
    onEvent({
      type: "session.tool",
      phase: "end",
      tool: {
        id: "tool-write-1",
        name: "Write",
        resultText: JSON.stringify({ lines_written: 2 }),
        status: "Completed",
        isError: false
      }
    });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, host as never, resolvePresetById);
  await engine.startDocumentTask({
    presetId: "default",
    triggerSource: "mention",
    context,
    inlineInstruction: "Add beta even if edit fallback is needed"
  });

  const task = engine.getState().tasks[0];
  assert.ok(task);
  assert.equal(task?.artifacts.length, 1);
  assert.equal(task?.artifacts[0]?.runtimeToolId, "tool-write-1");
  assert.equal(task?.artifacts[0]?.beforeText, "alpha\n");
  assert.equal(task?.artifacts[0]?.afterText, "alpha\nbeta\n");
  assert.equal(task?.artifacts[0]?.applyState, "applied");
  assert.equal(task?.status, "applied");
});

test("applying an approval-backed native Write artifact modifies the host and skips the pending tool call", async () => {
  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({
      type: "session.approval",
      approval: {
        turnId: "turn-1",
        message: "approve write",
        tools: [
          {
            id: "tool-write-1",
            name: "Write",
            argsText: JSON.stringify({
              file_path: "Note.md",
              content: "alpha\nbeta\n"
            })
          }
        ]
      }
    });
  });
  const host = new HostStub();

  const engine = new TaskEngine(runtime as never, host as never, resolvePresetById);
  await engine.startDocumentTask({
    presetId: "default",
    triggerSource: "mention",
    context,
    inlineInstruction: "Preview beta"
  });

  const task = engine.getState().tasks[0];
  assert.ok(task);
  assert.equal(task?.artifacts.length, 1);
  assert.equal(task?.artifacts[0]?.applyState, "pending");
  assert.equal(task?.status, "awaiting-apply");

  await engine.applyArtifact(task!.id, task!.artifacts[0]!.id);

  const updatedTask = engine.getState().tasks[0];
  assert.ok(updatedTask);
  assert.equal(runtime.approvals.length, 1);
  assert.deepEqual(runtime.approvals[0], { turnId: "turn-1", decision: "Skip" });
  assert.equal(host.appliedChanges, 1);
  assert.equal(updatedTask?.artifacts[0]?.applyState, "applied");
});

test("skipped-by-user ToolEnd does not overwrite a locally applied native artifact as failed", async () => {
  let observerRef:
    | {
        onEvent: (event: RuntimeEvent) => void;
        onExit: (result: { status: "completed" | "failed" | "cancelled"; error?: string }) => void;
      }
    | null = null;

  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({
      type: "session.approval",
      approval: {
        turnId: "turn-1",
        message: "approve write",
        tools: [
          {
            id: "tool-write-1",
            name: "Write",
            argsText: JSON.stringify({
              file_path: "Note.md",
              content: "alpha\nbeta\n"
            })
          }
        ]
      }
    });
  });

  runtime.run = (
    request: TaskRequest,
    observer: {
      onEvent: (event: RuntimeEvent) => void;
      onExit: (result: { status: "completed" | "failed" | "cancelled"; error?: string }) => void;
    }
  ): void => {
    observerRef = observer;
    runtime["emit"](request, observer.onEvent);
  };

  const host = new HostStub();
  const engine = new TaskEngine(runtime as never, host as never, resolvePresetById);
  await engine.startDocumentTask({
    presetId: "default",
    triggerSource: "mention",
    context,
    inlineInstruction: "Preview beta"
  });

  const task = engine.getState().tasks[0];
  assert.ok(task);
  await engine.applyArtifact(task!.id, task!.artifacts[0]!.id);

  observerRef?.onEvent({
    type: "session.tool",
    phase: "end",
    tool: {
      id: "tool-write-1",
      name: "Write",
      resultText: "Tool call skipped by user, and was not executed.",
      status: "Skipped",
      isError: true
    }
  });

  const updatedTask = engine.getState().tasks[0];
  assert.ok(updatedTask);
  assert.equal(updatedTask?.artifacts[0]?.applyState, "applied");
  assert.equal(updatedTask?.artifacts[0]?.applyError, undefined);
});

test("skipped-by-user ToolEnd does not overwrite a staged chat preview artifact as failed", async () => {
  let observerRef:
    | {
        onEvent: (event: RuntimeEvent) => void;
        onExit: (result: { status: "completed" | "failed" | "cancelled"; error?: string }) => void;
      }
    | null = null;

  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({
      type: "session.approval",
      approval: {
        turnId: "turn-chat-1",
        message: "approve write",
        tools: [
          {
            id: "tool-write-chat-1",
            name: "Write",
            argsText: JSON.stringify({
              file_path: "Note.md",
              content: "alpha\nbeta\n"
            })
          }
        ]
      }
    });
  });

  runtime.run = (
    request: TaskRequest,
    observer: {
      onEvent: (event: RuntimeEvent) => void;
      onExit: (result: { status: "completed" | "failed" | "cancelled"; error?: string }) => void;
    }
  ): void => {
    observerRef = observer;
    runtime["emit"](request, observer.onEvent);
  };

  const engine = new TaskEngine(runtime as never, new HostStub() as never, resolvePresetById);
  await engine.startChatTask("Preview beta");

  observerRef?.onEvent({
    type: "session.tool",
    phase: "end",
    tool: {
      id: "tool-write-chat-1",
      name: "Tool",
      resultText: "Tool call skipped by user, and was not executed.",
      status: "Skipped",
      isError: true
    }
  });

  const task = engine.getState().tasks[0];
  assert.ok(task);
  assert.equal(task?.artifacts[0]?.applyState, "pending");
  assert.equal(task?.artifacts[0]?.applyError, undefined);
});

test("skipped-by-user ToolEnd does not overwrite a discarded native artifact as failed", async () => {
  let observerRef:
    | {
        onEvent: (event: RuntimeEvent) => void;
        onExit: (result: { status: "completed" | "failed" | "cancelled"; error?: string }) => void;
      }
    | null = null;

  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({
      type: "session.approval",
      approval: {
        turnId: "turn-1",
        message: "approve write",
        tools: [
          {
            id: "tool-write-1",
            name: "Write",
            argsText: JSON.stringify({
              file_path: "Note.md",
              content: "alpha\nbeta\n"
            })
          }
        ]
      }
    });
  });

  runtime.run = (
    request: TaskRequest,
    observer: {
      onEvent: (event: RuntimeEvent) => void;
      onExit: (result: { status: "completed" | "failed" | "cancelled"; error?: string }) => void;
    }
  ): void => {
    observerRef = observer;
    runtime["emit"](request, observer.onEvent);
  };

  const engine = new TaskEngine(runtime as never, new HostStub() as never, resolvePresetById);
  await engine.startDocumentTask({
    presetId: "default",
    triggerSource: "mention",
    context,
    inlineInstruction: "Preview beta"
  });

  const task = engine.getState().tasks[0];
  assert.ok(task);
  await engine.discardArtifact(task!.id, task!.artifacts[0]!.id);

  observerRef?.onEvent({
    type: "session.tool",
    phase: "end",
    tool: {
      id: "tool-write-1",
      name: "Tool",
      resultText: "Tool call skipped by user, and was not executed.",
      status: "Skipped",
      isError: true
    }
  });

  const updatedTask = engine.getState().tasks[0];
  assert.ok(updatedTask);
  assert.equal(updatedTask?.artifacts[0]?.applyState, "discarded");
  assert.equal(updatedTask?.artifacts[0]?.applyError, undefined);
});
