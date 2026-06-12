import test from "node:test";
import assert from "node:assert/strict";
import { buildPatchRows } from "../src/core/diff-service";
import { getArtifactTargetKey, mergeDocumentChangeArtifacts } from "../src/core/artifacts";
import type { DocumentChangeArtifact } from "../src/core/types";

const artifact = (overrides: Partial<DocumentChangeArtifact> = {}): DocumentChangeArtifact => ({
  id: "artifact-1",
  title: "Update note",
  operation: "replace-file",
  target: {
    type: "file",
    path: "Notes/example.md",
  },
  beforeText: "alpha\nbeta\n",
  afterText: "alpha\ngamma\n",
  applyState: "pending",
  ...overrides,
});

test("buildPatchRows returns a unified diff for file changes", async () => {
  const rows = await buildPatchRows(artifact());
  const lines = rows.map((row) => row.text);
  assert.ok(lines.some((line) => line.startsWith("diff --git ")));
  assert.ok(lines.some((line) => line.includes("Notes/example.md")));
  assert.ok(lines.some((line) => line === "beta" || line === "gamma"));
});

test("buildPatchRows uses /dev/null for create-file", async () => {
  const rows = await buildPatchRows(
    artifact({
      operation: "create-file",
      beforeText: "",
      afterText: "# New note\n",
      target: {
        type: "file",
        path: "Notes/new-note.md",
      },
    }),
  );
  const meta = rows.filter((row) => row.kind === "meta").map((row) => row.text);
  assert.ok(meta.some((line) => line.includes("/dev/null")));
  assert.ok(meta.some((line) => line.includes("Notes/new-note.md")));
});

test("mergeDocumentChangeArtifacts keeps the first baseline and latest result", () => {
  const merged = mergeDocumentChangeArtifacts(
    artifact({
      id: "first",
      beforeText: "alpha\n",
      afterText: "alpha\nbeta\n",
      runtimeToolId: "tool-1",
    }),
    artifact({
      id: "second",
      beforeText: "alpha\nbeta\n",
      afterText: "alpha\nbeta\ngamma\n",
      runtimeToolId: "tool-2",
    }),
  );

  assert.equal(merged.id, "first");
  assert.equal(merged.beforeText, "alpha\n");
  assert.equal(merged.afterText, "alpha\nbeta\ngamma\n");
  assert.equal(merged.runtimeToolId, "tool-2");
});

test("getArtifactTargetKey normalizes equivalent file path spellings", () => {
  assert.equal(
    getArtifactTargetKey(artifact({ target: { type: "file", path: "Notes//today\\Plan.md" } })),
    "Notes/today/Plan.md",
  );
});
