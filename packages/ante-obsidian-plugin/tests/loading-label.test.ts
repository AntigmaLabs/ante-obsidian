import test from "node:test";
import assert from "node:assert/strict";
import { __test__, formatLoadingLabel, getLoadingFrame, getLoadingWord } from "../src/core/loading-label";

test("getLoadingWord is deterministic for the same seed", () => {
  assert.equal(getLoadingWord("task-123"), getLoadingWord("task-123"));
  assert.match(getLoadingWord("task-123"), /^[a-z]+$/);
});

test("getLoadingFrame cycles across the shared star frames", () => {
  assert.equal(getLoadingFrame(0), "*");
  assert.equal(getLoadingFrame(1), "**");
  assert.equal(getLoadingFrame(2), "***");
  assert.equal(getLoadingFrame(3), "**");
  assert.equal(getLoadingFrame(4), "*");
  assert.equal(getLoadingFrame(-1), "**");
});

test("formatLoadingLabel combines word and frame", () => {
  const label = formatLoadingLabel("task-abc", 2);
  const word = getLoadingWord("task-abc");
  assert.equal(label, `${word} ***`);
  assert.ok(__test__.LOADING_WORDS.includes(word as (typeof __test__.LOADING_WORDS)[number]));
});
