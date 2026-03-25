import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createConnection } from "node:net";
import type { Readable } from "node:stream";
import type { AnteTransport } from "./ante-transport";
import { resolveCommandPath } from "./ante-stdio-transport";

export interface AnteWebSocketTransportConfig {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  address: string;
  connectTimeoutMs?: number;
}

const flushBufferedLines = (buffer: string, emit: (line: string) => void): string => {
  const lines = buffer.split(/\r?\n/);
  const pending = lines.pop() ?? "";
  for (const line of lines) {
    emit(line);
  }
  return pending;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const toWebSocketUrl = (address: string): string => {
  const trimmed = address.trim();
  if (!trimmed) {
    throw new Error("Ante WebSocket address is required");
  }
  if (/^wss?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `ws://${trimmed}`;
};

export const parseSocketAddress = (address: string): { host: string; port: number } => {
  const url = new URL(toWebSocketUrl(address));
  const port = Number(url.port || (url.protocol === "wss:" ? 443 : 80));
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid Ante WebSocket port in address: ${address}`);
  }
  return {
    host: url.hostname,
    port
  };
};

export const normalizeWsListenAddress = (address: string): string => {
  const trimmed = address.trim();
  if (!trimmed) {
    throw new Error("Ante WebSocket address is required");
  }
  if (/^wss?:\/\//i.test(trimmed)) {
    const { host, port } = parseSocketAddress(trimmed);
    return `${host}:${port}`;
  }
  return trimmed;
};

export class AnteWebSocketTransport implements AnteTransport {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private socket: WebSocket | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private onMessage: (message: string) => void = () => {};
  private onError: (error: Error) => void = () => {};
  private onClose: (info?: { code?: number; reason?: string }) => void = () => {};
  private onDiagnostic: (event: { stream: "stdout" | "stderr"; text: string }) => void = () => {};
  private disposed = false;

  constructor(private readonly config: AnteWebSocketTransportConfig) {}

  async connect(): Promise<void> {
    if (this.child || this.socket) {
      return;
    }

    this.disposed = false;
    const command = resolveCommandPath(this.config.command, this.config.env);
    const child = spawn(command, this.config.args, {
      cwd: this.config.cwd.trim() || undefined,
      env: {
        ...process.env,
        ...this.config.env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.child = child;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";

    child.stdout.on("data", (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString("utf8");
      this.stdoutBuffer = flushBufferedLines(this.stdoutBuffer, (line) => {
        this.onDiagnostic({ stream: "stdout", text: line });
      });
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
      this.socket = null;
      this.onClose({
        code: code ?? undefined,
        reason: signal === "SIGTERM" ? "SIGTERM" : undefined
      });
    });

    try {
      await this.connectSocketWithRetry();
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }

  disconnect(): void {
    this.disposed = true;
    this.socket?.close();
    this.socket = null;
    this.child?.kill("SIGTERM");
    this.child = null;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
  }

  send(message: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error("Ante WebSocket is not connected");
    }
    this.socket.send(message);
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
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

  private async connectSocketWithRetry(): Promise<void> {
    const deadline = Date.now() + (this.config.connectTimeoutMs ?? 5000);
    await this.waitForSocketReady(deadline);
    if (this.disposed) {
      throw new Error("Ante WebSocket startup was interrupted");
    }
    await this.connectSocket();
  }

  private async connectSocket(): Promise<void> {
    const socket = new WebSocket(toWebSocketUrl(this.config.address));
    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        socket.onopen = null;
        socket.onerror = null;
      };

      socket.onopen = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        this.socket = socket;
        resolve();
      };

      socket.onerror = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        try {
          socket.close();
        } catch {
          // ignore socket close failures during retry
        }
        reject(new Error(`Failed to connect to Ante WebSocket at ${this.config.address}`));
      };
    });

    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        this.onMessage(event.data);
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        this.onMessage(new TextDecoder().decode(event.data));
      }
    };
    socket.onerror = () => {
      if (this.disposed) {
        return;
      }
      this.onError(new Error(`Ante WebSocket connection error at ${this.config.address}`));
    };
    socket.onclose = (event) => {
      if (this.disposed) {
        return;
      }
      if (this.socket === socket) {
        this.socket = null;
      }
      this.onClose({
        code: event.code,
        reason: event.reason || undefined
      });
    };
  }

  private async waitForSocketReady(deadline: number): Promise<void> {
    const { host, port } = parseSocketAddress(this.config.address);
    let lastError: Error | null = null;

    while (!this.disposed && Date.now() < deadline) {
      try {
        await new Promise<void>((resolve, reject) => {
          const socket = createConnection({ host, port });
          const cleanup = (): void => {
            socket.removeAllListeners();
            socket.destroy();
          };

          socket.once("connect", () => {
            cleanup();
            resolve();
          });
          socket.once("error", (error) => {
            cleanup();
            reject(error);
          });
        });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await sleep(100);
      }
    }

    throw lastError ?? new Error(`Timed out waiting for Ante WebSocket server at ${this.config.address}`);
  }
}
