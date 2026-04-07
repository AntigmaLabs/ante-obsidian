import test from "node:test";
import assert from "node:assert/strict";
import { resolveMentionTrigger } from "../src/core/mention-trigger-state";

test("resolveMentionTrigger does not trigger while typing the mention line", () => {
  const result = resolveMentionTrigger("Note.md", 0, "@ante", "");

  assert.equal(result.match, null);
  assert.equal(result.releaseHandledPrefix, "Note.md:0:");
});

test("resolveMentionTrigger triggers after enter on the following blank line", () => {
  const result = resolveMentionTrigger("Note.md", 1, "", "@ante");

  assert.equal(result.match?.presetId, "default");
  assert.equal(result.matchLine, 0);
  assert.equal(result.lineKey, "Note.md:0:@ante");
});

test("resolveMentionTrigger does not release handled keys while editing the blank line", () => {
  const result = resolveMentionTrigger("Note.md", 1, "drafting", "@ante");

  assert.equal(result.match, null);
  assert.equal(result.releaseHandledPrefix, null);
});

test("resolveMentionTrigger allows retrigger only after the mention line itself changes", () => {
  const result = resolveMentionTrigger("Note.md", 0, "@ante rewrite", "");

  assert.equal(result.match, null);
  assert.equal(result.releaseHandledPrefix, "Note.md:0:");
});
