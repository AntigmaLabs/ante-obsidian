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

test("command lookup tries interactive fallback for zsh and bash", () => {
  assert.deepEqual(__test__.getCommandLookupShellArgs("/bin/zsh"), [["-lc"], ["-ic"]]);
  assert.deepEqual(__test__.getCommandLookupShellArgs("/opt/homebrew/bin/bash"), [["-lc"], ["-ic"]]);
});

test("command lookup keeps login-only mode for other shells", () => {
  assert.deepEqual(__test__.getCommandLookupShellArgs("/bin/sh"), [["-lc"]]);
  assert.deepEqual(__test__.getCommandLookupShellArgs("/usr/local/bin/fish"), [["-lc"]]);
});

test("command lookup extracts the last non-empty line", () => {
  assert.equal(
    __test__.extractCommandLookupResult("\nwelcome\n/Users/test/.local/bin/ante\n"),
    "/Users/test/.local/bin/ante",
  );
  assert.equal(__test__.extractCommandLookupResult(""), "");
});

test("command lookup result validation accepts only safe path-like outputs", () => {
  assert.equal(__test__.isValidCommandLookupResult("/Users/test/.local/bin/ante", "ante"), true);
  assert.equal(__test__.isValidCommandLookupResult("ante", "ante"), true);
  assert.equal(__test__.isValidCommandLookupResult("alias ante='ante --stdio'", "ante"), false);
  assert.equal(__test__.isValidCommandLookupResult("ante is /Users/test/.local/bin/ante", "ante"), false);
  assert.equal(__test__.isValidCommandLookupResult("Welcome to zsh", "ante"), false);
  assert.equal(__test__.isValidCommandLookupResult("other-command", "ante"), false);
});
