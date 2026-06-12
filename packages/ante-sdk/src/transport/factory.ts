import type { ResolvedOptions } from "../session/options";
import type { AnteTransport } from "./transport";
import { AnteStdioTransport } from "./stdio";
import { AnteWebSocketTransport, normalizeWsListenAddress } from "./websocket";

const stripTransportArgs = (args: string[]): string[] => {
  const sanitized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === "--stdio") {
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

export const ensureStdioArgs = (args: string[]): string[] => {
  const next = [...args];
  if (!next.includes("serve")) {
    next.unshift("serve");
  }
  if (!next.includes("--stdio")) {
    next.push("--stdio");
  }
  return next;
};

export const ensureWebSocketArgs = (args: string[], address: string): string[] => {
  const next = stripTransportArgs(args);
  if (!next.includes("serve")) {
    next.unshift("serve");
  }
  next.push("--ws", address);
  return next;
};

export const createTransport = (options: ResolvedOptions): AnteTransport => {
  if (options.transport === "websocket") {
    return new AnteWebSocketTransport({
      command: options.pathToAnteExecutable,
      args: ensureWebSocketArgs(options.anteArgs, normalizeWsListenAddress(options.wsAddress)),
      cwd: options.cwd,
      env: options.env,
      address: options.wsAddress,
    });
  }

  return new AnteStdioTransport({
    command: options.pathToAnteExecutable,
    args: ensureStdioArgs(options.anteArgs),
    cwd: options.cwd,
    env: options.env,
  });
};
