import { spawn } from "node:child_process";

const DEFAULT_SHELL = "/bin/zsh";

export interface ObsidianCliStatus {
  available: boolean;
  error?: string;
}

const runShellCommand = (command: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const shellPath = (typeof process !== "undefined" ? process.env?.SHELL : undefined)?.trim() || DEFAULT_SHELL;
    const child = spawn(shellPath, ["-lc", command], {
      stdio: ["ignore", "ignore", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      reject(error);
    });
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Shell exited with code ${code ?? "unknown"}`));
        return;
      }
      resolve();
    });
  });

export class ObsidianCliService {
  async checkStatus(): Promise<ObsidianCliStatus> {
    try {
      await runShellCommand("obsidian help");
      return { available: true };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : "Failed to check Obsidian CLI"
      };
    }
  }
}
