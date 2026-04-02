import { requestUrl } from "obsidian";
import { spawn } from "node:child_process";
import { normalizeAnteVersion, parseAnteVersionOutput, shouldOfferAnteUpdate } from "./ante-version";
import { resolveCommandPath } from "../runtime/transport/ante-stdio-transport";

const DEFAULT_SHELL = "/bin/zsh";
const DEFAULT_MANIFEST_URL = "https://storage.googleapis.com/release-antigma-public/channels/latest/manifest.json";
const DEFAULT_INSTALL_URL = "https://storage.googleapis.com/release-antigma-public/install.sh";
const DEFAULT_CHANNEL = "latest";

export interface AnteRemoteManifest {
  version: string;
  generatedAt: string;
}

export interface AnteVersionCheckResult {
  localVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string;
  error?: string;
}

const runShellCommand = (command: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const shellPath = process.env.SHELL?.trim() || DEFAULT_SHELL;
    const child = spawn(shellPath, ["-lc", command], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
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
      resolve(stdout.trim());
    });
  });

export class AnteUpdater {
  async checkForUpdate(): Promise<AnteVersionCheckResult> {
    const checkedAt = new Date().toISOString();
    const [localResult, remoteResult] = await Promise.allSettled([this.getLocalVersion(), this.getRemoteManifest()]);

    const localVersion = localResult.status === "fulfilled" ? localResult.value : null;
    const latestVersion =
      remoteResult.status === "fulfilled"
        ? normalizeAnteVersion(remoteResult.value.version) || remoteResult.value.version
        : null;
    const errorMessages = [
      localResult.status === "rejected" ? this.getErrorMessage(localResult.reason) : "",
      remoteResult.status === "rejected" ? this.getErrorMessage(remoteResult.reason) : ""
    ].filter(Boolean);

    return {
      localVersion,
      latestVersion,
      updateAvailable: shouldOfferAnteUpdate(localVersion, latestVersion),
      checkedAt,
      error: errorMessages.length > 0 ? errorMessages.join(" | ") : undefined
    };
  }

  async getLocalVersion(): Promise<string | null> {
    const resolved = resolveCommandPath("ante", {});
    if (!resolved) {
      throw new Error("Ante command is not configured");
    }
    const output = await runShellCommand(`${this.quoteShellArg(resolved)} --version`);
    return parseAnteVersionOutput(output);
  }

  async getRemoteManifest(manifestUrl = DEFAULT_MANIFEST_URL): Promise<AnteRemoteManifest> {
    const response = await requestUrl({
      url: manifestUrl,
      method: "GET",
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Failed to fetch Ante manifest (${response.status})`);
    }

    const body = response.json as Record<string, unknown>;
    const version = typeof body.version === "string" ? body.version.trim() : "";
    if (!version) {
      throw new Error("Ante manifest missing version");
    }

    return {
      version,
      generatedAt: typeof body.generated_at === "string" ? body.generated_at : ""
    };
  }

  async upgrade(channel = DEFAULT_CHANNEL): Promise<void> {
    const installCommand = `curl -fsSL ${this.quoteShellArg(DEFAULT_INSTALL_URL)} | bash -s -- ${this.quoteShellArg(channel)}`;
    await runShellCommand(installCommand);
  }

  private quoteShellArg(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  private getErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : "Failed to check Ante version";
    if (/command not found/i.test(message) || /not configured/i.test(message)) {
      return "Ante is not installed yet. Ante md only supports the standard `ante` executable.";
    }
    return message;
  }
}
