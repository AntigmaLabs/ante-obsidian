import { AnteSessionDriver, type AnteRuntimeConfig } from "./ante-session-driver";
import type { AnteRuntime } from "./ante-runtime";
import { AnteStdioTransport } from "./transport/ante-stdio-transport";
import { AnteWebSocketTransport, normalizeWsListenAddress } from "./transport/ante-websocket-transport";

export const DEFAULT_ANTE_ARGS_JSON = JSON.stringify(["serve", "--stdio"]);

const ensureServeArgs = (args: string[]): string[] => {
  args = args.filter((arg) => arg !== "--yolo");
  if (!args.includes("serve")) {
    args.unshift("serve");
  }
  if (!args.includes("--stdio")) {
    args.push("--stdio");
  }
  return args;
};

const stripTransportArgs = (args: string[]): string[] => {
  const sanitized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === "--stdio" || current === "--yolo") {
      continue;
    }
    if (current === "--ws") {
      index += 1;
      continue;
    }
    sanitized.push(current);
  }
  return sanitized;
};

const ensureWebSocketArgs = (args: string[], address: string): string[] => {
  const sanitized = stripTransportArgs(args);
  if (!sanitized.includes("serve")) {
    sanitized.unshift("serve");
  }
  sanitized.push("--ws", address);
  return sanitized;
};

const parseArgs = (argsJson: string): string[] => {
  if (!argsJson.trim()) {
    return [];
  }
  const parsed = JSON.parse(argsJson) as unknown;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error("Ante arguments JSON must be a string array");
  }
  return [...parsed];
};

export const __test__ = {
  ensureServeArgs,
  ensureWebSocketArgs,
  stripTransportArgs,
  parseArgs
};

export const createAnteRuntime = (getConfig: () => AnteRuntimeConfig): AnteRuntime =>
  new AnteSessionDriver(getConfig, (config) => {
    const parsedArgs = parseArgs(config.argsJson);
    if (config.connectionMode === "websocket") {
      const listenAddress = normalizeWsListenAddress(config.wsAddress);
      return new AnteWebSocketTransport({
        command: config.command,
        args: ensureWebSocketArgs(parsedArgs, listenAddress),
        cwd: config.cwd,
        env: config.env,
        address: config.wsAddress
      });
    }
    return new AnteStdioTransport({
      command: config.command,
      args: ensureServeArgs(parsedArgs),
      cwd: config.cwd,
      env: config.env
    });
  });
