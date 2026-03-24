import type { PresetDefinition, PresetId } from "./types";

export const DEFAULT_PRESET_ID: PresetId = "default";

export const BUILTIN_PRESETS: Record<PresetId, PresetDefinition> = {
  default: {
    id: "default",
    label: "@ante",
    goal: "Handle the current Markdown content directly and choose the lightest useful operation.",
    systemInstructions:
      "Prefer a direct document edit when the requested outcome is concrete. Keep Markdown structure clean and preserve intent."
  },
  research: {
    id: "research",
    label: "@ante research",
    goal: "Expand the current topic into a research-oriented Markdown block.",
    systemInstructions:
      "Structure the output as: 问题, 背景, 关键观点, 风险或反例, 后续问题. Prefer append-block unless the user clearly asked for another operation."
  },
  plan: {
    id: "plan",
    label: "@ante plan",
    goal: "Turn the current idea into an actionable plan block.",
    systemInstructions:
      "Structure the output as: 目标, 前置条件, 步骤, 验收标准, 风险与待确认项. Prefer append-block unless the user clearly asked for another operation."
  },
  summary: {
    id: "summary",
    label: "@ante summary",
    goal: "Summarize the selected Markdown content into a concise, useful block.",
    systemInstructions:
      "Structure the output as: 摘要, 关键点, 待跟进项. Prefer append-block unless the user clearly asked for another operation."
  }
};

export const getPreset = (presetId: PresetId): PresetDefinition => BUILTIN_PRESETS[presetId];

export const listPresets = (): PresetDefinition[] => Object.values(BUILTIN_PRESETS);
