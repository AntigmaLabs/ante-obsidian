import test from "node:test";
import assert from "node:assert/strict";
import { AnteServeRuntimeAdapter, type RuntimeObserver, __test__ } from "../src/runtime/ante-serve-adapter";
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
    provider: "openai-subscription",
    env: {}
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

test("nested TurnEnd error status is parsed as failed with message", () => {
  const payload = {
    turn_id: "op_123",
    status: {
      Error: {
        message: "failed to apply auth"
      }
    }
  };

  assert.equal(__test__.extractTurnStatus(payload), "Error");
  assert.equal(__test__.extractErrorMessage(payload), "failed to apply auth");
});

test("TurnPause approval payload is parsed into tools and turn id", () => {
  const payload = {
    turn_id: "op_456",
    reason: {
      Approval: {
        tools: [
          {
            id: "call_WebFetch_0",
            name: "WebFetch",
            args: {
              url: "https://example.com",
              prompt: "What is the title?"
            }
          }
        ],
        message: "Please approve the following tool calls"
      }
    }
  };

  assert.deepEqual(__test__.extractTurnPauseApproval(payload), {
    turnId: "op_456",
    message: "Please approve the following tool calls",
    tools: [
      {
        id: "call_WebFetch_0",
        name: "WebFetch",
        argsText: JSON.stringify({
          url: "https://example.com",
          prompt: "What is the title?"
        })
      }
    ]
  });
});
