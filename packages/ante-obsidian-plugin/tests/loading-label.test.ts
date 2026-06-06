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
  const t = 1717660800000;
  const label = formatLoadingLabel("task-abc", 2, t);
  const word = getLoadingWord("task-abc", t);
  assert.equal(label, `${word} ***`);
  assert.ok(__test__.LOADING_WORDS.includes(word as (typeof __test__.LOADING_WORDS)[number]));
});

test("getLoadingWord cycles every 4 seconds and avoids consecutive repeats", () => {
  const seed = "test-task-123";
  let t = 1717660800000;
  let lastWord = getLoadingWord(seed, t);

  for (let i = 0; i < 20; i++) {
    t += 4000; // increment by exactly 4 seconds
    const newWord = getLoadingWord(seed, t);
    assert.notEqual(newWord, lastWord, `Word should change at t = ${t}`);
    assert.ok(__test__.LOADING_WORDS.includes(newWord as (typeof __test__.LOADING_WORDS)[number]));
    lastWord = newWord;
  }
});
