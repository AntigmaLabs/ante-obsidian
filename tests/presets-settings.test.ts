import test from "node:test";
import assert from "node:assert/strict";
import { listResolvedPresets } from "../src/core/presets";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/obsidian/settings";

test("normalizeSettings appends valid custom presets after builtin presets by default", () => {
  const settings = normalizeSettings({
    connectionMode: "websocket",
    wsAddress: "127.0.0.1:9000",
    customPresets: [
      {
        id: "custom-a",
        name: "My Preset",
        instruction: "Write a sharper version."
      }
    ]
  });

  assert.equal(settings.customPresets.length, 1);
  assert.equal(settings.connectionMode, "websocket");
  assert.equal(settings.wsAddress, "127.0.0.1:9000");
  assert.equal(settings.customPresets[0]?.sortOrder, DEFAULT_SETTINGS.builtinPresetPreferences.length);
  assert.equal(settings.customPresets[0]?.enabled, true);
});

test("listResolvedPresets applies builtin visibility and mixed ordering", () => {
  const presets = listResolvedPresets(
    normalizeSettings({
      builtinPresetPreferences: [
        { id: "default", enabled: true, sortOrder: 2 },
        { id: "research", enabled: false, sortOrder: 1 },
        { id: "plan", enabled: true, sortOrder: 3 },
        { id: "summary", enabled: true, sortOrder: 4 }
      ],
      customPresets: [
        {
          id: "custom-a",
          name: "Custom A",
          instruction: "Do the custom thing.",
          enabled: true,
          sortOrder: 0
        }
      ]
    })
  );

  assert.deepEqual(
    presets.map((preset) => [preset.id, preset.enabled]),
    [
      ["custom-a", true],
      ["research", false],
      ["default", true],
      ["plan", true],
      ["summary", true]
    ]
  );
});

test("normalizeSettings does not share builtin preset preference objects with defaults", () => {
  const settings = normalizeSettings(undefined);

  settings.builtinPresetPreferences[0]!.enabled = false;
  settings.builtinPresetPreferences[0]!.sortOrder = 99;

  const fresh = normalizeSettings(undefined);
  assert.equal(fresh.builtinPresetPreferences[0]!.enabled, true);
  assert.equal(fresh.builtinPresetPreferences[0]!.sortOrder, 0);
});

test("normalizeSettings enables chat runtime details by default and preserves explicit opt-out", () => {
  assert.equal(normalizeSettings(undefined).showChatRuntimeDetails, true);
  assert.equal(normalizeSettings({ showChatRuntimeDetails: false }).showChatRuntimeDetails, false);
});

test("normalizeSettings provides default credential env keys for Gemini and Anthropic", () => {
  const settings = normalizeSettings(undefined);
  assert.equal(settings.geminiApiKeyEnvKey, "GEMINI_API_KEY");
  assert.equal(settings.anthropicApiKeyEnvKey, "ANTHROPIC_API_KEY");
  assert.equal(settings.geminiApiKey, "");
  assert.equal(settings.anthropicApiKey, "");
});
