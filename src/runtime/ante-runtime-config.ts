export interface AnteRuntimeConfig {
  connectionMode: "stdio" | "websocket";
  command: string;
  argsJson: string;
  cwd: string;
  wsAddress: string;
  model: string;
  provider: string;
  autoApproveTools: boolean;
  env: Record<string, string>;
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
    env: Object.entries(config.env)
      .filter(([, value]) => value.trim())
      .sort(([left], [right]) => left.localeCompare(right))
  });

export const sessionTargetSignature = (
  config: Pick<AnteRuntimeConfig, "model" | "provider">,
): string =>
  JSON.stringify({
    model: config.model.trim(),
    provider: config.provider.trim(),
  });
