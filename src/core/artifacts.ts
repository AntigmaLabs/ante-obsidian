import type { ContextSnapshot, DocumentChangeArtifact, InsertAnchor, RuntimeChangeSuggestion } from "./types";

const appendMarkdownBlock = (documentText: string, block: string): string => {
  const trimmedDoc = documentText.replace(/\n+$/, "");
  const trimmedBlock = block.trim();
  if (!trimmedBlock) {
    return trimmedDoc;
  }
  return trimmedDoc ? `${trimmedDoc}\n\n${trimmedBlock}\n` : `${trimmedBlock}\n`;
};

const insertMarkdownBlockAtOffset = (documentText: string, offset: number, block: string): string => {
  const trimmedBlock = block.trim();
  if (!trimmedBlock) {
    return documentText;
  }

  const safeOffset = Math.max(0, Math.min(offset, documentText.length));
  const before = documentText.slice(0, safeOffset);
  const after = documentText.slice(safeOffset);

  let insertion = trimmedBlock;
  if (before && !before.endsWith("\n\n")) {
    insertion = `${before.endsWith("\n") ? "\n" : "\n\n"}${insertion}`;
  }
  if (after) {
    if (!after.startsWith("\n\n")) {
      insertion = `${insertion}${after.startsWith("\n") ? "\n" : "\n\n"}`;
    }
  } else {
    insertion = `${insertion}\n`;
  }

  return `${before}${insertion}${after}`;
};

const buildLineOffsets = (documentText: string): number[] => {
  const offsets = [0];
  for (let index = 0; index < documentText.length; index += 1) {
    if (documentText[index] === "\n") {
      offsets.push(index + 1);
    }
  }
  return offsets;
};

const headingLinePattern = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

const findHeadingOffset = (documentText: string, query: string, placement: "before" | "after"): number | null => {
  const lines = documentText.split("\n");
  const offsets = buildLineOffsets(documentText);
  const normalizedQuery = query.trim().toLowerCase();

  for (let index = 0; index < lines.length; index += 1) {
    const match = headingLinePattern.exec(lines[index] ?? "");
    if (!match) {
      continue;
    }
    const headingText = match[2]?.trim().toLowerCase() ?? "";
    if (headingText !== normalizedQuery && !headingText.includes(normalizedQuery)) {
      continue;
    }
    const lineStart = offsets[index] ?? 0;
    const lineEnd = lineStart + (lines[index]?.length ?? 0);
    return placement === "before" ? lineStart : lineEnd;
  }

  return null;
};

const findTextOffset = (documentText: string, query: string, placement: "before" | "after"): number | null => {
  const exactIndex = documentText.indexOf(query);
  if (exactIndex >= 0) {
    return placement === "before" ? exactIndex : exactIndex + query.length;
  }

  const lowerDoc = documentText.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const foldedIndex = lowerDoc.indexOf(lowerQuery);
  if (foldedIndex >= 0) {
    return placement === "before" ? foldedIndex : foldedIndex + query.length;
  }

  return null;
};

const findParagraphOffset = (documentText: string, index: number, placement: "before" | "after"): number | null => {
  if (index < 1) {
    return null;
  }

  const matches = [...documentText.matchAll(/\S[\s\S]*?(?:(?:\n\s*\n)|$)/g)];
  const target = matches[index - 1];
  if (!target || target.index == null) {
    return null;
  }

  const paragraphText = target[0].replace(/\n\s*\n$/, "");
  const start = target.index;
  const end = start + paragraphText.length;
  return placement === "before" ? start : end;
};

const resolveInsertOffset = (
  documentText: string,
  context: ContextSnapshot,
  anchor: InsertAnchor | undefined,
  placement: "before" | "after",
  defaultAnchor: InsertAnchor
): number => {
  const resolvedAnchor = anchor ?? defaultAnchor;
  switch (resolvedAnchor.by) {
    case "document-start":
      return 0;
    case "document-end":
      return documentText.length;
    case "selection":
      if (!context.selection) {
        throw new Error("insert-block with selection anchor requires an active editor position");
      }
      return placement === "before"
        ? buildLineOffsets(documentText)[context.selection.from.line]! + context.selection.from.ch
        : buildLineOffsets(documentText)[context.selection.to.line]! + context.selection.to.ch;
    case "heading": {
      const offset = findHeadingOffset(documentText, resolvedAnchor.value, placement);
      if (offset == null) {
        throw new Error(`Heading anchor not found: ${resolvedAnchor.value}`);
      }
      return offset;
    }
    case "text": {
      const offset = findTextOffset(documentText, resolvedAnchor.value, placement);
      if (offset == null) {
        throw new Error(`Text anchor not found: ${resolvedAnchor.value}`);
      }
      return offset;
    }
    case "paragraph-index": {
      const offset = findParagraphOffset(documentText, resolvedAnchor.value, placement);
      if (offset == null) {
        throw new Error(`Paragraph anchor out of range: ${resolvedAnchor.value}`);
      }
      return offset;
    }
  }
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
        throw new Error("replace-selection requires an active editor position or selection");
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
    case "insert-block": {
      const targetPath = change.targetPath?.trim() || context.filePath;
      if (!targetPath) {
        throw new Error("insert-block requires a target Markdown file");
      }
      const insertionOffset = resolveInsertOffset(
        existingTargetText,
        context,
        change.anchor,
        change.placement ?? "after",
        targetPath === context.filePath ? { by: "selection" } : { by: "document-end" }
      );
      return {
        id: crypto.randomUUID(),
        title: change.title?.trim() || "Insert block",
        summary: change.summary?.trim() || undefined,
        operation: change.operation,
        target: {
          type: "file",
          path: targetPath
        },
        beforeText: existingTargetText,
        afterText: insertMarkdownBlockAtOffset(existingTargetText, insertionOffset, change.afterText),
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
