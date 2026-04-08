import test from "node:test"
import assert from "node:assert/strict"
import {
  applyProviderOverrideSelection,
  getSelectedModelForProvider,
} from "../src/obsidian/settings-tab-helpers"

test("applyProviderOverrideSelection resets model to provider default", () => {
  const settings = {
    anteProvider: "openai-subscription" as const,
    anteModel: "gpt-5.4",
  }

  applyProviderOverrideSelection(settings, "anthropic")

  assert.equal(settings.anteProvider, "anthropic")
  assert.equal(settings.anteModel, "claude-sonnet-4-5")
})

test("getSelectedModelForProvider falls back when current model is not available", () => {
  assert.equal(
    getSelectedModelForProvider("gemini", "gpt-5.4"),
    "gemini-3-flash-preview",
  )
  assert.equal(
    getSelectedModelForProvider("openai-subscription", "gpt-5.3-codex"),
    "gpt-5.3-codex",
  )
})
