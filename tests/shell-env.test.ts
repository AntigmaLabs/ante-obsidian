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

test("normalizeCommandName accepts safe executable names", () => {
  assert.equal(__test__.normalizeCommandName("ante"), "ante");
  assert.equal(__test__.normalizeCommandName("ante-cli"), "ante-cli");
  assert.equal(__test__.normalizeCommandName("ante_v2.1"), "ante_v2.1");
});

test("normalizeCommandName rejects unsafe executable names", () => {
  assert.equal(__test__.normalizeCommandName("ante --stdio"), "");
  assert.equal(__test__.normalizeCommandName("ante; rm -rf /"), "");
  assert.equal(__test__.normalizeCommandName("$(whoami)"), "");
  assert.equal(__test__.normalizeCommandName(""), "");
});
