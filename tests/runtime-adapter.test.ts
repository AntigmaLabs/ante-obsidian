import test from "node:test";
import assert from "node:assert/strict";
import { AnteServeRuntimeAdapter, type RuntimeObserver } from "../src/runtime/ante-serve-adapter";
import type { TaskRequest } from "../src/core/types";

const request: TaskRequest = {
  taskId: "task-1",
  kind: "document",
  triggerSource: "mention",
  preset: {
    id: "default",
    label: "Default",
    goal: "Edit the current note",
    systemInstructions: ""
  },
  context: {
    filePath: "Note.md",
    noteTitle: "Note",
    documentText: "hello",
    selection: null
  },
  inlineInstruction: "test"
};

test("run reports invalid args JSON as a failed exit instead of throwing", () => {
  const adapter = new AnteServeRuntimeAdapter(() => ({
    command: "ante",
    argsJson: "{bad json",
    cwd: "",
    model: "gpt-5.4",
    provider: "openai-subscription"
  }));

  const exits: Array<{ status: "completed" | "failed" | "cancelled"; error?: string }> = [];
  const observer: RuntimeObserver = {
    onEvent: () => {},
    onExit: (result) => {
      exits.push(result);
    }
  };

  assert.doesNotThrow(() => {
    adapter.run(request, observer);
  });
  assert.equal(exits.length, 1);
  assert.equal(exits[0]?.status, "failed");
  assert.match(exits[0]?.error ?? "", /Unexpected token|JSON/i);
});
