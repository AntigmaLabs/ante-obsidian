import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { structuredPatch } from "diff";
import type { DocumentChangeArtifact } from "./types";
import { getArtifactTargetPath } from "./artifacts";

export type PatchRow =
  | { kind: "meta" | "hunk"; text: string }
  | {
      kind: "context" | "add" | "remove";
      text: string;
      oldLine: number | null;
      newLine: number | null;
      marker: " " | "+" | "-";
    };

const sanitizePatchPath = (value: string): string => {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const sanitized = normalized
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, "-"))
    .join("/");
  return sanitized || "untitled.md";
};

const createPatchMetaRows = (artifact: DocumentChangeArtifact): PatchRow[] => {
  const fileLabel = getArtifactTargetPath(artifact);
  const oldFileName = artifact.operation === "create-file" ? "/dev/null" : `a/${fileLabel}`;
  const newFileName = `b/${fileLabel}`;
  return [
    { kind: "meta", text: `diff --git ${oldFileName} ${newFileName}` },
    { kind: "meta", text: `--- ${oldFileName}` },
    { kind: "meta", text: `+++ ${newFileName}` }
  ];
};

const buildFallbackPatchRows = (artifact: DocumentChangeArtifact, reason?: string): PatchRow[] => {
  const fileLabel = getArtifactTargetPath(artifact);
  const oldFileName = artifact.operation === "create-file" ? "/dev/null" : `a/${fileLabel}`;
  const newFileName = `b/${fileLabel}`;
  const patch = structuredPatch(oldFileName, newFileName, artifact.beforeText, artifact.afterText, "", "", {
    context: 3
  });
  const rows = createPatchMetaRows(artifact);

  if (reason) {
    rows.push({ kind: "meta", text: `# native git diff unavailable: ${reason}` });
  }

  for (const hunk of patch.hunks) {
    rows.push({ kind: "hunk", text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@` });

    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const line of hunk.lines) {
      const marker = line[0] as " " | "+" | "-";
      const text = line.slice(1);

      if (marker === " ") {
        rows.push({ kind: "context", text, oldLine, newLine, marker });
        oldLine += 1;
        newLine += 1;
      } else if (marker === "-") {
        rows.push({ kind: "remove", text, oldLine, newLine: null, marker });
        oldLine += 1;
      } else if (marker === "+") {
        rows.push({ kind: "add", text, oldLine: null, newLine, marker });
        newLine += 1;
      }
    }
  }

  return rows;
};

const runGitDiffNoIndex = async (oldPath: string, newPath: string): Promise<string> => {
  const child = spawn("git", ["diff", "--no-index", "--no-color", "--text", "--unified=3", "--", oldPath, newPath], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer | string) => {
    stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 0));
  });

  if (exitCode === 0 || exitCode === 1) {
    return stdout;
  }

  throw new Error(stderr.trim() || `git diff exited with code ${exitCode}`);
};

const parseGitDiffRows = (artifact: DocumentChangeArtifact, rawPatch: string): PatchRow[] => {
  const rows = createPatchMetaRows(artifact);
  const lines = rawPatch.split(/\r?\n/);
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of lines) {
    if (!line || line.startsWith("diff --git ") || line.startsWith("index ")) {
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      continue;
    }
    if (line.startsWith("@@ ")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (!match) {
        continue;
      }
      oldLine = Number.parseInt(match[1], 10);
      newLine = Number.parseInt(match[2], 10);
      inHunk = true;
      rows.push({ kind: "hunk", text: line });
      continue;
    }
    if (!inHunk || line === "\\ No newline at end of file") {
      continue;
    }

    const marker = line[0] as " " | "+" | "-";
    const text = line.slice(1);
    if (marker === " ") {
      rows.push({ kind: "context", text, oldLine, newLine, marker });
      oldLine += 1;
      newLine += 1;
    } else if (marker === "-") {
      rows.push({ kind: "remove", text, oldLine, newLine: null, marker });
      oldLine += 1;
    } else if (marker === "+") {
      rows.push({ kind: "add", text, oldLine: null, newLine, marker });
      newLine += 1;
    }
  }

  return rows;
};

export const buildPatchRows = async (artifact: DocumentChangeArtifact): Promise<PatchRow[]> => {
  if (artifact.baselinePath && artifact.stagedPath) {
    try {
      const rawPatch = await runGitDiffNoIndex(artifact.baselinePath, artifact.stagedPath);
      return parseGitDiffRows(artifact, rawPatch);
    } catch (error) {
      return buildFallbackPatchRows(artifact, error instanceof Error ? error.message : String(error));
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), "tmd-diff-"));
  const relativePath = sanitizePatchPath(getArtifactTargetPath(artifact));
  const oldPath = join(tempDir, "old", relativePath);
  const newPath = join(tempDir, "new", relativePath);

  try {
    await mkdir(dirname(oldPath), { recursive: true });
    await mkdir(dirname(newPath), { recursive: true });
    await writeFile(oldPath, artifact.beforeText, "utf8");
    await writeFile(newPath, artifact.afterText, "utf8");
    const rawPatch = await runGitDiffNoIndex(oldPath, newPath);
    return parseGitDiffRows(artifact, rawPatch);
  } catch (error) {
    return buildFallbackPatchRows(artifact, error instanceof Error ? error.message : String(error));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};
