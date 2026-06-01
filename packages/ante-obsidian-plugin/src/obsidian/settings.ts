import type { BuiltinPresetPreference, CustomPresetConfig, PresetSettings } from "../core/preset-config";
import {
  ANTE_DEFAULT_THINKING,
  normalizeAnteThinkingPreference,
  type AnteThinkingPreference
} from "../core/ante-thinking";

// ─── Provider metadata ─────────────────────────────────────────────────────

export interface ProviderMeta {
  id: string;
  label: string;
  /** "api-key" = requires API key env var; "oauth" = interactive OAuth; "none" = no auth (local) */
  authType: "api-key" | "oauth" | "none";
  /** Default environment variable name ante reads for this provider's key */
  defaultEnvKey?: string;
  /** Placeholder hint shown in the API key input */
  keyPlaceholder?: string;
  /** Fallback static model list when ante warming hasn't completed or is unavailable */
  defaultModels?: readonly string[];
}

/**
 * Full list of built-in providers from the Ante catalog reference.
 * Includes OAuth providers so the chat picker can still reference them.
 * https://docs.antigma.ai/reference/catalog-reference#built-in-providers
 */
export const AVAILABLE_PROVIDERS: readonly ProviderMeta[] = [
  // ── OAuth / subscription (chat picker only, excluded from settings override) ──
  {
    id: "openai-subscription",
    label: "OpenAI Subscription",
    authType: "oauth",
    defaultModels: ["gpt-5.4", "gpt-5.4-pro", "gpt-5.5"]
  },
  {
    id: "anthropic-subscription",
    label: "Anthropic Subscription",
    authType: "oauth",
    defaultModels: ["claude-sonnet-4-6", "claude-opus-4.6", "claude-haiku-4-5"]
  },
  {
    id: "antix",
    label: "Antix",
    authType: "oauth",
    defaultModels: [
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "claude-sonnet-4-6",
      "claude-opus-4.6",
      "claude-haiku-4-5",
      "gpt-5.4",
      "gpt-5.4-pro",
      "gpt-5.5",
      "gemini-3.5-flash",
      "gemini-3.5-pro",
      "qwen3.5-flash"
    ]
  },

  // ── API-key providers ──
  {
    id: "openai",
    label: "OpenAI",
    authType: "api-key",
    defaultEnvKey: "OPENAI_API_KEY",
    keyPlaceholder: "sk-...",
    defaultModels: ["gpt-5.4", "gpt-5.4-pro", "gpt-5.5"]
  },
  {
    id: "openai-compatible",
    label: "OpenAI Compatible",
    authType: "api-key",
    defaultEnvKey: "OPENAI_COMPATIBLE_API_KEY",
    keyPlaceholder: "sk-...",
    defaultModels: ["custom-model-1", "custom-model-2"]
  },
  {
    id: "gemini",
    label: "Gemini",
    authType: "api-key",
    defaultEnvKey: "GEMINI_API_KEY",
    keyPlaceholder: "AIza...",
    defaultModels: ["gemini-3.5-flash", "gemini-3.5-pro", "gemini-3-flash-preview"]
  },
  {
    id: "vertex-gemini",
    label: "Vertex Gemini",
    authType: "api-key",
    defaultEnvKey: "VERTEX_GEMINI_API_KEY",
    keyPlaceholder: "",
    defaultModels: ["gemini-3.5-pro", "gemini-3.5-flash"]
  },
  {
    id: "anthropic",
    label: "Anthropic",
    authType: "api-key",
    defaultEnvKey: "ANTHROPIC_API_KEY",
    keyPlaceholder: "sk-ant-...",
    defaultModels: ["claude-sonnet-4-6", "claude-opus-4.6", "claude-haiku-4-5"]
  },
  {
    id: "antix-api-key",
    label: "Antix API Key",
    authType: "api-key",
    defaultEnvKey: "ANTIX_API_KEY",
    keyPlaceholder: "",
    defaultModels: [
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "claude-sonnet-4-6",
      "claude-opus-4.6",
      "claude-haiku-4-5",
      "gpt-5.4",
      "gpt-5.4-pro",
      "gpt-5.5",
      "gemini-3.5-flash",
      "gemini-3.5-pro",
      "qwen3.5-flash"
    ]
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    authType: "api-key",
    defaultEnvKey: "DEEPSEEK_API_KEY",
    keyPlaceholder: "sk-...",
    defaultModels: ["deepseek-v4-pro", "deepseek-v4-flash"]
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    authType: "api-key",
    defaultEnvKey: "OPENROUTER_API_KEY",
    keyPlaceholder: "sk-or-...",
    defaultModels: [
      "anthropic/claude-sonnet-4-6",
      "anthropic/claude-opus-4.6",
      "google/gemini-3.1-pro-preview",
      "openai/gpt-5.4-pro",
      "deepseek/deepseek-v4-pro",
      "deepseek/deepseek-v4-flash"
    ]
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    authType: "api-key",
    defaultEnvKey: "XAI_API_KEY",
    keyPlaceholder: "xai-...",
    defaultModels: ["grok-3-preview", "grok-3-pro"]
  },
  {
    id: "zai",
    label: "Zai",
    authType: "api-key",
    defaultEnvKey: "Z_AI_API_KEY",
    keyPlaceholder: "",
    defaultModels: ["z1-flash", "z1-pro"]
  },
  {
    id: "ali-coding-plan",
    label: "Ali Coding Plan",
    authType: "api-key",
    defaultEnvKey: "ALI_CODING_PLAN_API_KEY",
    keyPlaceholder: "sk-sp-...",
    defaultModels: ["qwen3.5-flash", "qwen3.5-pro"]
  },

  // ── No auth (local inference) ──
  {
    id: "local",
    label: "Local (llama.cpp)",
    authType: "none",
    defaultModels: ["local-model"]
  },
] as const;

/**
 * Subset used by the settings "Provider override" dropdown.
 * Excludes OAuth providers since they authenticate interactively via the Ante TUI,
 * not via an API key that the plugin can inject.
 */
export const OVERRIDE_PROVIDERS: readonly ProviderMeta[] = AVAILABLE_PROVIDERS.filter(
  (p) => p.authType !== "oauth"
);

/** Loose provider type — any valid provider id string. */
export type AnteProvider = string;

/** Legacy named constants kept for backward compatibility. */
export const OPENAI_PROVIDER = "openai-subscription";
export const GEMINI_PROVIDER = "gemini";
export const ANTHROPIC_PROVIDER = "anthropic";
export const ANTIX_PROVIDER = "antix";

export type AnteConnectionMode = "stdio" | "websocket";

export const DEFAULT_ANTE_MODEL = "gpt-5.4";

/**
 * Normalize a raw provider string to a known provider id.
 * Falls back to "openai-subscription" so legacy data stays valid.
 */
export const normalizeProvider = (provider: string): AnteProvider => {
  const trimmed = provider?.trim();
  if (AVAILABLE_PROVIDERS.some((p) => p.id === trimmed)) {
    return trimmed;
  }
  return OPENAI_PROVIDER;
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
