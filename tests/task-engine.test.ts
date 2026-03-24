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
  assert.equal(task?.artifacts[0]?.sourceChanges.length, 2);
  assert.equal(task?.artifacts[0]?.sourceChanges[0]?.afterText, "beta");
  assert.equal(task?.artifacts[0]?.sourceChanges[1]?.afterText, "gamma");
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

test("context-menu tasks can keep change suggestions inline without generating artifacts", async () => {
  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({
      type: "result.change",
      change: {
        kind: "change",
        operation: "append-block",
        targetPath: "Note.md",
        afterText: "summary block",
        title: "Summary"
      }
    });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never);
  await engine.startDocumentTask({
    presetId: "summary",
    triggerSource: "context-menu",
    context,
    inlineInstruction: "Summarize this selection",
    captureChangesAsArtifacts: false
  });

  const task = engine.getState().tasks[0];
  assert.ok(task);
  assert.equal(task?.artifacts.length, 0);
  assert.equal(task?.inlineChanges?.length, 1);
  assert.equal(task?.inlineChanges?.[0]?.afterText, "summary block");
  assert.equal(task?.status, "completed");
});

test("context-menu tasks still generate artifacts for non-inline file changes", async () => {
  const runtime = new RuntimeStub((_request, onEvent) => {
    onEvent({
      type: "result.change",
      change: {
        kind: "change",
        operation: "create-file",
        targetPath: "Summary.md",
        afterText: "# Summary\n",
        title: "Summary file"
      }
    });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never);
  await engine.startDocumentTask({
    presetId: "summary",
    triggerSource: "context-menu",
    context,
    inlineInstruction: "Summarize this selection",
    captureChangesAsArtifacts: false
  });

  const task = engine.getState().tasks[0];
  assert.ok(task);
  assert.equal(task?.inlineChanges?.length ?? 0, 0);
  assert.equal(task?.artifacts.length, 1);
  assert.equal(task?.artifacts[0]?.target.type, "file");
  assert.equal(task?.artifacts[0]?.target.path, "Summary.md");
  assert.equal(task?.status, "awaiting-apply");
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

test("startChatTask creates a chat task with chat trigger source", async () => {
  let capturedRequest: TaskRequest | null = null;
  const runtime = new RuntimeStub((request, onEvent) => {
    capturedRequest = request;
    onEvent({ type: "result.text", text: "hello from chat" });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never);
  await engine.startChatTask("Start a chat");

  assert.ok(capturedRequest);
  assert.equal(capturedRequest?.kind, "chat");
  assert.equal(capturedRequest?.triggerSource, "chat");
  assert.equal(capturedRequest?.mode, "initial");

  const task = engine.getState().tasks[0];
  assert.ok(task);
  assert.equal(task?.kind, "chat");
  assert.equal(task?.triggerSource, "chat");
  assert.equal(task?.textResult?.text, "hello from chat");
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

  const engine = new TaskEngine(runtime as never, new HostStub() as never);
  await engine.startChatTask("First turn");
  await engine.startChatTask("Second turn", true);

  assert.equal(seenRequests.length, 2);
  assert.equal(seenRequests[0]?.runtimeSessionId, undefined);
  assert.equal(seenRequests[0]?.mode, "initial");
  assert.equal(seenRequests[1]?.mode, "followup");
  assert.equal(seenRequests[1]?.runtimeSessionId, "session-1");
  assert.equal(seenRequests[1]?.followUpPrompt, "Second turn");
});

test("clearTasksByTriggerSource removes only chat tasks", async () => {
  const runtime = new RuntimeStub((request, onEvent) => {
    onEvent({ type: "result.text", text: request.inlineInstruction });
    onEvent({ type: "session.completed", summary: "done" });
  });

  const engine = new TaskEngine(runtime as never, new HostStub() as never);
  await engine.startChatTask("Chat turn");
  await engine.startTerminalTask("Terminal turn");

  engine.clearTasksByTriggerSource("chat");

  const tasks = engine.getState().tasks;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.triggerSource, "terminal");
  assert.equal(tasks[0]?.inlineInstruction, "Terminal turn");
});
