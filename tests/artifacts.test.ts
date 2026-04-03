import test from "node:test";
import assert from "node:assert/strict";
import { toDocumentChangeArtifact } from "../src/core/artifacts";
import type { ContextSnapshot, RuntimeChangeSuggestion } from "../src/core/types";

test("replace-selection can overwrite a trailing @ante trigger outside selection text", () => {
  const context: ContextSnapshot = {
    vaultPath: "/vaults/test",
    filePath: "Note.md",
    noteTitle: "Note",
    documentText: "Old draft @ante rewrite this",
    selection: {
      text: "Old draft",
      from: { line: 0, ch: 0 },
      to: { line: 0, ch: "Old draft @ante rewrite this".length }
    }
  };
  const change: RuntimeChangeSuggestion = {
    kind: "change",
    operation: "replace-selection",
    afterText: "New draft"
  };

  const artifact = toDocumentChangeArtifact(change, context, context.documentText ?? "");
  assert.equal(artifact.afterText, "New draft");
  assert.equal(artifact.sourceChanges.length, 1);
  assert.equal(artifact.sourceChanges[0]?.afterText, "New draft");
});

test("replace-selection supports zero-width selections as insertion points", () => {
  const context: ContextSnapshot = {
    vaultPath: "/vaults/test",
    filePath: "Note.md",
    noteTitle: "Note",
    documentText: "alpha\nbeta\n",
    selection: {
      text: "",
      from: { line: 1, ch: 0 },
      to: { line: 1, ch: 0 }
    }
  };
  const change: RuntimeChangeSuggestion = {
    kind: "change",
    operation: "replace-selection",
    afterText: "inserted\n"
  };

  const artifact = toDocumentChangeArtifact(change, context, context.documentText ?? "");
  assert.equal(artifact.afterText, "alpha\ninserted\nbeta\n");
});

test("insert-block can target document start", () => {
  const context: ContextSnapshot = {
    vaultPath: "/vaults/test",
    filePath: "Note.md",
    noteTitle: "Note",
    documentText: "alpha\n\nbeta\n",
    selection: {
      text: "",
      from: { line: 0, ch: 0 },
      to: { line: 0, ch: 0 }
    }
  };
  const change: RuntimeChangeSuggestion = {
    kind: "change",
    operation: "insert-block",
    afterText: "intro",
    anchor: { by: "document-start" }
  };

  const artifact = toDocumentChangeArtifact(change, context, context.documentText ?? "");
  assert.equal(artifact.afterText, "intro\n\nalpha\n\nbeta\n");
});

test("insert-block can target a heading anchor", () => {
  const context: ContextSnapshot = {
    vaultPath: "/vaults/test",
    filePath: "Note.md",
    noteTitle: "Note",
    documentText: "# Plan\n\nalpha\n\n## Next\n\nbeta\n",
    selection: {
      text: "",
      from: { line: 0, ch: 0 },
      to: { line: 0, ch: 0 }
    }
  };
  const change: RuntimeChangeSuggestion = {
    kind: "change",
    operation: "insert-block",
    afterText: "inserted",
    anchor: { by: "heading", value: "Next" },
    placement: "before"
  };

  const artifact = toDocumentChangeArtifact(change, context, context.documentText ?? "");
  assert.equal(artifact.afterText, "# Plan\n\nalpha\n\ninserted\n\n## Next\n\nbeta\n");
});

test("insert-block heading anchor accepts markdown heading syntax in the anchor value", () => {
  const context: ContextSnapshot = {
    vaultPath: "/vaults/test",
    filePath: "Note.md",
    noteTitle: "Note",
    documentText: "# Plan\n\nalpha\n\n## Draft Recommendation\n\nbeta\n",
    selection: {
      text: "",
      from: { line: 0, ch: 0 },
      to: { line: 0, ch: 0 }
    }
  };
  const change: RuntimeChangeSuggestion = {
    kind: "change",
    operation: "insert-block",
    afterText: "inserted",
    anchor: { by: "heading", value: "## Draft Recommendation" },
    placement: "before"
  };

  const artifact = toDocumentChangeArtifact(change, context, context.documentText ?? "");
  assert.equal(artifact.afterText, "# Plan\n\nalpha\n\ninserted\n\n## Draft Recommendation\n\nbeta\n");
});

test("insert-block heading anchor preserves semantic trailing hash characters", () => {
  const context: ContextSnapshot = {
    vaultPath: "/vaults/test",
    filePath: "Note.md",
    noteTitle: "Note",
    documentText: "# Languages\n\n## C#\n\nbeta\n",
    selection: {
      text: "",
      from: { line: 0, ch: 0 },
      to: { line: 0, ch: 0 }
    }
  };
  const change: RuntimeChangeSuggestion = {
    kind: "change",
    operation: "insert-block",
    afterText: "inserted",
    anchor: { by: "heading", value: "## C#" },
    placement: "before"
  };

  const artifact = toDocumentChangeArtifact(change, context, context.documentText ?? "");
  assert.equal(artifact.afterText, "# Languages\n\ninserted\n\n## C#\n\nbeta\n");
});

test("insert-block can target a paragraph index anchor", () => {
  const context: ContextSnapshot = {
    vaultPath: "/vaults/test",
    filePath: "Note.md",
    noteTitle: "Note",
    documentText: "first\n\nsecond\n\nthird\n",
    selection: {
      text: "",
      from: { line: 0, ch: 0 },
      to: { line: 0, ch: 0 }
    }
  };
  const change: RuntimeChangeSuggestion = {
    kind: "change",
    operation: "insert-block",
    afterText: "between",
    anchor: { by: "paragraph-index", value: 2 },
    placement: "after"
  };

  const artifact = toDocumentChangeArtifact(change, context, context.documentText ?? "");
  assert.equal(artifact.afterText, "first\n\nsecond\n\nbetween\n\nthird\n");
});
