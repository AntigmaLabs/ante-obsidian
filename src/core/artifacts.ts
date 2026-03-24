import type { ContextSnapshot, DocumentChangeArtifact, RuntimeChangeSuggestion } from "./types";

const appendMarkdownBlock = (documentText: string, block: string): string => {
  const trimmedDoc = documentText.replace(/\n+$/, "");
  const trimmedBlock = block.trim();
  if (!trimmedBlock) {
    return trimmedDoc;
  }
  return trimmedDoc ? `${trimmedDoc}\n\n${trimmedBlock}\n` : `${trimmedBlock}\n`;
};

const replaceSelectionInDocument = (
  documentText: string,
  context: NonNullable<ContextSnapshot["selection"]>,
  replacement: string
): string => {
  const lines = documentText.split("\n");
  const startLine = lines[context.from.line] ?? "";
  const endLine = lines[context.to.line] ?? "";
  const before = startLine.slice(0, context.from.ch);
  const after = endLine.slice(context.to.ch);
  const replacementLines = replacement.split("\n");
  const updatedLines = [...lines];

  const merged = [`${before}${replacementLines[0] ?? ""}`];
  for (let index = 1; index < replacementLines.length; index += 1) {
    merged.push(replacementLines[index]);
  }
  merged[merged.length - 1] = `${merged[merged.length - 1] ?? ""}${after}`;

  updatedLines.splice(context.from.line, context.to.line - context.from.line + 1, ...merged);
  return updatedLines.join("\n");
};

export const getArtifactTargetPath = (artifact: DocumentChangeArtifact): string =>
  artifact.target.type === "file" ? artifact.target.path : artifact.target.filePath;

export const getArtifactLocationLabel = (artifact: DocumentChangeArtifact): string => {
  if (artifact.target.type === "file") {
    return artifact.target.path;
  }

  const range = `${artifact.target.from.line + 1}:${artifact.target.from.ch + 1}-${artifact.target.to.line + 1}:${
    artifact.target.to.ch + 1
  }`;
  return `${artifact.target.filePath} · ${range}`;
};

export const toDocumentChangeArtifact = (
  change: RuntimeChangeSuggestion,
  context: ContextSnapshot,
  existingTargetText: string
): DocumentChangeArtifact => {
  switch (change.operation) {
    case "replace-selection": {
      if (!context.selection || !context.filePath || context.documentText == null) {
        throw new Error("replace-selection requires an active Markdown selection");
      }

      return {
        id: crypto.randomUUID(),
        title: change.title?.trim() || "Replace selection",
        summary: change.summary?.trim() || undefined,
        operation: change.operation,
        target: {
          type: "selection",
          filePath: context.filePath,
          from: context.selection.from,
          to: context.selection.to
        },
        beforeText: context.documentText,
        afterText: replaceSelectionInDocument(context.documentText, context.selection, change.afterText),
        sourceChanges: [{ ...change }],
        applyState: "pending"
      };
    }
    case "append-block": {
      const targetPath = change.targetPath?.trim() || context.filePath;
      if (!targetPath) {
        throw new Error("append-block requires a target Markdown file");
      }
      return {
        id: crypto.randomUUID(),
        title: change.title?.trim() || "Append block",
        summary: change.summary?.trim() || undefined,
        operation: change.operation,
        target: {
          type: "file",
          path: targetPath
        },
        beforeText: existingTargetText,
        afterText: appendMarkdownBlock(existingTargetText, change.afterText),
        sourceChanges: [{ ...change }],
        applyState: "pending"
      };
    }
    case "replace-file": {
      const targetPath = change.targetPath?.trim() || context.filePath;
      if (!targetPath) {
        throw new Error("replace-file requires a target Markdown file");
      }
      return {
        id: crypto.randomUUID(),
        title: change.title?.trim() || "Replace file",
        summary: change.summary?.trim() || undefined,
        operation: change.operation,
        target: {
          type: "file",
          path: targetPath
        },
        beforeText: existingTargetText,
        afterText: change.afterText,
        sourceChanges: [{ ...change }],
        applyState: "pending"
      };
    }
    case "create-file": {
      const targetPath = change.targetPath?.trim();
      if (!targetPath) {
        throw new Error("create-file requires a targetPath");
      }
      return {
        id: crypto.randomUUID(),
        title: change.title?.trim() || "Create file",
        summary: change.summary?.trim() || undefined,
        operation: change.operation,
        target: {
          type: "file",
          path: targetPath
        },
        beforeText: "",
        afterText: change.afterText,
        sourceChanges: [{ ...change }],
        applyState: "pending"
      };
    }
  }
};
