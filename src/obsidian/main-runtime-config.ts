import { DEFAULT_ANTE_ARGS_JSON } from "../runtime/create-ante-runtime"
import { normalizeEnvVarName } from "./shell-env"
import type { TmdSettings } from "./settings"
import type { AnteDefaults } from "./ante-defaults"

export interface AnteRuntimeConfigInput {
  settings: Pick<
    TmdSettings,
    | "connectionMode"
    | "wsAddress"
    | "autoApproveAnteTools"
    | "geminiApiKeyEnvKey"
    | "geminiApiKey"
    | "anthropicApiKeyEnvKey"
    | "anthropicApiKey"
  >
  resolvedTarget: AnteDefaults
  shellEnv: Record<string, string>
  processEnv?: NodeJS.ProcessEnv
}

export const buildAnteRuntimeConfig = (
  input: AnteRuntimeConfigInput
): {
  connectionMode: TmdSettings["connectionMode"]
  command: string
  argsJson: string
  cwd: string
  wsAddress: string
  model: string
  provider: string
  autoApproveTools: boolean
  env: Record<string, string>
} => {
  const geminiEnvKey = normalizeEnvVarName(input.settings.geminiApiKeyEnvKey)
  const anthropicEnvKey = normalizeEnvVarName(input.settings.anthropicApiKeyEnvKey)
  const processEnv = input.processEnv ?? process.env
  const geminiApiKey =
    input.settings.geminiApiKey.trim() ||
    (geminiEnvKey ? input.shellEnv[geminiEnvKey]?.trim() ?? "" : "") ||
    (geminiEnvKey ? processEnv[geminiEnvKey]?.trim() ?? "" : "")
  const anthropicApiKey =
    input.settings.anthropicApiKey.trim() ||
    (anthropicEnvKey ? input.shellEnv[anthropicEnvKey]?.trim() ?? "" : "") ||
    (anthropicEnvKey ? processEnv[anthropicEnvKey]?.trim() ?? "" : "")

  return {
    connectionMode: "stdio",
    command: "ante",
    argsJson: DEFAULT_ANTE_ARGS_JSON,
    cwd: "",
    wsAddress: input.settings.wsAddress,
    model: input.resolvedTarget.model,
    provider: input.resolvedTarget.provider,
    autoApproveTools: input.settings.autoApproveAnteTools,
    env: {
      ...(geminiEnvKey && geminiApiKey ? { [geminiEnvKey]: geminiApiKey } : {}),
      ...(anthropicEnvKey && anthropicApiKey
        ? { [anthropicEnvKey]: anthropicApiKey }
        : {}),
    }
  }
}
