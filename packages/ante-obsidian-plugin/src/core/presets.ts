import type { PresetSettings } from "./preset-config";
import type { PresetDefinition, PresetId } from "./types";

export const DEFAULT_PRESET_ID: PresetId = "default";

export const BUILTIN_PRESETS: Record<PresetId, PresetDefinition> = {
  default: {
    id: "default",
    label: "@ante",
    goal: "Handle the current Markdown content directly and choose the lightest useful operation.",
    systemInstructions:
      "Prefer a direct document edit when the requested outcome is concrete. Keep Markdown structure clean and preserve intent.",
    source: "builtin",
    enabled: true,
    sortOrder: 0,
    interactionMode: "inline"
  },
  research: {
    id: "research",
    label: "@ante research",
    goal: "Expand the current topic into a research-oriented Markdown block.",
    systemInstructions:
      "Structure the output as: Questions, Background, Key Insights, Risks or Counterexamples, Follow-up Questions. Prefer appending to the document unless the user clearly asked for another operation.",
    source: "builtin",
    enabled: true,
    sortOrder: 1,
    interactionMode: "inline"
  },
  plan: {
    id: "plan",
    label: "@ante plan",
    goal: "Turn the current idea into an actionable plan block.",
    systemInstructions:
      "Structure the output as: Objectives, Prerequisites, Steps, Acceptance Criteria, Risks and Open Questions. Prefer appending to the document unless the user clearly asked for another operation.",
    source: "builtin",
    enabled: true,
    sortOrder: 2,
    interactionMode: "inline"
  },
  summary: {
    id: "summary",
    label: "@ante summary",
    goal: "Summarize the selected Markdown content into a concise, useful block.",
    systemInstructions:
      "Structure the output as: Summary, Key Points, Next Steps. Prefer appending to the document unless the user clearly asked for another operation.",
    source: "builtin",
    enabled: true,
    sortOrder: 3,
    interactionMode: "inline"
  }
};

export const listBuiltinPresets = (): PresetDefinition[] => Object.values(BUILTIN_PRESETS);

export const listResolvedPresets = (settings: PresetSettings): PresetDefinition[] => {
  const builtinPreferences = new Map(settings.builtinPresetPreferences.map((preset) => [preset.id, preset]));
  const builtin = listBuiltinPresets().map((preset, index) => {
    const preference = builtinPreferences.get(preset.id);
    return {
      ...preset,
      enabled: preference?.enabled ?? true,
      sortOrder: preference?.sortOrder ?? index
    };
  });

  const custom = settings.customPresets.map((preset, index) => ({
    id: preset.id,
    label: preset.name,
    goal: `Execute the custom preset "${preset.name}" on the current Markdown context.`,
    systemInstructions: preset.instruction.trim(),
    source: "custom" as const,
    enabled: preset.enabled,
    sortOrder: typeof preset.sortOrder === "number" ? preset.sortOrder : builtin.length + index,
    interactionMode: preset.interactionMode ?? "inline"
  }));

  return [...builtin, ...custom].sort((left, right) => {
    const sortDiff = (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
    if (sortDiff !== 0) {
      return sortDiff;
    }
    return left.label.localeCompare(right.label);
  });
};

export const getResolvedPreset = (settings: PresetSettings, presetId: PresetId): PresetDefinition => {
  const preset = listResolvedPresets(settings).find((entry) => entry.id === presetId);
  if (!preset) {
    throw new Error(`Unknown preset: ${presetId}`);
  }
  return preset;
};
