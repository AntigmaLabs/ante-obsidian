import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import {
  extractErrorMessage,
  extractInfoMessage,
  extractTurnPauseApproval,
  extractTurnStatus,
  extractUsage,
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

test("parseAssistantMessage keeps legacy change JSON as plain text", () => {
  const events = parseAssistantMessage(`{
    "type":"change",
    "operation":"insert-block",
    "afterText":"intro",
    "anchor":{"by":"heading","value":"Next"},
    "placement":"before"
  }`);

  assert.deepEqual(events, [{
    type: "result.text",
    text: '{\n    "type":"change",\n    "operation":"insert-block",\n    "afterText":"intro",\n    "anchor":{"by":"heading","value":"Next"},\n    "placement":"before"\n  }'
  }]);
});

test("parseAssistantMessage keeps fenced legacy change JSON inside surrounding prose", () => {
  const events = parseAssistantMessage(`我会按你的要求修改：

\`\`\`json
{
  "type":"change",
  "operation":"append-block",
  "afterText":"done"
}
\`\`\`

已生成结果。`);

  assert.deepEqual(events, [{ type: "result.text", text: '我会按你的要求修改：\n\n```json\n{\n  "type":"change",\n  "operation":"append-block",\n  "afterText":"done"\n}\n```\n\n已生成结果。' }]);
});

test("extractUsage accepts canonical usage payloads", () => {
  assert.deepEqual(
    extractUsage({
      prompt_tokens: 12,
      completion_tokens: 7,
      total_tokens: 19
    }),
    {
      promptTokens: 12,
      completionTokens: 7,
      totalTokens: 19,
      raw: {
        prompt_tokens: 12,
        completion_tokens: 7,
        total_tokens: 19
      }
    }
  );
});

test("extractUsage accepts nested usage payloads with alternate token keys", () => {
  assert.deepEqual(
    extractUsage({
      usage: {
        input_token_count: 30,
        output_token_count: 12,
        total_token_count: 42
      }
    }),
    {
      promptTokens: 30,
      completionTokens: 12,
      totalTokens: 42,
      raw: {
        usage: {
          input_token_count: 30,
          output_token_count: 12,
          total_token_count: 42
        }
      }
    }
  );
});

test("extractInfoMessage prefers structured text fields", () => {
  assert.equal(
    extractInfoMessage({
      message: "context compacted"
    }),
    "context compacted"
  );
});

test("resolveCommandPath falls back to ~/.ante/bin for bare ante command", () => {
  const resolved = resolveCommandPath("ante", {});
  assert.equal(resolved, `${homedir()}/.ante/bin/ante`);
});
