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

test("parseMentionLine ignores research and plan modifiers", () => {
  // 现在会将 "research look for gaps" 视为内联指令，而不是预设
  assert.deepEqual(parseMentionLine("@ante research look for gaps"), {
    presetId: "default",
    inlineInstruction: "research look for gaps",
    start: 0,
    end: 5
  });

  // 现在会将 "plan break this down" 视为内联指令，而不是预设
  const match = parseMentionLine("foo (@ante plan break this down)");
  assert.equal(match?.presetId, "default");
  assert.equal(match?.inlineInstruction, "plan break this down)");
});

test("parseMentionLine ignores non-token text", () => {
  assert.equal(parseMentionLine("ante is just plain text"), null);
});
