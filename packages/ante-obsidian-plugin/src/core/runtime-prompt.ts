import type { TaskRequest } from "./types";

const formatCursor = (request: TaskRequest): string | null => {
  const selection = request.context.selection;
  if (!selection) {
    return null;
  }
  if (selection.from.line !== selection.to.line || selection.from.ch !== selection.to.ch) {
    return null;
  }
  return `Current cursor position: line ${selection.from.line + 1}, ch ${selection.from.ch + 1}`;
};

const buildContextBlock = (request: TaskRequest): string => {
  const vaultPath = request.context.vaultPath?.trim() ?? "";
  const selection = request.context.selection?.text?.trim() ?? "";
  const documentText = request.context.documentText?.trim() ?? "";
  const notePath = request.context.filePath ?? "Untitled.md";
  const cursor = formatCursor(request);

  const lines = [
    vaultPath
      ? `Current Obsidian vault path: ${vaultPath}`
      : "Current Obsidian vault path: <unknown>",
    `Current note path: ${notePath}`,
    selection ? `Selected text:\n${selection}` : "Selected text: <none>",
    cursor ?? "",
    documentText ? `Current note content:\n${documentText}` : "Current note content: <empty>",
  ].filter(Boolean);

  return ["<obsidian_context>", ...lines, "</obsidian_context>"].join("\n\n");
};

const buildVaultAnalysisBlock = (): string =>
  [
    "You may use the current Obsidian vault path and note path to analyze the document in relation to the surrounding vault structure.",
    "When useful, infer how this note fits within the vault, folder organization, and nearby documentation context based on those paths.",
  ].join("\n");

const buildObsidianCliBlock = (request: TaskRequest): string =>
  request.obsidianCliPromptBlock?.trim() ?? "";

const buildInlineEditRulesBlock = (): string =>
  [
    "Inline Markdown edit rules:",
    "- Treat this request as a direct edit against the current Obsidian note.",
    "- If selected text is present, use the selection as the default edit scope.",
    "- If there is no selected text and a cursor position is provided, apply the request near that cursor or the current paragraph.",
    "- Only rewrite the whole note when the user clearly asks for note-level changes.",
    "Use native file-editing tools when the user asks to create or modify Markdown files.",
    "Prefer Read plus Write/Edit so the host can capture approval details and render diffs from real file contents.",
    "Prefer Write over Edit when appending at the end of a note or when the old_string would be ambiguous, repeated, or consist mostly of whitespace/newlines.",
    "When editing an existing note, preserve all unchanged content and only modify the requested location.",
    "After using native file-editing tools, reply with a short plain-text confirmation.",
    "Do not emit JSON envelopes such as type=text, type=change, or type=changes.",
    "If the edit cannot be completed with the available native tools, explain the limitation in plain text instead of emitting JSON.",
    "Rules:",
    "- Use Read before Write/Edit when the current file contents may have changed or when the target path is ambiguous.",
    "- Keep edits scoped to the requested file and location.",
    "- Never copy the prompt instructions, schema text, or context labels into file content.",
    "- Do not wrap normal replies in code fences unless the user asked for a code block.",
  ].join("\n");

const buildChatAnswerRulesBlock = (): string =>
  [
    "Chat response rules:",
    "- Answer directly from the provided Obsidian context when possible.",
    "- Do not create or modify files unless the user clearly asks you to write, edit, create, replace, append, or reorganize note content.",
    "- If the user asks for Markdown file changes, use native file-editing tools and keep the final reply short.",
    "- If the provided context is insufficient, say what is missing before considering other files or tools.",
    "- Do not emit JSON envelopes such as type=text, type=change, or type=changes.",
    "- Do not wrap normal replies in code fences unless the user asked for a code block.",
  ].join("\n");

const buildTerminalPriorityBlock = (): string =>
  [
    "Context priority for terminal requests:",
    "- Treat the provided current note content as the primary source of truth.",
    "- If selected text is present and the user is asking about that selection, use the selection first.",
    "- Do not search the workspace, open other files, or call tools when the answer can be completed from the provided note or selection.",
    "- For requests like 'summarize the current markdown note', summarize only the current note content shown below.",
    "- If the provided context is insufficient, say what is missing and only then consider other files or tools.",
  ].join("\n");

const buildTerminalSchemaBlock = (): string =>
  [
    "For terminal-style answers, reply with plain terminal text unless you need to modify Markdown files.",
    "For Markdown edits, prefer native file-editing tools so the host can capture a real diff preview.",
    "Prefer Write over Edit when appending at the end of a note or when the old_string would be ambiguous, repeated, or consist mostly of whitespace/newlines.",
    "After using native file-editing tools, reply with short plain text.",
    "Do not emit JSON envelopes such as type=text, type=change, or type=changes.",
    "If native file-editing tools are unavailable, explain the limitation in plain text.",
    "Rules:",
    "- Follow the context priority block above before considering anything else.",
    "- If the current note or selection already contains what you need, answer from that context alone.",
    "- Only inspect other files or use tools when the user explicitly asks for that or the provided context is missing and insufficient.",
    "- When the user asks to create or update Markdown files, use native file-editing tools first and keep edits scoped to the requested file and location.",
    "- If more than one Markdown file must be created or updated, use multiple native file-editing tool calls rather than JSON.",
    "- Plain terminal text must not be wrapped in JSON or code fences.",
  ].join("\n");

const buildTerminalContextBlock = (request: TaskRequest): string => {
  if (request.reusePriorContext) {
    return [
      request.context.filePath
        ? `Current note path: ${request.context.filePath}`
        : "Current note path: <unchanged>",
      "Current note context is unchanged from the previous turn.",
      "Reuse the same selected text and note content already established in this Ante session.",
    ].join("\n\n");
  }

  const lines: string[] = [];
  if (request.context.vaultPath) {
    lines.push(`Current Obsidian vault path: ${request.context.vaultPath}`);
  } else {
    lines.push("Current Obsidian vault path: <unknown>");
  }
  if (request.context.filePath) {
    lines.push(`Current note path: ${request.context.filePath}`);
  }
  const selection = request.context.selection?.text?.trim();
  if (selection) {
    lines.push(`Selected text (use first for selection-specific requests):\n${selection}`);
  } else {
    lines.push("Selected text: <none>");
  }
  const cursor = formatCursor(request);
  if (cursor) {
    lines.push(cursor);
  }
  const documentText = request.context.documentText?.trim();
  if (documentText) {
    lines.push(
      `Current note content (authoritative for note summaries and note-level questions):\n${documentText}`,
    );
  } else {
    lines.push("Current note content: <empty>");
  }
  return lines.join("\n\n");
};

const buildChatPrompt = (
  request: TaskRequest,
  instructionLabel: "User instruction" | "Follow-up user instruction",
  instruction: string,
): string =>
  [
    "You are operating inside Chat with Ante in an Obsidian vault.",
    `Preset: ${request.preset.label}`,
    `Goal: ${request.preset.goal}`,
    instruction ? `${instructionLabel}:\n${instruction}` : "",
    buildObsidianCliBlock(request),
    buildVaultAnalysisBlock(),
    buildContextBlock(request),
    buildChatAnswerRulesBlock(),
  ]
    .filter(Boolean)
    .join("\n\n");

const buildInlinePrompt = (request: TaskRequest, inlineInstruction: string): string =>
  [
    "You are handling an inline Markdown editing task for an Obsidian note.",
    `Preset: ${request.preset.label}`,
    `Goal: ${request.preset.goal}`,
    request.preset.systemInstructions
      ? `Execution instructions:\n${request.preset.systemInstructions}`
      : "",
    inlineInstruction ? `User instruction:\n${inlineInstruction}` : "",
    buildObsidianCliBlock(request),
    buildVaultAnalysisBlock(),
    buildContextBlock(request),
    buildInlineEditRulesBlock(),
  ]
    .filter(Boolean)
    .join("\n\n");

export const buildInteractivePrompt = (request: TaskRequest): string => {
  const inlineInstruction = request.inlineInstruction.trim();
  const followUpPrompt = request.followUpPrompt?.trim() ?? "";

  if (request.mode === "followup") {
    if (request.kind === "terminal") {
      return [
        followUpPrompt,
        "",
        buildTerminalPriorityBlock(),
        "",
        buildObsidianCliBlock(request),
        "",
        buildTerminalContextBlock(request),
        "",
        buildTerminalSchemaBlock(),
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    return buildChatPrompt(request, "Follow-up user instruction", followUpPrompt);
  }

  if (request.kind === "terminal") {
    return [
      inlineInstruction,
      "",
      buildTerminalPriorityBlock(),
      "",
      buildObsidianCliBlock(request),
      "",
      buildVaultAnalysisBlock(),
      "",
      buildTerminalContextBlock(request),
      "",
      buildTerminalSchemaBlock(),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (request.kind === "chat") {
    return buildChatPrompt(request, "User instruction", inlineInstruction);
  }

  return buildInlinePrompt(request, inlineInstruction);
};
