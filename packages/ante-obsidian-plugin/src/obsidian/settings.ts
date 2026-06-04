import type { BuiltinPresetPreference, CustomPresetConfig, PresetSettings } from "../core/preset-config";
import {
  ANTE_DEFAULT_THINKING,
  normalizeAnteThinkingPreference,
  type AnteThinkingPreference
} from "../core/ante-thinking";

// ─── Provider metadata ─────────────────────────────────────────────────────
//
// The provider/model catalog is no longer hand-maintained here. It is read at
// runtime from the Ante CLI via `ante catalog` (see `ante-catalog.ts`), which
// is the authoritative source for providers, their auth config, and the models
// each one serves. The plugin keeps only loose types and defaults below.

/** Loose provider type — any valid provider id string. */
export type AnteProvider = string;

export type AnteConnectionMode = "stdio" | "websocket";

/** Fallback model used only when no catalog model is resolvable. */
export const DEFAULT_ANTE_MODEL = "gemini-3.5-flash";

/** Default provider id used when stored settings have no usable value. */
export const DEFAULT_ANTE_PROVIDER = "gemini";

export const MISSING_CATALOG_WARNING_TEXT = "⚠️ No provider catalog: run the 'ante' command once, or update Ante (the 'ante catalog' command requires a newer version), then reopen settings.";

export const getMissingCatalogNoticeText = (sourceLabel: string): string =>
  `${sourceLabel} requires a newer Ante CLI version. Please update Ante in Settings > Runtime to populate the provider catalog.`;

/**
 * Normalize a raw provider string. Provider *validity* is now checked against
 * the live catalog at the call sites that have it (the chat picker and settings
 * dropdown only offer catalog providers); here we just trim and fall back to a
 * sane default so legacy/empty stored data stays usable.
 */
export const normalizeProvider = (provider: string): AnteProvider => {
  const trimmed = provider?.trim();
  return trimmed || DEFAULT_ANTE_PROVIDER;
};

// ─── Per-provider key configuration ───────────────────────────────────────

export interface ProviderKeyConfig {
  /** Environment variable name ante reads for this provider's API key */
  envKey: string;
  /** API key entered directly in the plugin (overrides the env var) */
  apiKey: string;
}

// ─── Settings interface ────────────────────────────────────────────────────

export interface TmdSettings extends PresetSettings {
  connectionMode: AnteConnectionMode;
  wsAddress: string;
  useAnteDefaults: boolean;
  allowObsidianCli: boolean;
  anteModel: string;
  anteThinking: AnteThinkingPreference;
  anteProvider: AnteProvider;
  autoApproveAnteTools: boolean;
  showFullProcessLogs: boolean;
  showChatRuntimeDetails: boolean;
  /** Per-provider API key configuration (keyed by provider id) */
  providerKeys: Record<string, ProviderKeyConfig>;
  /** Per-provider custom models configured by the user (keyed by provider id) */
  customModels: Record<string, string[]>;
  /** Last model selected in chat for each provider (keyed by provider id) */
  lastSelectedModelsByProvider: Record<string, string>;
  /** @deprecated Use providerKeys["gemini"] instead. Kept for migration. */
  geminiApiKey: string;
  /** @deprecated Use providerKeys["gemini"].envKey instead. Kept for migration. */
  geminiApiKeyEnvKey: string;
  /** @deprecated Use providerKeys["anthropic"] instead. Kept for migration. */
  anthropicApiKey: string;
  /** @deprecated Use providerKeys["anthropic"].envKey instead. Kept for migration. */
  anthropicApiKeyEnvKey: string;
  mentionTriggerDebug: boolean;
}

export const DEFAULT_SETTINGS: TmdSettings = {
  connectionMode: "stdio",
  wsAddress: "127.0.0.1:8765",
  useAnteDefaults: false,
  allowObsidianCli: true,
  anteModel: "gemini-3.5-flash",
  anteThinking: ANTE_DEFAULT_THINKING,
  anteProvider: "gemini",
  autoApproveAnteTools: true,
  showFullProcessLogs: false,
  showChatRuntimeDetails: true,
  providerKeys: {},
  customModels: {},
  lastSelectedModelsByProvider: {},
  geminiApiKey: "",
  geminiApiKeyEnvKey: "GEMINI_API_KEY",
  anthropicApiKey: "",
  anthropicApiKeyEnvKey: "ANTHROPIC_API_KEY",
  mentionTriggerDebug: false,
  customPresets: [],
  builtinPresetPreferences: [
    { id: "default",  enabled: true, sortOrder: 0 },
    { id: "research", enabled: true, sortOrder: 1 },
    { id: "plan",     enabled: true, sortOrder: 2 },
    { id: "summary",  enabled: true, sortOrder: 3 }
  ]
};

// ─── Normalization helpers ─────────────────────────────────────────────────

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

const normalizeProviderKeys = (
  raw: unknown,
  legacyGeminiKey: string,
  legacyGeminiEnvKey: string,
  legacyAnthropicKey: string,
  legacyAnthropicEnvKey: string
): Record<string, ProviderKeyConfig> => {
  const result: Record<string, ProviderKeyConfig> = {};

  // Parse stored providerKeys map (if present)
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [providerId, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const cfg = entry as Record<string, unknown>;
      const envKey = typeof cfg.envKey === "string" ? cfg.envKey.trim() : "";
      const apiKey = typeof cfg.apiKey === "string" ? cfg.apiKey : "";
      if (envKey) {
        result[providerId] = { envKey, apiKey };
      }
    }
  }

  // Migrate legacy gemini fields if not already present in providerKeys
  if (!result["gemini"] && (legacyGeminiKey || legacyGeminiEnvKey)) {
    result["gemini"] = {
      envKey: legacyGeminiEnvKey || "GEMINI_API_KEY",
      apiKey: legacyGeminiKey,
    };
  }

  // Migrate legacy anthropic fields if not already present in providerKeys
  if (!result["anthropic"] && (legacyAnthropicKey || legacyAnthropicEnvKey)) {
    result["anthropic"] = {
      envKey: legacyAnthropicEnvKey || "ANTHROPIC_API_KEY",
      apiKey: legacyAnthropicKey,
    };
  }

  return result;
};

const normalizeCustomModels = (raw: unknown): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [providerId, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(entry)) {
        result[providerId] = entry
          .map((m) => (typeof m === "string" ? m.trim() : ""))
          .filter(Boolean);
      }
    }
  }
  return result;
};

const normalizeLastSelectedModelsByProvider = (raw: unknown): Record<string, string> => {
  const result: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [providerId, entry] of Object.entries(raw as Record<string, unknown>)) {
      const provider = providerId.trim();
      const model = typeof entry === "string" ? entry.trim() : "";
      if (provider && model) {
        result[provider] = model;
      }
    }
  }
  return result;
};

export const normalizeSettings = (stored: Partial<TmdSettings> | null | undefined): TmdSettings => {
  const raw = stored ?? {};
  const anteProvider = normalizeProvider(typeof raw.anteProvider === "string" ? raw.anteProvider : DEFAULT_SETTINGS.anteProvider);
  const anteModel = typeof raw.anteModel === "string" ? raw.anteModel.trim() : DEFAULT_SETTINGS.anteModel;
  const anteThinking = normalizeAnteThinkingPreference(raw.anteThinking);

  // Legacy flat fields (for migration)
  const legacyGeminiKey = typeof raw.geminiApiKey === "string" ? raw.geminiApiKey : "";
  const legacyGeminiEnvKey = typeof raw.geminiApiKeyEnvKey === "string" && raw.geminiApiKeyEnvKey.trim()
    ? raw.geminiApiKeyEnvKey.trim()
    : "GEMINI_API_KEY";
  const legacyAnthropicKey = typeof raw.anthropicApiKey === "string" ? raw.anthropicApiKey : "";
  const legacyAnthropicEnvKey = typeof raw.anthropicApiKeyEnvKey === "string" && raw.anthropicApiKeyEnvKey.trim()
    ? raw.anthropicApiKeyEnvKey.trim()
    : "ANTHROPIC_API_KEY";

  const providerKeys = normalizeProviderKeys(
    raw.providerKeys,
    legacyGeminiKey,
    legacyGeminiEnvKey,
    legacyAnthropicKey,
    legacyAnthropicEnvKey
  );

  const customModels = normalizeCustomModels(raw.customModels);
  const lastSelectedModelsByProvider = normalizeLastSelectedModelsByProvider(raw.lastSelectedModelsByProvider);

  return {
    connectionMode: "stdio",
    wsAddress:
      typeof raw.wsAddress === "string" && raw.wsAddress.trim()
        ? raw.wsAddress.trim()
        : DEFAULT_SETTINGS.wsAddress,
    useAnteDefaults: raw.useAnteDefaults !== false,
    allowObsidianCli: raw.allowObsidianCli !== false,
    anteModel,
    anteThinking,
    anteProvider,
    autoApproveAnteTools: raw.autoApproveAnteTools !== false,
    showFullProcessLogs: raw.showFullProcessLogs === true,
    showChatRuntimeDetails: raw.showChatRuntimeDetails !== false,
    providerKeys,
    customModels,
    lastSelectedModelsByProvider,
    // Keep legacy fields populated from migration result for backward compat
    geminiApiKey: providerKeys["gemini"]?.apiKey ?? legacyGeminiKey,
    geminiApiKeyEnvKey: providerKeys["gemini"]?.envKey ?? legacyGeminiEnvKey,
    anthropicApiKey: providerKeys["anthropic"]?.apiKey ?? legacyAnthropicKey,
    anthropicApiKeyEnvKey: providerKeys["anthropic"]?.envKey ?? legacyAnthropicEnvKey,
    mentionTriggerDebug: raw.mentionTriggerDebug === true,
    customPresets: normalizeCustomPresets(raw.customPresets),
    builtinPresetPreferences: normalizeBuiltinPresetPreferences(raw.builtinPresetPreferences)
  };
};
