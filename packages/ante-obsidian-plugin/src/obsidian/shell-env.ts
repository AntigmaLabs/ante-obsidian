import { spawn } from "node:child_process";
import { basename } from "node:path";

const DEFAULT_SHELL = "/bin/zsh";
const VALID_ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VALID_COMMAND_NAME = /^[A-Za-z0-9._-]+$/;

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

const runShellCommand = (shellPath: string, shellArgs: string[], command: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(shellPath, [...shellArgs, command], {
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

export const readEnvVarFromLoginShell = async (variableName: string): Promise<string> => {
  const normalized = normalizeEnvVarName(variableName);
  if (!normalized) {
    return "";
  }
  const shellPath = (typeof process !== "undefined" ? process.env?.SHELL : undefined)?.trim() || DEFAULT_SHELL;
  try {
    return await readFromShell(shellPath, normalized);
  } catch {
    if (shellPath !== DEFAULT_SHELL) {
      return readFromShell(DEFAULT_SHELL, normalized);
    }
    return "";
  }
};

export const readFullEnvFromLoginShell = async (): Promise<Record<string, string>> => {
  const shellPath = (typeof process !== "undefined" ? process.env?.SHELL : undefined)?.trim() || DEFAULT_SHELL;
  const shellName = basename(shellPath).toLowerCase();
  
  // Try interactive login shell first (-lic) to ensure ~/.zshrc is loaded,
  // then fallback to login shell (-lc) or interactive shell (-ic)
  const argCandidates = (shellName === "zsh" || shellName === "bash")
    ? [["-lic"], ["-lc"], ["-ic"]]
    : [["-lc"]];

  const runForShell = async (path: string, args: string[]): Promise<Record<string, string>> => {
    const stdout = await runShellCommand(path, args, "env");
    const envMap: Record<string, string> = {};
    stdout.split(/\r?\n/).forEach((line) => {
      const index = line.indexOf("=");
      if (index > 0) {
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim();
        if (key) {
          envMap[key] = value;
        }
      }
    });
    return envMap;
  };

  for (const args of argCandidates) {
    try {
      const env = await runForShell(shellPath, args);
      if (Object.keys(env).length > 0) {
        return env;
      }
    } catch {
      continue;
    }
  }

  // Fallback to DEFAULT_SHELL candidates
  if (shellPath !== DEFAULT_SHELL) {
    for (const args of [["-lic"], ["-lc"]]) {
      try {
        const env = await runForShell(DEFAULT_SHELL, args);
        if (Object.keys(env).length > 0) {
          return env;
        }
      } catch {
        continue;
      }
    }
  }

  return {};
};

export const normalizeCommandName = (commandName: string): string => {
  const trimmed = commandName.trim();
  return VALID_COMMAND_NAME.test(trimmed) ? trimmed : "";
};

const getCommandLookupShellArgs = (shellPath: string): string[][] => {
  const shellName = basename(shellPath).toLowerCase();
  if (shellName === "zsh" || shellName === "bash") {
    return [["-lc"], ["-ic"]];
  }
  return [["-lc"]];
};

const extractCommandLookupResult = (stdout: string): string => {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : "";
};

const isValidCommandLookupResult = (result: string, requestedCommand: string): boolean => {
  if (!result) {
    return false;
  }
  if (result.startsWith("alias ") || result.includes("=") || /\s/.test(result)) {
    return false;
  }
  if (result.startsWith("/")) {
    return true;
  }
  return result === requestedCommand;
};

export const readCommandPathFromLoginShell = async (commandName: string): Promise<string> => {
  const normalized = normalizeCommandName(commandName);
  if (!normalized) {
    return "";
  }

  const shellCandidates = [(typeof process !== "undefined" ? process.env?.SHELL : undefined)?.trim() || DEFAULT_SHELL, DEFAULT_SHELL].filter(
    (shellPath, index, shells) => shellPath && shells.indexOf(shellPath) === index
  );
  const command = `command -v -- ${normalized}`;

  for (const shellPath of shellCandidates) {
    for (const shellArgs of getCommandLookupShellArgs(shellPath)) {
      try {
        const rawOutput = await runShellCommand(shellPath, shellArgs, command);
        const result = extractCommandLookupResult(rawOutput);
        if (isValidCommandLookupResult(result, normalized)) {
          return result;
        }
      } catch {
        continue;
      }
    }
  }

  return "";
};

export const selectResolvedCommandPath = (
  shellLookupResult: string,
  fallbackLookupResult: string,
  commandName: string
): string => {
  const normalized = normalizeCommandName(commandName);
  if (!normalized) {
    return "";
  }
  const shellResult = shellLookupResult.trim();
  if (isValidCommandLookupResult(shellResult, normalized)) {
    return shellResult;
  }
  const fallbackResult = fallbackLookupResult.trim();
  if (fallbackResult !== normalized && isValidCommandLookupResult(fallbackResult, normalized)) {
    return fallbackResult;
  }
  return "";
};

export const __test__ = {
  normalizeEnvVarName,
  normalizeCommandName,
  getCommandLookupShellArgs,
  extractCommandLookupResult,
  isValidCommandLookupResult,
  selectResolvedCommandPath
};
