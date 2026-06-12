import type { AnteThinkingLevel } from "../core/ante-thinking";

export interface AnteRuntimeConfig {
  connectionMode: "stdio" | "websocket";
  command: string;
  argsJson: string;
  cwd: string;
  wsAddress: string;
  model: string;
  provider: string;
  thinking: AnteThinkingLevel | null;
  autoApproveTools: boolean;
  env: Record<string, string>;
  appendSystemPrompt?: string;
}

export const configSignature = (config: AnteRuntimeConfig): string =>
  JSON.stringify({
    connectionMode: config.connectionMode,
    command: config.command.trim(),
    argsJson: config.argsJson.trim(),
    cwd: config.cwd.trim(),
    wsAddress: config.wsAddress.trim(),
    model: config.model.trim(),
    provider: config.provider.trim(),
    thinking: config.thinking,
    appendSystemPrompt: config.appendSystemPrompt?.trim() ?? "",
    env: Object.entries(config.env)
      .filter(([, value]) => value.trim())
      .sort(([left], [right]) => left.localeCompare(right)),
  });

export const sessionTargetSignature = (
  config: Pick<AnteRuntimeConfig, "model" | "provider" | "thinking">,
): string =>
  JSON.stringify({
    model: config.model.trim(),
    provider: config.provider.trim(),
    thinking: config.thinking,
  });
