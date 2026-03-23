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
