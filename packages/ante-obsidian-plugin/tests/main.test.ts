import test from "node:test"
import assert from "node:assert/strict"
import { buildAnteRuntimeConfig } from "../src/obsidian/main-runtime-config"
import type { AnteCatalogProvider } from "../src/obsidian/ante-catalog"

const apiKeyProvider = (id: string, envKey: string): AnteCatalogProvider => ({
  id,
  label: id,
  authType: "api-key",
  envKey,
  models: [],
})

const GEMINI_AND_ANTHROPIC: AnteCatalogProvider[] = [
  apiKeyProvider("gemini", "GEMINI_API_KEY"),
  apiKeyProvider("anthropic", "ANTHROPIC_API_KEY"),
]

test("buildAnteRuntimeConfig prefers explicit gemini key and emits only selected provider env", () => {
  const config = buildAnteRuntimeConfig({
    settings: {
      connectionMode: "websocket",
      wsAddress: "127.0.0.1:8765",
      autoApproveAnteTools: true,
      anteThinking: "Deep",
      geminiApiKeyEnvKey: "GEMINI_API_KEY",
      geminiApiKey: "gemini-inline",
      anthropicApiKeyEnvKey: "ANTHROPIC_API_KEY",
      anthropicApiKey: "anthropic-inline",
    },
    resolvedTarget: {
      provider: "gemini",
      model: "gemini-3-flash-preview",
    },
    apiKeyProviders: GEMINI_AND_ANTHROPIC,
    shellEnv: {
      GEMINI_API_KEY: "gemini-shell",
      ANTHROPIC_API_KEY: "anthropic-shell",
    },
    processEnv: {
      GEMINI_API_KEY: "gemini-process",
      ANTHROPIC_API_KEY: "anthropic-process",
    },
  })

  assert.equal(config.connectionMode, "stdio")
  assert.equal(config.provider, "gemini")
  assert.equal(config.model, "gemini-3-flash-preview")
  assert.equal(config.thinking, "Deep")
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
      anteThinking: "ante-default",
      geminiApiKeyEnvKey: "GEMINI_API_KEY",
      geminiApiKey: "",
      anthropicApiKeyEnvKey: "ANTHROPIC_API_KEY",
      anthropicApiKey: "",
    },
    resolvedTarget: {
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    },
    apiKeyProviders: GEMINI_AND_ANTHROPIC,
    shellEnv: {},
    processEnv: {
      ANTHROPIC_API_KEY: "anthropic-process",
    },
  })

  assert.equal(config.connectionMode, "stdio")
  assert.equal(config.autoApproveTools, false)
  assert.equal(config.thinking, null)
  assert.deepEqual(config.env, { ANTHROPIC_API_KEY: "anthropic-process" })
})
