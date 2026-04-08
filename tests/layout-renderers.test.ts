import test from "node:test"
import assert from "node:assert/strict"
import { button, div, span, textarea } from "../src/obsidian/dom-factory"
import { renderChatLayout } from "../src/obsidian/chat-layout-renderer"
import { renderTerminalLayout } from "../src/obsidian/terminal-layout-renderer"
import { FakeElement } from "./helpers/fake-dom"

test("dom factory appends lightweight element factories to a parent", () => {
  const root = new FakeElement()
  const shell = div({ cls: "shell" }).appendTo(root as unknown as HTMLElement)
  const action = button({ cls: "action", text: "Run" }).appendTo(shell)
  const icon = span({ cls: "icon", text: "*" }).appendTo(action)
  const input = textarea({ cls: "input" }).appendTo(shell)

  assert.equal(shell.className, "shell")
  assert.equal(action.textContent, "Run")
  assert.equal(icon.className, "icon")
  assert.equal(input.tagName, "textarea")
})

test("renderChatLayout creates the reusable chat shell skeleton", () => {
  const root = new FakeElement()
  const layout = renderChatLayout(root as unknown as HTMLElement)

  assert.equal(layout.shellEl.className, "tmd-chat-shell")
  assert.equal(layout.sidebarEl.className, "tmd-chat-sidebar")
  assert.equal(layout.timelineEl.className, "tmd-chat-timeline")
  assert.equal(layout.providerButtonEl.tagName, "button")
  assert.equal(layout.modelButtonEl.tagName, "button")
  assert.equal(layout.composerEl.tagName, "textarea")
  assert.equal(layout.composerActionButtonEl.className, "tmd-chat-primary-action")
})

test("renderTerminalLayout creates the reusable terminal shell skeleton", () => {
  const root = new FakeElement()
  const layout = renderTerminalLayout(root as unknown as HTMLElement)

  assert.equal(layout.frameEl.className, "tmd-terminal-frame")
  assert.equal(layout.statusEl.className, "tmd-terminal-status")
  assert.equal(layout.editorEl.className, "tmd-terminal-shell-editor tmd-is-empty")
  assert.equal(layout.inlineArtifactsEl.className, "tmd-terminal-inline-container")
  assert.equal(layout.stopButtonEl.className, "tmd-terminal-stop-button")
})
