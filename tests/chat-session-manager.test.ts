import test from "node:test";
import assert from "node:assert/strict";
import { ChatSessionManager } from "../src/core/chat-session-manager";
import type { ContextSnapshot, TmdState } from "../src/core/types";

const context: ContextSnapshot = {
  vaultPath: "/vaults/test",
  filePath: "Note.md",
  noteTitle: "Note",
  documentText: "alpha\n",
  selection: null
};

const createWindowStub = () => ({
  setTimeout,
  clearTimeout
});

test("structured chat change results do not keep raw JSON as message text", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = createWindowStub();

  try {
    const pluginStub = {
      saveChatState: async () => {}
    };

    const manager = new ChatSessionManager(pluginStub as never);
    const { conversation } = manager.appendUserPrompt("加到文档开头", context);
    manager.createAssistantTurn(conversation.id, "task-1");

    const state: TmdState = {
      currentTaskId: null,
      tasks: [
        {
          id: "task-1",
          kind: "chat",
          preset: {
            id: "default",
            label: "@ante",
            goal: "Discuss the current Markdown content before editing anything.",
            systemInstructions: "Prefer answering directly unless the user asks for file changes."
          },
          triggerSource: "chat",
          inlineInstruction: "加到文档开头",
          context,
          status: "awaiting-apply",
          logs: [],
          stdoutText:
            '{"type":"change","operation":"replace-file","targetPath":"Note.md","afterText":"prompt leaked into note"}',
          artifacts: [
            {
              id: "artifact-1",
              title: "Add header block",
              operation: "replace-file",
              target: {
                type: "file",
                path: "Note.md"
              },
              beforeText: "alpha\n",
              afterText: "beta\nalpha\n",
              sourceChanges: [],
              applyState: "pending"
            }
          ],
          startedAt: "2026-03-29T00:00:00.000Z",
          endedAt: "2026-03-29T00:00:01.000Z"
        }
      ]
    };

    manager.syncFromTaskState(state);

    const snapshot = manager.getSnapshot();
    const messages = snapshot.messagesByConversation[conversation.id] ?? [];
    const assistant = messages.find((message) => message.role === "assistant");

    assert.ok(assistant);
    assert.equal(assistant?.status, "awaiting-apply");
    assert.equal(assistant?.text, "");
    assert.deepEqual(assistant?.runtime?.artifactIds, ["artifact-1"]);
  } finally {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

test("streaming structured chat payloads do not show raw JSON envelope", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = createWindowStub();

  try {
    const pluginStub = {
      saveChatState: async () => {}
    };

    const manager = new ChatSessionManager(pluginStub as never);
    const { conversation } = manager.appendUserPrompt("改写成 JSON", context);
    manager.createAssistantTurn(conversation.id, "task-1");

    manager.syncFromTaskState({
      currentTaskId: null,
      tasks: [
        {
          id: "task-1",
          kind: "chat",
          preset: {
            id: "default",
            label: "@ante",
            goal: "Discuss the current Markdown content before editing anything.",
            systemInstructions: "Prefer answering directly unless the user asks for file changes."
          },
          triggerSource: "chat",
          inlineInstruction: "改写成 JSON",
          context,
          status: "running",
          logs: [],
          stdoutText: '{"type":"changes","changes":[{"operation":"replace-file","targetPath":"Note.md","afterText":"beta"}]}',
          artifacts: [],
          startedAt: "2026-03-29T00:00:00.000Z"
        }
      ]
    });

    const snapshot = manager.getSnapshot();
    const messages = snapshot.messagesByConversation[conversation.id] ?? [];
    const assistant = messages.find((message) => message.role === "assistant");

    assert.ok(assistant);
    assert.equal(assistant?.status, "streaming");
    assert.equal(assistant?.text, "");
  } finally {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

test("streaming structured text payloads show inner text without the JSON envelope", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = createWindowStub();

  try {
    const pluginStub = {
      saveChatState: async () => {}
    };

    const manager = new ChatSessionManager(pluginStub as never);
    const { conversation } = manager.appendUserPrompt("继续写", context);
    manager.createAssistantTurn(conversation.id, "task-1");

    manager.syncFromTaskState({
      currentTaskId: null,
      tasks: [
        {
          id: "task-1",
          kind: "chat",
          preset: {
            id: "default",
            label: "@ante",
            goal: "Discuss the current Markdown content before editing anything.",
            systemInstructions: "Prefer answering directly unless the user asks for file changes."
          },
          triggerSource: "chat",
          inlineInstruction: "继续写",
          context,
          status: "running",
          logs: [],
          stdoutText: '{"type":"text","text":"第一行\\n第二',
          artifacts: [],
          startedAt: "2026-03-29T00:00:00.000Z"
        }
      ]
    });

    const snapshot = manager.getSnapshot();
    const messages = snapshot.messagesByConversation[conversation.id] ?? [];
    const assistant = messages.find((message) => message.role === "assistant");

    assert.ok(assistant);
    assert.equal(assistant?.status, "streaming");
    assert.equal(assistant?.text, "第一行\n第二");
  } finally {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

test("full process logs mode does not break structured text extraction in chat", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = createWindowStub();

  try {
    const pluginStub = {
      saveChatState: async () => {},
      shouldShowFullProcessLogs: () => true
    };

    const manager = new ChatSessionManager(pluginStub as never);
    const { conversation } = manager.appendUserPrompt("继续写", context);
    manager.createAssistantTurn(conversation.id, "task-1");

    manager.syncFromTaskState({
      currentTaskId: null,
      tasks: [
        {
          id: "task-1",
          kind: "chat",
          preset: {
            id: "default",
            label: "@ante",
            goal: "Discuss the current Markdown content before editing anything.",
            systemInstructions: "Prefer answering directly unless the user asks for file changes."
          },
          triggerSource: "chat",
          inlineInstruction: "继续写",
          context,
          status: "running",
          logs: [],
          stdoutText: '{"type":"text","text":"第一行\\n第二"}',
          artifacts: [],
          startedAt: "2026-03-29T00:00:00.000Z"
        }
      ]
    });

    const snapshot = manager.getSnapshot();
    const messages = snapshot.messagesByConversation[conversation.id] ?? [];
    const assistant = messages.find((message) => message.role === "assistant");

    assert.ok(assistant);
    assert.equal(assistant?.status, "streaming");
    assert.equal(assistant?.text, "第一行\n第二");
  } finally {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

test("persisted chat state retains artifact snapshots for old conversations", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = createWindowStub();

  try {
    const pluginStub = {
      saveChatState: async () => {}
    };

    const manager = new ChatSessionManager(pluginStub as never);
    const { conversation } = manager.appendUserPrompt("加到文档开头", context);
    manager.createAssistantTurn(conversation.id, "task-1");

    manager.syncFromTaskState({
      currentTaskId: null,
      tasks: [
        {
          id: "task-1",
          kind: "chat",
          preset: {
            id: "default",
            label: "@ante",
            goal: "Discuss the current Markdown content before editing anything.",
            systemInstructions: "Prefer answering directly unless the user asks for file changes."
          },
          triggerSource: "chat",
          inlineInstruction: "加到文档开头",
          context,
          status: "awaiting-apply",
          logs: [],
          stdoutText: "",
          artifacts: [
            {
              id: "artifact-1",
              title: "Add header block",
              operation: "replace-file",
              target: {
                type: "file",
                path: "Note.md"
              },
              beforeText: "alpha\n",
              afterText: "beta\nalpha\n",
              sourceChanges: [],
              applyState: "pending"
            }
          ],
          startedAt: "2026-03-29T00:00:00.000Z",
          endedAt: "2026-03-29T00:00:01.000Z"
        }
      ]
    });

    const persisted = (manager as any).serialize();
    const restored = new ChatSessionManager(pluginStub as never, persisted);
    const snapshot = restored.getSnapshot();
    const messages = snapshot.messagesByConversation[conversation.id] ?? [];
    const assistant = messages.find((message) => message.role === "assistant");

    assert.ok(assistant?.runtime?.artifacts);
    assert.equal(assistant?.runtime?.artifacts?.length, 1);
    assert.equal(assistant?.runtime?.artifacts?.[0]?.id, "artifact-1");
    assert.equal(assistant?.runtime?.artifacts?.[0]?.afterText, "beta\nalpha\n");
  } finally {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});
