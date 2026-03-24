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
    'For multiple document changes use: {"type":"changes","changes":[{"operation":"replace-selection|append-block|replace-file|create-file","targetPath":"optional/path.md","afterText":"...","title":"optional","summary":"optional"}]}',
    "Rules:",
    "- replace-selection: afterText is the replacement text for the current selection.",
    "- append-block: afterText is the Markdown block to append to the current file unless targetPath is provided.",
    "- replace-file: afterText is the full file contents.",
    "- create-file: targetPath is required and afterText is the full new file contents.",
    "- Do not wrap the JSON in code fences.",
    "- Do not emit explanations before or after the JSON."
  ].join("\n");

const buildTerminalPriorityBlock = (): string =>
  [
    "Context priority for terminal requests:",
    "- Treat the provided current note content as the primary source of truth.",
    "- If selected text is present and the user is asking about that selection, use the selection first.",
    "- Do not search the workspace, open other files, or call tools when the answer can be completed from the provided note or selection.",
    "- For requests like 'summarize the current markdown note', summarize only the current note content shown below.",
    "- If the provided context is insufficient, say what is missing and only then consider other files or tools."
  ].join("\n");

const buildTerminalSchemaBlock = (): string =>
  [
    "For terminal-style answers, reply with plain terminal text only.",
    'Only when you intend to modify Markdown, return exactly one JSON object: {"type":"change","operation":"replace-selection|append-block|replace-file|create-file","targetPath":"optional/path.md","afterText":"...","title":"optional","summary":"optional"}',
    'For multiple Markdown changes, return exactly one JSON object: {"type":"changes","changes":[{"operation":"replace-selection|append-block|replace-file|create-file","targetPath":"optional/path.md","afterText":"...","title":"optional","summary":"optional"}]}',
    "Rules:",
    "- Follow the context priority block above before considering anything else.",
    "- If the current note or selection already contains what you need, answer from that context alone.",
    "- Only inspect other files or use tools when the user explicitly asks for that or the provided context is missing and insufficient.",
    "- When the user asks to create or update Markdown files, do not use Bash, Write, or other tools to modify files directly. Return change JSON instead so Tmd can show artifacts and git diff.",
    "- If more than one Markdown file must be created or updated, return a single changes JSON object containing every change.",
    "- Plain terminal text must not be wrapped in JSON or code fences.",
    "- change JSON must not be wrapped in code fences.",
    "- replace-selection: afterText is the replacement text for the current selection.",
    "- append-block: afterText is the Markdown block to append to the current file unless targetPath is provided.",
    "- replace-file: afterText is the full file contents.",
    "- create-file: targetPath is required and afterText is the full new file contents."
  ].join("\n");

const buildTerminalContextBlock = (request: TaskRequest): string => {
  if (request.reusePriorContext) {
    return [
      request.context.filePath ? `Current note path: ${request.context.filePath}` : "Current note path: <unchanged>",
      "Current note context is unchanged from the previous turn.",
      "Reuse the same selected text and note content already established in this Ante session."
    ].join("\n\n");
  }

  const lines: string[] = [];
  if (request.context.filePath) {
    lines.push(`Current note path: ${request.context.filePath}`);
  }
  const selection = request.context.selection?.text?.trim();
  if (selection) {
    lines.push(`Selected text (use first for selection-specific requests):\n${selection}`);
  } else {
    lines.push("Selected text: <none>");
  }
  const documentText = request.context.documentText?.trim();
  if (documentText) {
    lines.push(`Current note content (authoritative for note summaries and note-level questions):\n${documentText}`);
  } else {
    lines.push("Current note content: <empty>");
  }
  return lines.join("\n\n");
};

export const buildInteractivePrompt = (request: TaskRequest): string => {
  const inlineInstruction = request.inlineInstruction.trim();
  const followUpPrompt = request.followUpPrompt?.trim() ?? "";

  if (request.mode === "followup") {
    if (request.kind === "terminal") {
      return [followUpPrompt, "", buildTerminalPriorityBlock(), "", buildTerminalContextBlock(request), "", buildTerminalSchemaBlock()]
        .filter(Boolean)
        .join("\n\n");
    }
    return [followUpPrompt, "", buildSchemaBlock()].filter(Boolean).join("\n");
  }

  if (request.kind === "terminal") {
    return [inlineInstruction, "", buildTerminalPriorityBlock(), "", buildTerminalContextBlock(request), "", buildTerminalSchemaBlock()]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    request.kind === "console"
      ? "You are operating inside the Tmd Ante Console for an Obsidian vault."
      : "You are handling a Markdown editing task for an Obsidian note.",
    `Preset: ${request.preset.label}`,
    `Goal: ${request.preset.goal}`,
    request.preset.systemInstructions ? `Execution instructions:\n${request.preset.systemInstructions}` : "",
    inlineInstruction ? `User instruction:\n${inlineInstruction}` : "",
    buildContextBlock(request),
    buildSchemaBlock()
  ]
    .filter(Boolean)
    .join("\n\n");
};
