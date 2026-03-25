import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import type { AnteTransport } from "./ante-transport";

export interface AnteStdioTransportConfig {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

const canExecuteFile = (filePath: string): boolean => {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const resolveCommandPath = (command: string, env: Record<string, string>): string => {
  const trimmed = command.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.includes("/") || isAbsolute(trimmed)) {
    return trimmed;
  }

  const pathEntries = [
    ...(env.PATH?.split(delimiter) ?? []),
    ...(process.env.PATH?.split(delimiter) ?? [])
  ].filter(Boolean);

  const candidates = [
    ...pathEntries.map((entry) => join(entry, trimmed)),
    join(homedir(), ".ante", "bin", trimmed),
    join("/opt/homebrew/bin", trimmed),
    join("/usr/local/bin", trimmed)
  ];

  for (const candidate of [...new Set(candidates)]) {
    if (canExecuteFile(candidate)) {
      return candidate;
    }
  }

  return trimmed;
};

const flushBufferedLines = (buffer: string, emit: (line: string) => void): string => {
  const lines = buffer.split(/\r?\n/);
  const pending = lines.pop() ?? "";
  for (const line of lines) {
    emit(line);
  }
  return pending;
};

export class AnteStdioTransport implements AnteTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private onMessage: (message: string) => void = () => {};
  private onError: (error: Error) => void = () => {};
  private onClose: (info?: { code?: number; reason?: string }) => void = () => {};
  private onDiagnostic: (event: { stream: "stdout" | "stderr"; text: string }) => void = () => {};

  constructor(private readonly config: AnteStdioTransportConfig) {}

  async connect(): Promise<void> {
    if (this.child) {
      return;
    }
    const command = resolveCommandPath(this.config.command, this.config.env);
    const child = spawn(command, this.config.args, {
      cwd: this.config.cwd.trim() || undefined,
      env: {
        ...process.env,
        ...this.config.env
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";

    child.stdout.on("data", (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString("utf8");
      this.stdoutBuffer = flushBufferedLines(this.stdoutBuffer, (line) => this.onMessage(line));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrBuffer += chunk.toString("utf8");
      this.stderrBuffer = flushBufferedLines(this.stderrBuffer, (line) => {
        this.onDiagnostic({ stream: "stderr", text: line });
      });
    });
    child.once("error", (error) => {
      if (this.child !== child) {
        return;
      }
      this.child = null;
      this.onError(error);
    });
    child.once("close", (code, signal) => {
      if (this.child !== child) {
        return;
      }
      this.child = null;
      this.onClose({
        code: code ?? undefined,
        reason: signal === "SIGTERM" ? "SIGTERM" : undefined
      });
    });
  }

  disconnect(): void {
    this.child?.kill("SIGTERM");
    this.child = null;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
  }

  send(message: string): void {
    this.child?.stdin.write(`${message}\n`);
  }

  isConnected(): boolean {
    return this.child != null;
  }

  setMessageHandler(handler: (message: string) => void): void {
    this.onMessage = handler;
  }

  setErrorHandler(handler: (error: Error) => void): void {
    this.onError = handler;
  }

  setCloseHandler(handler: (info?: { code?: number; reason?: string }) => void): void {
    this.onClose = handler;
  }

  setDiagnosticHandler(handler: (event: { stream: "stdout" | "stderr"; text: string }) => void): void {
    this.onDiagnostic = handler;
  }
}
