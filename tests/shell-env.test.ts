import test from "node:test";
import assert from "node:assert/strict";
import { __test__ } from "../src/obsidian/shell-env";

test("normalizeEnvVarName accepts legal env var names", () => {
  assert.equal(__test__.normalizeEnvVarName("GEMINI_API_KEY"), "GEMINI_API_KEY");
  assert.equal(__test__.normalizeEnvVarName("_TOKEN_2"), "_TOKEN_2");
});

test("normalizeEnvVarName rejects unsafe env var names", () => {
  assert.equal(__test__.normalizeEnvVarName("GEMINI_API_KEY; rm -rf /"), "");
  assert.equal(__test__.normalizeEnvVarName("${HOME}"), "");
  assert.equal(__test__.normalizeEnvVarName("BAD-NAME"), "");
  assert.equal(__test__.normalizeEnvVarName(""), "");
});
