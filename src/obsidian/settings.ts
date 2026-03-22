export const OPENAI_PROVIDER = "openai-subscription";
export const GEMINI_PROVIDER = "gemini";
export const ANTHROPIC_PROVIDER = "anthropic";
export type AnteProvider = typeof OPENAI_PROVIDER | typeof GEMINI_PROVIDER | typeof ANTHROPIC_PROVIDER;

export const PROVIDER_MODELS: Record<AnteProvider, readonly string[]> = {
  [OPENAI_PROVIDER]: ["gpt-5.4", "gpt-5.3-codex", "gpt-5.4-pro", "gpt-5-mini", "gpt-5-nano"],
  [GEMINI_PROVIDER]: ["gemini-3-flash-preview", "gemini-3.1-pro-preview"],
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

export interface TmdSettings {
  command: string;
  argsJson: string;
  cwd: string;
  useAnteDefaults: boolean;
  anteModel: string;
  anteProvider: AnteProvider;
  autoApproveAnteTools: boolean;
  geminiApiKey: string;
  geminiApiKeyEnvKey: string;
  mentionTriggerDebug: boolean;
}

export const DEFAULT_SETTINGS: TmdSettings = {
  command: "ante",
  argsJson: JSON.stringify(["serve", "--stdio", "--yolo"]),
  cwd: "",
  useAnteDefaults: true,
  anteModel: getDefaultModelForProvider(OPENAI_PROVIDER),
  anteProvider: OPENAI_PROVIDER,
  autoApproveAnteTools: true,
  geminiApiKey: "",
  geminiApiKeyEnvKey: "GEMINI_API_KEY",
  mentionTriggerDebug: false
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
    command: typeof raw.command === "string" ? raw.command : DEFAULT_SETTINGS.command,
    argsJson: typeof raw.argsJson === "string" ? raw.argsJson : DEFAULT_SETTINGS.argsJson,
    cwd: typeof raw.cwd === "string" ? raw.cwd : DEFAULT_SETTINGS.cwd,
    useAnteDefaults: raw.useAnteDefaults !== false,
    anteModel,
    anteProvider,
    autoApproveAnteTools: raw.autoApproveAnteTools !== false,
    geminiApiKey: typeof raw.geminiApiKey === "string" ? raw.geminiApiKey : DEFAULT_SETTINGS.geminiApiKey,
    geminiApiKeyEnvKey:
      typeof raw.geminiApiKeyEnvKey === "string" && raw.geminiApiKeyEnvKey.trim()
        ? raw.geminiApiKeyEnvKey.trim()
        : DEFAULT_SETTINGS.geminiApiKeyEnvKey,
    mentionTriggerDebug: raw.mentionTriggerDebug === true
  };
};
