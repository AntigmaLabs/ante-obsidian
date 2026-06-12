import test from "node:test";
import assert from "node:assert/strict";
import { wireChatComposer, wireChatSidebar } from "../src/obsidian/chat-shell-wiring";
import { wireTerminalPrompt } from "../src/obsidian/terminal-shell-wiring";
import { FakeElement } from "./helpers/fake-dom";

class FakeEvent {
  key = "";
  keyCode = 0;
  shiftKey = false;
  ctrlKey = false;
  metaKey = false;
  altKey = false;
  isComposing = false;
  defaultPrevented = false;

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

test("wireChatSidebar routes toggle and new-chat actions", () => {
  const toggle = new FakeElement("button");
  const create = new FakeElement("button");
  let toggled = 0;
  let created = 0;

  wireChatSidebar({
    sidebarToggleEl: toggle as unknown as HTMLButtonElement,
    newChatButtonEl: create as unknown as HTMLButtonElement,
    onToggleSidebar: () => {
      toggled += 1;
    },
    onCreateChat: () => {
      created += 1;
    },
  });

  toggle.click();
  create.click();
  assert.equal(toggled, 1);
  assert.equal(created, 1);
});

test("wireChatComposer submits on enter and stops when action is stop", () => {
  const composer = new FakeElement("textarea");
  const action = new FakeElement("button");
  let composing = false;
  let submitted = 0;
  let stopped = 0;

  wireChatComposer({
    composerEl: composer as unknown as HTMLTextAreaElement,
    composerActionButtonEl: action as unknown as HTMLButtonElement,
    getIsComposing: () => composing,
    setIsComposing: (value) => {
      composing = value;
    },
    onInput: () => {},
    onSubmit: () => {
      submitted += 1;
    },
    onStop: () => {
      stopped += 1;
    },
  });
  (composer as unknown as { dispatch: (type: string, event: FakeEvent) => void }).dispatch(
    "keydown",
    Object.assign(new FakeEvent(), { key: "Enter", keyCode: 13 }),
  );
  action.click();
  action.dataset.action = "stop";
  action.click();

  assert.equal(submitted, 2);
  assert.equal(stopped, 1);
});

test("wireTerminalPrompt routes history, submit, and stop shortcuts", () => {
  const editor = new FakeElement("div", {
    cls: "tmd-terminal-shell-editor tmd-is-empty",
  });
  const stop = new FakeElement("button");
  let composing = false;
  let stopped = 0;
  let submitted = 0;
  const history: string[] = [];

  wireTerminalPrompt({
    editorEl: editor as unknown as HTMLDivElement,
    stopButtonEl: stop as unknown as HTMLButtonElement,
    getEditorText: () => "prompt",
    getIsComposing: () => composing,
    setIsComposing: (value) => {
      composing = value;
    },
    getHasRunningTask: () => true,
    onDraftChange: () => {},
    onStop: () => {
      stopped += 1;
    },
    onSubmit: () => {
      submitted += 1;
    },
    onNavigateHistory: (direction) => {
      history.push(direction);
    },
  });
  (editor as unknown as { dispatch: (type: string, event: FakeEvent) => void }).dispatch(
    "keydown",
    Object.assign(new FakeEvent(), { key: "ArrowUp", keyCode: 38 }),
  );
  (editor as unknown as { dispatch: (type: string, event: FakeEvent) => void }).dispatch(
    "keydown",
    Object.assign(new FakeEvent(), { key: "Enter", keyCode: 13 }),
  );
  (editor as unknown as { dispatch: (type: string, event: FakeEvent) => void }).dispatch(
    "keydown",
    Object.assign(new FakeEvent(), { key: "c", ctrlKey: true }),
  );
  stop.click();

  assert.deepEqual(history, ["up"]);
  assert.equal(submitted, 1);
  assert.equal(stopped, 2);
});
