import test from "node:test";
import assert from "node:assert/strict";
import { TaskEngine } from "../src/core/task-engine";
import type {
  ContextSnapshot,
  DocumentChangeArtifact,
  RuntimeApprovalDecision,
  RuntimeEvent,
  TaskRequest
} from "../src/core/types";

const context: ContextSnapshot = {
  filePath: "Note.md",
  noteTitle: "Note",
  documentText: "alpha\n",
  selection: null
};

class RuntimeStub {
  constructor(private readonly emit: (request: TaskRequest, onEvent: (event: RuntimeEvent) => void) => void) {}

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

  respondToApproval(_approval: unknown, _decision: RuntimeApprovalDecision): void {}
}

class HostStub {
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

  async applyDocumentChange(_change: DocumentChangeArtifact): Promise<void> {}

  async revertDocumentChange(_change: DocumentChangeArtifact): Promise<void> {}

  async revealDocumentChange(_change: DocumentChangeArtifact): Promise<void> {}
}

test("batched changes for the same file collapse into one file artifact", async () => {
  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({
      type: "result.changes",
      changes: [
        {
          kind: "change",
          operation: "append-block",
          targetPath: "Note.md",
          afterText: "beta",
          title: "Append beta"
        },
        {
          kind: "change",
          operation: "append-block",
          targetPath: "Note.md",
          afterText: "gamma",
          title: "Append gamma"
        }
      ]
    });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never);
  await engine.startDocumentTask({
    presetId: "default",
    triggerSource: "mention",
    context,
    inlineInstruction: "Append two blocks"
  });

  const task = engine.getState().tasks[0];
  assert.ok(task);
  assert.equal(task?.artifacts.length, 1);
  assert.equal(task?.artifacts[0]?.target.type, "file");
  assert.equal(task?.artifacts[0]?.operation, "replace-file");
  assert.equal(task?.artifacts[0]?.beforeText, "alpha\n");
  assert.equal(task?.artifacts[0]?.afterText, "alpha\n\nbeta\n\ngamma\n");
});

test("stdout chunks are aggregated outside the visible log list", async () => {
  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({ type: "log", stream: "stdout", text: "alpha" });
    onEvent({ type: "log", stream: "stdout", text: " beta" });
    onEvent({ type: "log", stream: "system", text: "done" });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never);
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

  const engine = new TaskEngine(runtime as never, new HostStub() as never);
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
