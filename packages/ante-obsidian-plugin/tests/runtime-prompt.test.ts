import test from "node:test";
import assert from "node:assert/strict";
import { buildInteractivePrompt } from "../src/core/runtime-prompt";
import type { TaskRequest } from "../src/core/types";

const terminalRequest = (overrides: Partial<TaskRequest> = {}): TaskRequest => ({
  taskId: "task-terminal-1",
  kind: "terminal",
  triggerSource: "terminal",
  preset: {
    id: "default",
    label: "@ante",
    goal: "Handle the current Markdown content directly and choose the lightest useful operation.",
    systemInstructions: "Prefer a direct document edit when the requested outcome is concrete.",
  },
  context: {
    vaultPath: "/vaults/workspace",
    filePath: "20260321 list.md",
    noteTitle: "20260321 list",
    documentText: "# Tasks\n\n- clean desk\n- empty trash\n",
    selection: null,
  },
  inlineInstruction: "在文档最后添加一句话总结",
  ...overrides,
});

const chatRequest = (overrides: Partial<TaskRequest> = {}): TaskRequest => ({
  taskId: "task-chat-1",
  kind: "chat",
  triggerSource: "chat",
  preset: {
    id: "default",
    label: "@ante",
    goal: "Discuss the current Markdown content before editing anything.",
    systemInstructions: "Prefer a direct document edit when the requested outcome is concrete.",
  },
  context: {
    vaultPath: "/vaults/personal",
    filePath: "Inbox.md",
    noteTitle: "Inbox",
    documentText: "# Inbox\n\n- follow up with design team\n",
    selection: null,
  },
  inlineInstruction: "What should I do next?",
  ...overrides,
});

const documentRequest = (overrides: Partial<TaskRequest> = {}): TaskRequest => ({
  taskId: "task-document-1",
  kind: "document",
  triggerSource: "mention",
  preset: {
    id: "default",
    label: "@ante",
    goal: "Handle the current Markdown content directly and choose the lightest useful operation.",
    systemInstructions: "Prefer a direct document edit when the requested outcome is concrete.",
  },
  context: {
    vaultPath: "/vaults/personal",
    filePath: "Draft.md",
    noteTitle: "Draft",
    documentText: "# Draft\n\nThis paragraph needs polish.\n",
    selection: {
      text: "This paragraph needs polish.",
      from: { line: 2, ch: 0 },
      to: { line: 2, ch: 28 },
    },
  },
  inlineInstruction: "Make this clearer.",
  ...overrides,
});

test("terminal prompt prioritizes provided note context over workspace search", () => {
  const prompt = buildInteractivePrompt(terminalRequest());

  assert.match(prompt, /Current note content/i);
  assert.match(prompt, /primary source of truth/i);
  assert.match(prompt, /Do not search the workspace/i);
  assert.match(prompt, /summarize only the current note content shown below/i);
  assert.match(prompt, /Current Obsidian vault path: \/vaults\/workspace/);
  assert.match(prompt, /analyze the document in relation to the surrounding vault structure/i);
  assert.match(prompt, /20260321 list\.md/);
  assert.match(prompt, /clean desk/);
});

test("terminal prompt requires native file-editing tools for multiple markdown file edits", () => {
  const prompt = buildInteractivePrompt(
    terminalRequest({ inlineInstruction: "Create two markdown files." }),
  );

  assert.match(prompt, /prefer native file-editing tools/i);
  assert.match(prompt, /multiple native file-editing tool calls/i);
  assert.match(prompt, /use native file-editing tools first/i);
  assert.doesNotMatch(prompt, /fallback json/i);
});

test("terminal prompt includes Obsidian CLI guidance when available", () => {
  const prompt = buildInteractivePrompt(
    terminalRequest({
      obsidianCliPromptBlock:
        "Obsidian CLI is available in this session.\nReference: https://obsidian.md/zh/cli",
    }),
  );

  assert.match(prompt, /Obsidian CLI is available in this session\./);
  assert.match(prompt, /https:\/\/obsidian\.md\/zh\/cli/);
});

test("chat prompt uses the chat-specific framing and includes note context", () => {
  const prompt = buildInteractivePrompt(chatRequest());

  assert.match(prompt, /Chat with Ante in an Obsidian vault/i);
  assert.match(prompt, /Preset: @ante/);
  assert.match(prompt, /Chat response rules:/);
  assert.match(prompt, /Do not create or modify files unless the user clearly asks/i);
  assert.match(prompt, /User instruction:\nWhat should I do next\?/);
  assert.match(prompt, /Current Obsidian vault path: \/vaults\/personal/);
  assert.match(prompt, /folder organization, and nearby documentation context/i);
  assert.match(prompt, /Current note path: Inbox\.md/);
  assert.match(prompt, /follow up with design team/);
  assert.doesNotMatch(prompt, /Execution instructions:/);
  assert.doesNotMatch(prompt, /Prefer a direct document edit when the requested outcome is concrete/);
});

test("chat follow-up prompt still includes the latest note context", () => {
  const prompt = buildInteractivePrompt(
    chatRequest({
      mode: "followup",
      followUpPrompt: "Use the newly opened note instead.",
      context: {
        vaultPath: "/vaults/personal",
        filePath: "Projects/Today.md",
        noteTitle: "Today",
        documentText: "# Today\n\n- sync plugin chat context\n",
        selection: {
          text: "sync plugin chat context",
          from: { line: 2, ch: 2 },
          to: { line: 2, ch: 26 },
        },
      },
    }),
  );

  assert.match(prompt, /Chat with Ante in an Obsidian vault/i);
  assert.match(prompt, /Preset: @ante/);
  assert.match(prompt, /Follow-up user instruction:\nUse the newly opened note instead\./);
  assert.match(prompt, /Use the newly opened note instead\./);
  assert.match(prompt, /Current Obsidian vault path: \/vaults\/personal/);
  assert.match(prompt, /Current note path: Projects\/Today\.md/);
  assert.match(prompt, /Selected text:\nsync plugin chat context/);
  assert.match(prompt, /Current note content:\n# Today/);
  assert.match(prompt, /Chat response rules:/);
  assert.match(prompt, /Do not create or modify files unless the user clearly asks/i);
  assert.doesNotMatch(prompt, /fallback JSON object/i);
  assert.match(
    prompt,
    /Do not emit JSON envelopes such as type=text, type=change, or type=changes\./,
  );
});

test("inline prompt keeps edit-specific preset instructions and scope rules", () => {
  const prompt = buildInteractivePrompt(documentRequest());

  assert.match(prompt, /inline Markdown editing task for an Obsidian note/i);
  assert.match(prompt, /Execution instructions:/);
  assert.match(prompt, /Prefer a direct document edit when the requested outcome is concrete/);
  assert.match(prompt, /User instruction:\nMake this clearer\./);
  assert.match(prompt, /<obsidian_context>/);
  assert.match(prompt, /Selected text:\nThis paragraph needs polish\./);
  assert.match(prompt, /Inline Markdown edit rules:/);
  assert.match(prompt, /use the selection as the default edit scope/i);
  assert.match(prompt, /Only rewrite the whole note when the user clearly asks/i);
  assert.match(prompt, /Use native file-editing tools when the user asks to create or modify Markdown files\./);
});
