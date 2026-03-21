import type { TaskRequest } from "./types";

const buildContextBlock = (request: TaskRequest): string => {
  const selection = request.context.selection?.text?.trim() ?? "";
  const documentText = request.context.documentText?.trim() ?? "";
  const notePath = request.context.filePath ?? "Untitled.md";

  return [
    `Current note path: ${notePath}`,
    selection ? `Selected text:\n${selection}` : "Selected text: <none>",
    documentText ? `Current note content:\n${documentText}` : "Current note content: <empty>"
  ].join("\n\n");
};

const buildSchemaBlock = (): string =>
  [
    "Return exactly one JSON object and nothing else.",
    'For a text-only response use: {"type":"text","text":"..."}',
    'For a document change use: {"type":"change","operation":"replace-selection|append-block|replace-file|create-file","targetPath":"optional/path.md","afterText":"...","title":"optional","summary":"optional"}',
    "Rules:",
    "- replace-selection: afterText is the replacement text for the current selection.",
    "- append-block: afterText is the Markdown block to append to the current file unless targetPath is provided.",
    "- replace-file: afterText is the full file contents.",
    "- create-file: targetPath is required and afterText is the full new file contents.",
    "- Do not wrap the JSON in code fences.",
    "- Do not emit explanations before or after the JSON."
  ].join("\n");

const buildTerminalSchemaBlock = (): string =>
  [
    "For terminal-style answers, reply with plain terminal text only.",
    'Only when you intend to modify Markdown, return exactly one JSON object: {"type":"change","operation":"replace-selection|append-block|replace-file|create-file","targetPath":"optional/path.md","afterText":"...","title":"optional","summary":"optional"}',
    "Rules:",
    "- Plain terminal text must not be wrapped in JSON or code fences.",
    "- change JSON must not be wrapped in code fences.",
    "- replace-selection: afterText is the replacement text for the current selection.",
    "- append-block: afterText is the Markdown block to append to the current file unless targetPath is provided.",
    "- replace-file: afterText is the full file contents.",
    "- create-file: targetPath is required and afterText is the full new file contents."
  ].join("\n");

export const buildInteractivePrompt = (request: TaskRequest): string => {
  const inlineInstruction = request.inlineInstruction.trim();
  const followUpPrompt = request.followUpPrompt?.trim() ?? "";

  if (request.mode === "followup") {
    return [followUpPrompt, "", request.kind === "terminal" ? buildTerminalSchemaBlock() : buildSchemaBlock()]
      .filter(Boolean)
      .join("\n");
  }

  return [
    request.kind === "console"
      ? "You are operating inside the Tmd Ante Console for an Obsidian vault."
      : request.kind === "terminal"
        ? "You are operating inside the Tmd Ante Terminal for an Obsidian vault. Use the current Markdown note context when it is provided."
        : "You are handling a Markdown editing task for an Obsidian note.",
    `Preset: ${request.preset.label}`,
    `Goal: ${request.preset.goal}`,
    request.preset.systemInstructions ? `Execution instructions:\n${request.preset.systemInstructions}` : "",
    inlineInstruction ? `User instruction:\n${inlineInstruction}` : "",
    buildContextBlock(request),
    request.kind === "terminal" ? buildTerminalSchemaBlock() : buildSchemaBlock()
  ]
    .filter(Boolean)
    .join("\n\n");
};
