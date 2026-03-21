import test from "node:test";
import assert from "node:assert/strict";
import { buildParagraphSelection } from "../src/core/paragraph-selection";

const editorFromLines = (lines: string[]) => ({
  getLine(line: number) {
    return lines[line] ?? "";
  },
  lineCount() {
    return lines.length;
  }
});

test("buildParagraphSelection spans the full paragraph before the mention line", () => {
  const selection = buildParagraphSelection(
    editorFromLines([
      "Alpha line",
      "Beta line",
      "@ante plan rewrite this"
    ]),
    2,
    0
  );

  assert.deepEqual(selection, {
    text: "Alpha line\nBeta line\n",
    from: { line: 0, ch: 0 },
    to: { line: 2, ch: 0 }
  });
});

test("buildParagraphSelection returns null when the mention line has no preceding paragraph content", () => {
  const selection = buildParagraphSelection(
    editorFromLines([
      "",
      "   @ante"
    ]),
    1,
    3
  );

  assert.equal(selection, null);
});
