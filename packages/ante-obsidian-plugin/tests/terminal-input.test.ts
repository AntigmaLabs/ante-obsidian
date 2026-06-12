import test from "node:test";
import assert from "node:assert/strict";
import {
  navigatePromptHistory,
  shouldHandlePromptEnter,
  shouldStopFromPromptShortcut,
} from "../src/core/terminal-input";

test("shouldHandlePromptEnter blocks IME composition enter events", () => {
  assert.equal(
    shouldHandlePromptEnter({
      isComposing: true,
      eventIsComposing: false,
    }),
    false,
  );
  assert.equal(
    shouldHandlePromptEnter({
      isComposing: false,
      eventIsComposing: true,
    }),
    false,
  );
  assert.equal(
    shouldHandlePromptEnter({
      isComposing: false,
      eventIsComposing: false,
    }),
    true,
  );
});

test("navigatePromptHistory enters history from the current draft", () => {
  const next = navigatePromptHistory(["first", "second"], -1, "", "draft", "up");

  assert.equal(next.historyIndex, 1);
  assert.equal(next.draftPrompt, "draft");
  assert.equal(next.nextText, "second");
});

test("navigatePromptHistory moves forward and restores the draft", () => {
  const next = navigatePromptHistory(["first", "second"], 1, "draft", "second", "down");

  assert.equal(next.historyIndex, -1);
  assert.equal(next.draftPrompt, "draft");
  assert.equal(next.nextText, "draft");
});

test("navigatePromptHistory clamps at both ends", () => {
  const up = navigatePromptHistory(["first", "second"], 0, "draft", "first", "up");
  assert.equal(up.historyIndex, 0);
  assert.equal(up.nextText, "first");

  const down = navigatePromptHistory(["first", "second"], -1, "draft", "draft", "down");
  assert.equal(down.historyIndex, -1);
  assert.equal(down.nextText, "draft");
});

test("shouldStopFromPromptShortcut only matches plain ctrl+c", () => {
  assert.equal(
    shouldStopFromPromptShortcut({
      ctrlKey: true,
      key: "c",
    }),
    true,
  );
  assert.equal(
    shouldStopFromPromptShortcut({
      ctrlKey: true,
      shiftKey: true,
      key: "c",
    }),
    false,
  );
  assert.equal(
    shouldStopFromPromptShortcut({
      ctrlKey: false,
      key: "c",
    }),
    false,
  );
  assert.equal(
    shouldStopFromPromptShortcut({
      ctrlKey: true,
      key: "x",
    }),
    false,
  );
});
