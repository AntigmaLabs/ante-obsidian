import type { DocumentChangeArtifact, RuntimeApprovalTool } from "./types";

export const getArtifactTargetPath = (artifact: DocumentChangeArtifact): string => artifact.target.path;

export const getArtifactLocationLabel = (artifact: DocumentChangeArtifact): string => artifact.target.path;

const parseApprovalToolArgs = (tool: RuntimeApprovalTool): Record<string, unknown> | null => {
  if (!tool.argsText?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(tool.argsText) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const getStringArg = (args: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
};

const getRawStringArg = (args: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return null;
};

const getBooleanArg = (args: Record<string, unknown>, keys: string[]): boolean | null => {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
};

const replaceFirstOccurrence = (text: string, search: string, replacement: string): string | null => {
  const index = text.indexOf(search);
  if (index < 0) {
    return null;
  }
  return `${text.slice(0, index)}${replacement}${text.slice(index + search.length)}`;
};

const replaceAllOccurrences = (text: string, search: string, replacement: string): string | null => {
  if (!search || !text.includes(search)) {
    return null;
  }
  return text.split(search).join(replacement);
};

export const createRuntimeFileArtifact = ({
  toolId,
  title,
  targetPath,
  beforeText,
  afterText,
  runtimeMode = "approval"
}: {
  toolId: string;
  title: string;
  targetPath: string;
  beforeText: string;
  afterText: string;
  runtimeMode?: DocumentChangeArtifact["runtimeMode"];
}): DocumentChangeArtifact => ({
  id: crypto.randomUUID(),
  title,
  operation: beforeText.length === 0 ? "create-file" : "replace-file",
  target: {
    type: "file",
    path: targetPath
  },
  beforeText,
  afterText,
  applyState: "pending",
  runtimeToolId: toolId,
  runtimeMode
});

export const toDocumentChangeArtifactFromApprovalTool = (
  tool: RuntimeApprovalTool,
  beforeText: string
): DocumentChangeArtifact | null => {
  const args = parseApprovalToolArgs(tool);
  if (!args) {
    return null;
  }

  const normalizedName = tool.name.trim().toLowerCase();
  const targetPath = getStringArg(args, ["file_path", "path", "targetPath"]);
  if (!targetPath) {
    return null;
  }

  if (normalizedName === "write") {
    const afterText = getStringArg(args, ["content", "text", "afterText"]);
    if (afterText == null) {
      return null;
    }
    return createRuntimeFileArtifact({
      toolId: tool.id,
      title: "Write file",
      targetPath,
      beforeText,
      afterText
    });
  }

  if (normalizedName === "edit") {
    const oldString = getRawStringArg(args, ["old_string", "oldString"]);
    const newString = getRawStringArg(args, ["new_string", "newString"]);
    const replaceAll = getBooleanArg(args, ["replace_all", "replaceAll"]) ?? false;
    if (oldString == null || newString == null) {
      return null;
    }

    const afterText = replaceAll
      ? replaceAllOccurrences(beforeText, oldString, newString)
      : replaceFirstOccurrence(beforeText, oldString, newString);
    if (afterText == null || afterText === beforeText) {
      return null;
    }

    return createRuntimeFileArtifact({
      toolId: tool.id,
      title: "Edit file",
      targetPath,
      beforeText,
      afterText
    });
  }

  return null;
};
