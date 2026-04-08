import type { BuiltinPresetPreference, CustomPresetConfig, PresetSettings } from "../core/preset-config";

export const OPENAI_PROVIDER = "openai-subscription";
export const GEMINI_PROVIDER = "gemini";
export const ANTHROPIC_PROVIDER = "anthropic";
export type AnteProvider = typeof OPENAI_PROVIDER | typeof GEMINI_PROVIDER | typeof ANTHROPIC_PROVIDER;
export type AnteConnectionMode = "stdio" | "websocket";

export const PROVIDER_MODELS: Record<AnteProvider, readonly string[]> = {
  [OPENAI_PROVIDER]: ["gpt-5.1-codex", "gpt-5.3-codex", "gpt-5.4"],
  [GEMINI_PROVIDER]: ["gemini-3-flash-preview", "gemini-3-pro-preview", "gemini-3.1-pro-preview"],
  [ANTHROPIC_PROVIDER]: ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-6"]
};

export const getDefaultModelForProvider = (provider: AnteProvider): string =>
  provider === GEMINI_PROVIDER ? "gemini-3-flash-preview" : provider === ANTHROPIC_PROVIDER ? "claude-sonnet-4-5" : "gpt-5.4";

export const normalizeProvider = (provider: string): AnteProvider =>
  provider === GEMINI_PROVIDER
    ? GEMINI_PROVIDER
    : provider === ANTHROPIC_PROVIDER
      ? ANTHROPIC_PROVIDER
      : OPENAI_PROVIDER;

export interface TmdSettings extends PresetSettings {
  connectionMode: AnteConnectionMode;
  wsAddress: string;
  useAnteDefaults: boolean;
  allowObsidianCli: boolean;
  anteModel: string;
  anteProvider: AnteProvider;
  autoApproveAnteTools: boolean;
  showFullProcessLogs: boolean;
  showChatRuntimeDetails: boolean;
  geminiApiKey: string;
  geminiApiKeyEnvKey: string;
  anthropicApiKey: string;
  anthropicApiKeyEnvKey: string;
  mentionTriggerDebug: boolean;
}

export const DEFAULT_SETTINGS: TmdSettings = {
  connectionMode: "stdio",
  wsAddress: "127.0.0.1:8765",
  useAnteDefaults: true,
  allowObsidianCli: true,
  anteModel: getDefaultModelForProvider(OPENAI_PROVIDER),
  anteProvider: OPENAI_PROVIDER,
  autoApproveAnteTools: true,
  showFullProcessLogs: false,
  showChatRuntimeDetails: true,
  geminiApiKey: "",
  geminiApiKeyEnvKey: "GEMINI_API_KEY",
  anthropicApiKey: "",
  anthropicApiKeyEnvKey: "ANTHROPIC_API_KEY",
  mentionTriggerDebug: false,
  customPresets: [],
  builtinPresetPreferences: [
    { id: "default", enabled: true, sortOrder: 0 },
    { id: "research", enabled: true, sortOrder: 1 },
    { id: "plan", enabled: true, sortOrder: 2 },
    { id: "summary", enabled: true, sortOrder: 3 }
  ]
};

const normalizeCustomPresets = (raw: unknown): CustomPresetConfig[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  const presets: CustomPresetConfig[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const value = entry as Record<string, unknown>;
    const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : `custom-${crypto.randomUUID()}`;
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const instruction = typeof value.instruction === "string" ? value.instruction : "";
    if (!name || !instruction.trim()) {
      continue;
    }

    presets.push({
      id,
      name,
      instruction,
      enabled: value.enabled !== false,
      sortOrder:
        typeof value.sortOrder === "number"
          ? value.sortOrder
          : DEFAULT_SETTINGS.builtinPresetPreferences.length + index,
      interactionMode: value.interactionMode === "panel" ? "panel" : "inline"
    });
  }

  return presets.sort((left, right) => left.sortOrder - right.sortOrder);
};

const normalizeBuiltinPresetPreferences = (raw: unknown): BuiltinPresetPreference[] => {
  const defaults = DEFAULT_SETTINGS.builtinPresetPreferences.map((preset) => ({ ...preset }));
  if (!Array.isArray(raw)) {
    return defaults;
  }

  const byId = new Map<string, BuiltinPresetPreference>();
  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const value = entry as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id.trim() : "";
    if (!id) {
      continue;
    }
    byId.set(id, {
      id,
      enabled: value.enabled !== false,
      sortOrder: typeof value.sortOrder === "number" ? value.sortOrder : index
    });
  }

  const merged = defaults
    .map((preset, index) => byId.get(preset.id) ?? { ...preset, sortOrder: index })
    .sort((left, right) => left.sortOrder - right.sortOrder);

  return merged;
};

export const normalizeSettings = (stored: Partial<TmdSettings> | null | undefined): TmdSettings => {
  const raw = stored ?? {};
  const anteProvider = normalizeProvider(typeof raw.anteProvider === "string" ? raw.anteProvider : DEFAULT_SETTINGS.anteProvider);
  const providerModels = PROVIDER_MODELS[anteProvider];
  const requestedModel = typeof raw.anteModel === "string" ? raw.anteModel.trim() : "";
  const anteModel = providerModels.includes(requestedModel as (typeof providerModels)[number])
    ? requestedModel
    : getDefaultModelForProvider(anteProvider);

  return {
    connectionMode: "stdio",
    wsAddress:
      typeof raw.wsAddress === "string" && raw.wsAddress.trim()
        ? raw.wsAddress.trim()
        : DEFAULT_SETTINGS.wsAddress,
    useAnteDefaults: raw.useAnteDefaults !== false,
    allowObsidianCli: raw.allowObsidianCli !== false,
    anteModel,
    anteProvider,
    autoApproveAnteTools: raw.autoApproveAnteTools !== false,
    showFullProcessLogs: raw.showFullProcessLogs === true,
    showChatRuntimeDetails: raw.showChatRuntimeDetails !== false,
    geminiApiKey: typeof raw.geminiApiKey === "string" ? raw.geminiApiKey : DEFAULT_SETTINGS.geminiApiKey,
    geminiApiKeyEnvKey:
      typeof raw.geminiApiKeyEnvKey === "string" && raw.geminiApiKeyEnvKey.trim()
        ? raw.geminiApiKeyEnvKey.trim()
        : DEFAULT_SETTINGS.geminiApiKeyEnvKey,
    anthropicApiKey: typeof raw.anthropicApiKey === "string" ? raw.anthropicApiKey : DEFAULT_SETTINGS.anthropicApiKey,
    anthropicApiKeyEnvKey:
      typeof raw.anthropicApiKeyEnvKey === "string" && raw.anthropicApiKeyEnvKey.trim()
        ? raw.anthropicApiKeyEnvKey.trim()
        : DEFAULT_SETTINGS.anthropicApiKeyEnvKey,
    mentionTriggerDebug: raw.mentionTriggerDebug === true,
    customPresets: normalizeCustomPresets(raw.customPresets),
    builtinPresetPreferences: normalizeBuiltinPresetPreferences(raw.builtinPresetPreferences)
  };
};
