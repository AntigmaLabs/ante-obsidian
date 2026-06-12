import { resolveAnteThinkingPreference, type AnteThinkingLevel } from "../core/ante-thinking";
import { OBSIDIAN_APPEND_SYSTEM_PROMPT } from "../core/obsidian-system-prompt";
import { DEFAULT_ANTE_ARGS_JSON } from "../runtime/create-ante-runtime";
import { normalizeEnvVarName } from "./shell-env";
import type { TmdSettings } from "./settings";
import type { AnteCatalogProvider } from "./ante-catalog";
import type { AnteDefaults } from "./ante-defaults";

export interface AnteRuntimeConfigInput {
  settings: Pick<
    TmdSettings,
    "connectionMode" | "wsAddress" | "autoApproveAnteTools" | "anteThinking" | "providerKeys"
  >;
  resolvedTarget: AnteDefaults;
  shellEnv: Record<string, string>;
  /** API-key providers from the Ante catalog whose credentials should be forwarded. */
  apiKeyProviders: AnteCatalogProvider[];
  processEnv?: NodeJS.ProcessEnv;
}

export const buildAnteRuntimeConfig = (
  input: AnteRuntimeConfigInput,
): {
  connectionMode: TmdSettings["connectionMode"];
  command: string;
  argsJson: string;
  cwd: string;
  wsAddress: string;
  model: string;
  provider: string;
  thinking: AnteThinkingLevel | null;
  autoApproveTools: boolean;
  env: Record<string, string>;
  appendSystemPrompt: string;
} => {
  const env: Record<string, string> = {
    ANTE_ENV: "obsidian",
  };
  const processEnv = input.processEnv ?? process.env;

  // Populate credentials for all known API-key providers
  const providerKeys = input.settings.providerKeys ?? {};
  const legacySettings = input.settings as unknown as Record<string, unknown>;
  const getLegacyString = (key: string): string => {
    const value = legacySettings[key];
    return typeof value === "string" ? value : "";
  };

  for (const provider of input.apiKeyProviders) {
    if (provider.authType !== "api-key") {
      continue;
    }

    const providerId = provider.id;
    const keyConfig = providerKeys[providerId];

    // Determine the environment variable name to use
    let envKey: string | undefined = keyConfig?.envKey;
    if (!envKey) {
      if (providerId === "gemini") {
        envKey = getLegacyString("geminiApiKeyEnvKey") || provider.envKey;
      } else if (providerId === "anthropic") {
        envKey = getLegacyString("anthropicApiKeyEnvKey") || provider.envKey;
      } else {
        envKey = provider.envKey;
      }
    }
    const normalizedKey = envKey ? normalizeEnvVarName(envKey) : "";
    if (!normalizedKey) {
      continue;
    }

    // Determine the API key value
    let apiKey = keyConfig?.apiKey ?? "";
    if (!apiKey) {
      if (providerId === "gemini") {
        apiKey = getLegacyString("geminiApiKey");
      } else if (providerId === "anthropic") {
        apiKey = getLegacyString("anthropicApiKey");
      }
    }

    const trimmedKey = apiKey.trim();
    const resolvedValue =
      trimmedKey ||
      (input.shellEnv[normalizedKey]?.trim() ?? "") ||
      (processEnv[normalizedKey]?.trim() ?? "");

    if (resolvedValue) {
      env[normalizedKey] = resolvedValue;
    }
  }

  return {
    connectionMode: "stdio",
    command: "ante",
    argsJson: DEFAULT_ANTE_ARGS_JSON,
    cwd: "",
    wsAddress: input.settings.wsAddress,
    model: input.resolvedTarget.model,
    provider: input.resolvedTarget.provider,
    thinking: resolveAnteThinkingPreference(input.settings.anteThinking),
    autoApproveTools: input.settings.autoApproveAnteTools,
    env,
    appendSystemPrompt: OBSIDIAN_APPEND_SYSTEM_PROMPT,
  };
};
