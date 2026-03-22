import { spawn } from "node:child_process";

const DEFAULT_SHELL = "/bin/zsh";
const VALID_ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const normalizeEnvVarName = (variableName: string): string => {
  const trimmed = variableName.trim();
  return VALID_ENV_VAR_NAME.test(trimmed) ? trimmed : "";
};

const readFromShell = (shellPath: string, variableName: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(shellPath, ["-lc", "env"], {
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
      const value = stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith(`${variableName}=`))
        ?.slice(variableName.length + 1)
        .trim();
      resolve(value ?? "");
    });
  });

export const readEnvVarFromLoginShell = async (variableName: string): Promise<string> => {
  const normalized = normalizeEnvVarName(variableName);
  if (!normalized) {
    return "";
  }
  const shellPath = process.env.SHELL?.trim() || DEFAULT_SHELL;
  try {
    return await readFromShell(shellPath, normalized);
  } catch {
    if (shellPath !== DEFAULT_SHELL) {
      return readFromShell(DEFAULT_SHELL, normalized);
    }
    return "";
  }
};

export const __test__ = {
  normalizeEnvVarName
};
