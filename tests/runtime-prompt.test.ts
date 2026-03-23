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
    systemInstructions: "Prefer a direct document edit when the requested outcome is concrete."
  },
  context: {
    filePath: "20260321 list.md",
    noteTitle: "20260321 list",
    documentText: "# Tasks\n\n- clean desk\n- empty trash\n",
    selection: null
  },
  inlineInstruction: "在文档最后添加一句话总结",
  ...overrides
});

test("terminal prompt prioritizes provided note context over workspace search", () => {
  const prompt = buildInteractivePrompt(terminalRequest());

  assert.match(prompt, /Current note content/i);
  assert.match(prompt, /primary source of truth/i);
  assert.match(prompt, /Do not search the workspace/i);
  assert.match(prompt, /summarize only the current note content shown below/i);
  assert.match(prompt, /20260321 list\.md/);
  assert.match(prompt, /clean desk/);
});

test("terminal prompt requires batched change JSON for multiple markdown file edits", () => {
  const prompt = buildInteractivePrompt(terminalRequest({ inlineInstruction: "Create two markdown files." }));

  assert.match(prompt, /For multiple Markdown changes/);
  assert.match(prompt, /"type":"changes"/);
  assert.match(prompt, /do not use Bash, Write, or other tools to modify files directly/i);
});
