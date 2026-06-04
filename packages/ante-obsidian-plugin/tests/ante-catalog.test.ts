import test from "node:test";
import assert from "node:assert/strict";
import { parseAnteCatalog, __test__ } from "../src/obsidian/ante-catalog";

const { deriveAuth } = __test__;

test("deriveAuth maps bearer env_key to api-key", () => {
  assert.deepEqual(deriveAuth({ bearer: { env_key: "OPENAI_API_KEY" } }), {
    authType: "api-key",
    envKey: "OPENAI_API_KEY",
  });
});

test("deriveAuth maps header env_key to api-key", () => {
  assert.deepEqual(deriveAuth({ header: { name: "x-api-key", env_key: "ANTHROPIC_API_KEY" } }), {
    authType: "api-key",
    envKey: "ANTHROPIC_API_KEY",
  });
});

test("deriveAuth maps oauth_preset to oauth", () => {
  assert.deepEqual(deriveAuth({ bearer: { oauth_preset: "openai" } }), {
    authType: "oauth",
    oauthPreset: "openai",
  });
});

test("deriveAuth treats missing/null auth as none", () => {
  assert.deepEqual(deriveAuth(null), { authType: "none" });
  assert.deepEqual(deriveAuth(undefined), { authType: "none" });
});

test("parseAnteCatalog parses providers, preserves order, and maps models", () => {
  const json = JSON.stringify({
    providers: {
      anthropic: {
        id: "anthropic",
        display_name: "Anthropic",
        auth: { header: { name: "x-api-key", env_key: "ANTHROPIC_API_KEY" } },
        preferred_models: [{ id: "claude-opus-4-8" }, { id: "claude-haiku-4-5" }],
      },
      "openai-subscription": {
        id: "openai-subscription",
        display_name: "OpenAI Subscription",
        auth: { bearer: { oauth_preset: "openai" } },
        preferred_models: [{ id: "gpt-5.5" }],
      },
      local: {
        id: "local",
        display_name: "Local Provider Server",
        preferred_models: [],
      },
    },
    models: {},
  });

  const catalog = parseAnteCatalog(json);
  assert.ok(catalog);
  assert.deepEqual(
    catalog!.providers.map((p) => p.id),
    ["anthropic", "openai-subscription", "local"]
  );

  const [anthropic, openai, local] = catalog!.providers;
  assert.equal(anthropic.authType, "api-key");
  assert.equal(anthropic.envKey, "ANTHROPIC_API_KEY");
  assert.deepEqual(anthropic.models, ["claude-opus-4-8", "claude-haiku-4-5"]);
  // PROVIDER_HINTS supplies the key placeholder; label falls back to display_name.
  assert.equal(anthropic.keyPlaceholder, "sk-ant-...");
  assert.equal(anthropic.label, "Anthropic");

  assert.equal(openai.authType, "oauth");
  assert.equal(openai.oauthPreset, "openai");

  assert.equal(local.authType, "none");
  assert.deepEqual(local.models, []);
  // Hint overrides the awkward catalog display_name.
  assert.equal(local.label, "Local");
});

test("parseAnteCatalog dedups repeated model ids and skips malformed entries", () => {
  const json = JSON.stringify({
    providers: {
      x: {
        id: "x",
        display_name: "X",
        preferred_models: [{ id: "m" }, { id: "m" }, { nope: true }, "string-entry"],
      },
    },
  });
  const catalog = parseAnteCatalog(json);
  assert.deepEqual(catalog!.providers[0]!.models, ["m"]);
});

test("parseAnteCatalog returns null for malformed or non-catalog input", () => {
  assert.equal(parseAnteCatalog("not json"), null);
  assert.equal(parseAnteCatalog("[]"), null);
  assert.equal(parseAnteCatalog(JSON.stringify({ providers: [] })), null);
  assert.equal(parseAnteCatalog(JSON.stringify({ models: {} })), null);
});
