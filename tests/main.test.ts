import test from "node:test"
import assert from "node:assert/strict"
import { buildAnteRuntimeConfig } from "../src/obsidian/main-runtime-config"

test("buildAnteRuntimeConfig prefers explicit gemini key and emits only selected provider env", () => {
  const config = buildAnteRuntimeConfig({
    settings: {
      connectionMode: "websocket",
      wsAddress: "127.0.0.1:8765",
      autoApproveAnteTools: true,
      geminiApiKeyEnvKey: "GEMINI_API_KEY",
      geminiApiKey: "gemini-inline",
      anthropicApiKeyEnvKey: "ANTHROPIC_API_KEY",
      anthropicApiKey: "anthropic-inline",
    },
    resolvedTarget: {
      provider: "gemini",
      model: "gemini-3-flash-preview",
    },
    shellEnv: {
      GEMINI_API_KEY: "gemini-shell",
      ANTHROPIC_API_KEY: "anthropic-shell",
    },
    processEnv: {
      GEMINI_API_KEY: "gemini-process",
      ANTHROPIC_API_KEY: "anthropic-process",
    },
  })

  assert.equal(config.connectionMode, "websocket")
  assert.equal(config.provider, "gemini")
  assert.equal(config.model, "gemini-3-flash-preview")
  assert.deepEqual(config.env, {
    GEMINI_API_KEY: "gemini-inline",
    ANTHROPIC_API_KEY: "anthropic-inline",
  })
})

test("buildAnteRuntimeConfig falls back from shell env to process env for anthropic", () => {
  const config = buildAnteRuntimeConfig({
    settings: {
      connectionMode: "stdio",
      wsAddress: "127.0.0.1:8765",
      autoApproveAnteTools: false,
      geminiApiKeyEnvKey: "GEMINI_API_KEY",
      geminiApiKey: "",
      anthropicApiKeyEnvKey: "ANTHROPIC_API_KEY",
      anthropicApiKey: "",
    },
    resolvedTarget: {
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    },
    shellEnv: {},
    processEnv: {
      ANTHROPIC_API_KEY: "anthropic-process",
    },
  })

  assert.equal(config.connectionMode, "stdio")
  assert.equal(config.autoApproveTools, false)
  assert.deepEqual(config.env, { ANTHROPIC_API_KEY: "anthropic-process" })
})
