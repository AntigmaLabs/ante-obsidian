import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import {
  extractErrorMessage,
  extractTurnPauseApproval,
  extractTurnStatus,
  parseAssistantMessage
} from "../src/runtime/ante-event-parser";
import { resolveCommandPath } from "../src/runtime/transport/ante-stdio-transport";

test("nested TurnEnd error status is parsed as failed with message", () => {
  const payload = {
    turn_id: "op_123",
    status: {
      Error: {
        message: "failed to apply auth"
      }
    }
  };

  assert.equal(extractTurnStatus(payload), "Error");
  assert.equal(extractErrorMessage(payload), "failed to apply auth");
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

  assert.deepEqual(extractTurnPauseApproval(payload), {
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

test("parseAssistantMessage strips trailing end_turn marker from text payload", () => {
  const events = parseAssistantMessage(`{"type":"text","text":"hello\\nworld"}[end_turn]`);

  assert.deepEqual(events, [{ type: "result.text", text: "hello\nworld" }]);
});

test("parseAssistantMessage falls back to extracting only the text field", () => {
  const events = parseAssistantMessage(`{
    "type": "text",
    "text": "only this should render",
    "meta": {"ignored": true}
  } trailing noise`);

  assert.deepEqual(events, [{ type: "result.text", text: "only this should render" }]);
});

test("parseAssistantMessage fallback only accepts top-level text payload", () => {
  const events = parseAssistantMessage(`prefix {
    "type": "text",
    "meta": {"text": "ignore this nested value"},
    "text": "use the top-level text"
  } suffix`);

  assert.deepEqual(events, [{ type: "result.text", text: "use the top-level text" }]);
});

test("parseAssistantMessage fallback skips earlier non-text objects", () => {
  const events = parseAssistantMessage(`noise {"meta":{"kind":"debug"}} middle {"type":"text","text":"final payload"} tail`);

  assert.deepEqual(events, [{ type: "result.text", text: "final payload" }]);
});

test("resolveCommandPath falls back to ~/.ante/bin for bare ante command", () => {
  const resolved = resolveCommandPath("ante", {});
  assert.equal(resolved, `${homedir()}/.ante/bin/ante`);
});
