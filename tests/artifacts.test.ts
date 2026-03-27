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
