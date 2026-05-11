import type { AnteThinkingLevel, Options, PermissionMode } from "../types";

export const DEFAULT_ANTE_ARGS = ["serve", "--stdio"] as const;

export interface ResolvedOptions {
  abortController: AbortController;
  allowedTools: string[];
  anteArgs: string[];
  cwd: string;
  disallowedTools: string[];
  env: Record<string, string>;
  model: string;
  pathToAnteExecutable: string;
  permissionMode: PermissionMode;
  provider: string;
  resume?: string;
  stderr?: (data: string) => void;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  thinking: AnteThinkingLevel | null;
  transport: "stdio" | "websocket";
  wsAddress: string;
}

const normalizeThinking = (thinking: Options["thinking"]): AnteThinkingLevel | null => {
  if (thinking == null) {
    return null;
  }
  if (typeof thinking === "string") {
    return thinking;
  }
  switch (thinking.type) {
    case "disabled":
      return "Disabled";
    case "enabled":
      return "Enabled";
    case "deep":
      return "Deep";
    case "max":
      return "Max";
    default:
      return null;
  }
};

const normalizeEnv = (env: Options["env"]): Record<string, string> => {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (value != null) {
      normalized[key] = value;
    }
  }
  return normalized;
};

export const resolveOptions = (options: Options = {}): ResolvedOptions => ({
  abortController: options.abortController ?? new AbortController(),
  allowedTools: options.allowedTools ?? [],
  anteArgs: options.anteArgs ?? [...DEFAULT_ANTE_ARGS],
  cwd: options.cwd ?? process.cwd(),
  disallowedTools: options.disallowedTools ?? [],
  env: normalizeEnv(options.env),
  model: options.model ?? "",
  pathToAnteExecutable: options.pathToAnteExecutable ?? "ante",
  permissionMode: options.permissionMode ?? "default",
  provider: options.provider ?? "",
  resume: options.resume,
  stderr: options.stderr,
  systemPrompt: typeof options.systemPrompt === "string" ? options.systemPrompt : undefined,
  appendSystemPrompt:
    options.appendSystemPrompt ??
    (typeof options.systemPrompt === "object" && options.systemPrompt.type === "preset" ? options.systemPrompt.append : undefined),
  thinking: normalizeThinking(options.thinking),
  transport: options.transport ?? "stdio",
  wsAddress: options.wsAddress ?? "127.0.0.1:17361"
});

export const permissionModeToPolicy = (mode: PermissionMode): "Auto" | "Ask" | "Deny" => {
  switch (mode) {
    case "bypassPermissions":
    case "acceptEdits":
      return "Auto";
    case "dontAsk":
    case "plan":
      return "Deny";
    default:
      return "Ask";
  }
};
