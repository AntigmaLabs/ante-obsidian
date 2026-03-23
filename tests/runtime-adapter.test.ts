import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
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

test("resolveCommandPath falls back to ~/.ante/bin for bare ante command", () => {
  const resolved = __test__.resolveCommandPath("ante", {});
  assert.equal(resolved, `${homedir()}/.ante/bin/ante`);
});

test("non-approval TurnPause still emits a log when auto-approve is enabled", () => {
  const events: Array<{ type: string; text?: string }> = [];
  const observer: RuntimeObserver = {
    onEvent: (event) => {
      if (event.type === "log") {
        events.push(event);
      }
    },
    onExit: () => {}
  };

  const adapter = new AnteServeRuntimeAdapter(() => ({
    command: "ante",
    argsJson: JSON.stringify(["serve", "--stdio"]),
    cwd: "",
    model: "gpt-5.4",
    provider: "openai-subscription",
    autoApproveTools: true,
    env: {}
  }));

  (adapter as unknown as { activeRun: object }).activeRun = {
    observer,
    request,
    autoApproveTools: true,
    finalMessage: "",
    emittedStdout: false,
    completed: false
  };

  (adapter as unknown as { handleStdoutLine: (line: string) => void }).handleStdoutLine(
    JSON.stringify({
      event: {
        TurnPause: {
          turn_id: "op_789",
          reason: {
            Wait: {
              message: "still waiting"
            }
          }
        }
      }
    })
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "log");
  assert.match(events[0]?.text ?? "", /Ante TurnPause/);
});
