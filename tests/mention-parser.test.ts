import test from "node:test";
import assert from "node:assert/strict";
import { parseMentionLine } from "../src/core/mention-parser";

test("parseMentionLine detects default ante mention", () => {
  assert.deepEqual(parseMentionLine("Please help @ante"), {
    presetId: "default",
    inlineInstruction: "",
    start: 12,
    end: 17
  });
});

test("parseMentionLine detects research and preserves trailing instruction", () => {
  assert.deepEqual(parseMentionLine("@ante research look for gaps"), {
    presetId: "research",
    inlineInstruction: "look for gaps",
    start: 0,
    end: 14
  });
});

test("parseMentionLine detects plan mention", () => {
  const match = parseMentionLine("foo (@ante plan break this down)");
  assert.equal(match?.presetId, "plan");
  assert.equal(match?.inlineInstruction, "break this down)");
});

test("parseMentionLine ignores non-token text", () => {
  assert.equal(parseMentionLine("ante is just plain text"), null);
});
