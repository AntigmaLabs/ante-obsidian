import test from "node:test"
import assert from "node:assert/strict"
import {
  applyProviderOverrideSelection,
  getSelectedModelForProvider,
} from "../src/obsidian/settings-tab-helpers"

test("applyProviderOverrideSelection selects the first model returned by Ante", () => {
  const settings = {
    anteProvider: "openai-subscription" as const,
    anteModel: "gpt-5.4",
  }

  applyProviderOverrideSelection(settings, "anthropic", ["claude-opus-4-6", "claude-sonnet-4-5"])

  assert.equal(settings.anteProvider, "anthropic")
  assert.equal(settings.anteModel, "claude-opus-4-6")
})

test("applyProviderOverrideSelection falls back without an Ante model list", () => {
  const settings = {
    anteProvider: "openai-subscription" as const,
    anteModel: "gpt-5.4",
  }

  applyProviderOverrideSelection(settings, "antix", [])

  assert.equal(settings.anteProvider, "antix")
  assert.equal(settings.anteModel, "gpt-5.4")
})

test("getSelectedModelForProvider uses the Ante returned list when available", () => {
  assert.equal(
    getSelectedModelForProvider("gpt-5.4", ["gemini-3-flash-preview"]),
    "gemini-3-flash-preview",
  )
  assert.equal(
    getSelectedModelForProvider("gpt-5.3-codex", ["gpt-5.5", "gpt-5.3-codex"]),
    "gpt-5.3-codex",
  )
  assert.equal(
    getSelectedModelForProvider("unknown-model", ["gpt-5.5", "gpt-5.4"]),
    "gpt-5.5",
  )
})
