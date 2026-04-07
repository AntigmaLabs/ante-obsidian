import test from "node:test"
import assert from "node:assert/strict"
import {
  buildApprovalSignature,
  renderApprovalCard,
} from "../src/obsidian/approval-card-renderer"
import {
  buildRuntimeDetailsSections,
  renderRuntimeDetails,
  shouldAutoExpandRuntimeDetails,
} from "../src/obsidian/runtime-details-renderer"
import {
  renderMissingAnteState,
  renderSimpleEmptyState,
} from "../src/obsidian/empty-state-renderer"
import { renderSettingsSection } from "../src/obsidian/settings-section-renderer"
import { FakeElement } from "./helpers/fake-dom"

test("approval card renderer preserves signature inputs and dispatches decisions", () => {
  const approval = {
    turnId: "turn-1",
    message: "Need approval",
    tools: [
      { id: "tool-1", name: "Write", argsText: "{\"path\":\"a.md\"}" },
      { id: "tool-2", name: "Read" },
    ],
  }
  const decisions: string[] = []
  const host = new FakeElement()

  const signature = buildApprovalSignature(approval)
  const signatureWithOwner = buildApprovalSignature(approval, "task-1")
  renderApprovalCard(host as unknown as HTMLElement, approval, (decision) => {
    decisions.push(decision)
  })

  assert.equal(signature, 'turn-1|Need approval|tool-1:Write:{"path":"a.md"}|tool-2:Read:')
  assert.equal(signatureWithOwner, 'task-1|turn-1|Need approval|tool-1:Write:{"path":"a.md"}|tool-2:Read:')
  const buttons = host.findByTag("button")
  assert.equal(buttons.length, 3)
  buttons[0]?.click()
  buttons[1]?.click()
  buttons[2]?.click()
  assert.deepEqual(decisions, ["Accept", "AcceptForSession", "Skip"])
})

test("runtime details renderer builds sections and expands for active telemetry", () => {
  const sections = buildRuntimeDetailsSections(
    {
      compacting: true,
      thinkingText: "draft answer",
      usage: { promptTokens: 12, completionTokens: 6, totalTokens: 18 },
      lastInfo: {
        level: "info",
        timestamp: "2026-04-07T10:00:00.000Z",
        message: "Compacting",
      },
      timeline: [
        {
          kind: "compaction-start",
          timestamp: "2026-04-07T10:00:00.000Z",
          message: "Started",
        },
      ],
    },
    {
      clampPreview: (value) => value.trim(),
      formatTime: () => "10:00",
    },
  )

  assert.equal(sections.length, 3)
  assert.match(sections[0] ?? "", /usage prompt=12 completion=6 total=18/)
  assert.match(sections[1] ?? "", /^thinking\ndraft answer$/)
  assert.equal(shouldAutoExpandRuntimeDetails(true, { timeline: [], thinkingText: "x" }), true)
  assert.equal(shouldAutoExpandRuntimeDetails(false, { timeline: [], thinkingText: "x" }), false)

  const host = new FakeElement()
  const details = renderRuntimeDetails(
    host as unknown as HTMLElement,
    sections,
    true,
  ) as unknown as FakeElement
  assert.equal(details.open, true)
  assert.equal(host.findByClass("tmd-chat-runtime-block").length, 3)
})

test("empty-state and settings-section renderers keep copy and actions centralized", () => {
  const host = new FakeElement()
  let opened = 0
  let refreshed = 0

  renderMissingAnteState(host as unknown as HTMLElement, {
    className: "tmd-chat-empty",
    title: "Ante is not installed yet.",
    description: "Install Ante first.",
    onOpenSettings: () => {
      opened += 1
    },
    onRefresh: () => {
      refreshed += 1
    },
  })
  renderSimpleEmptyState(host as unknown as HTMLElement, {
    title: "No messages yet.",
    description: "Use the current note as context.",
  })
  renderSettingsSection(host as unknown as HTMLElement, {
    title: "Runtime",
    summary: "Connection and diagnostics.",
  })

  const buttons = host.findByTag("button")
  assert.equal(buttons.length, 2)
  buttons[0]?.click()
  buttons[1]?.click()
  assert.equal(opened, 1)
  assert.equal(refreshed, 1)
  assert.match(host.allText, /Ante is not installed yet\./)
  assert.match(host.allText, /No messages yet\./)
  assert.equal(host.findByClass("tmd-settings-section").length, 1)
  assert.equal(host.findByClass("tmd-settings-section")[0]?.dataset.sectionTitle, "Runtime")
})
