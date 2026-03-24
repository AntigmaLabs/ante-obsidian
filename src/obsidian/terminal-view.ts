import { ItemView, Notice, WorkspaceLeaf } from "obsidian"
import { handleError } from "./utils"
import type TmdPlugin from "./main"
import type {
  ContextSnapshot,
  RuntimeApprovalDecision,
  TaskRecord,
  TmdState,
} from "../core/types"
import { formatLoadingLabel } from "../core/loading-label"
import {
  navigatePromptHistory as computePromptHistoryNavigation,
  shouldHandlePromptEnter,
  shouldStopFromPromptShortcut,
} from "../core/terminal-input"
import {
  renderArtifactDiff,
  renderDiffSummary,
  resolveArtifactDiffs,
  type ResolvedArtifactDiff,
} from "./diff-block"

export const TMD_TERMINAL_VIEW_TYPE = "tmd-terminal-view"

type TerminalRow =
  | { key: string; kind: "command"; text: string; timestamp: string }
  | { key: string; kind: "output"; text: string; timestamp: string }
  | { key: string; kind: "streaming"; text: string; timestamp: string }
  | { key: string; kind: "process"; text: string; timestamp: string }
  | { key: string; kind: "system"; text: string; timestamp: string }
  | { key: string; kind: "error"; text: string; timestamp: string }
  | { key: string; kind: "artifact"; text: string; timestamp: string }
  | { key: string; kind: "loading"; text: string; timestamp: string }

const EMPTY_ROW_KEY = "terminal-empty"
const MAX_TERMINAL_PREVIEW_CHARS = 12000
const MAX_TERMINAL_PREVIEW_LINES = 160

const hasContextDispatchLog = (task: TaskRecord): boolean =>
  task.logs.some(
    (log) =>
      log.stream === "system" &&
      (/^Sending Markdown context\b/.test(log.text) ||
        /^Sending context reference\b/.test(log.text)),
  )

const hasTurnActivityLog = (task: TaskRecord): boolean =>
  task.logs.some(
    (log) =>
      log.stream === "system" &&
      (/^Ante TurnStart\b/.test(log.text) ||
        /^Ante ToolStart\b/.test(log.text) ||
        /^Ante ToolUpdate\b/.test(log.text) ||
        /^Ante ToolEnd\b/.test(log.text) ||
        /^Ante TurnPause\b/.test(log.text)),
  )

const hasStdoutLog = (task: TaskRecord): boolean =>
  task.stdoutText.trim().length > 0

const loadingLabelForTask = (task: TaskRecord, frameIndex: number): string => {
  if (!task.runtimeSession?.sessionId) {
    return "booting ante"
  }
  if (
    hasContextDispatchLog(task) &&
    !hasTurnActivityLog(task) &&
    !hasStdoutLog(task)
  ) {
    return "sending context"
  }
  return formatLoadingLabel(task.id, frameIndex)
}

const formatTime = (timestamp: string): string =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

const terminalStatus = (task: TaskRecord | undefined): string => {
  if (!task) {
    return "ready"
  }

  switch (task.status) {
    case "running":
      return "active"
    case "applied":
      return "done"
    case "failed":
      return "error"
    case "discarded":
      return "stopped"
    default:
      return task.status
  }
}

const terminalStatusClass = (task: TaskRecord | undefined): string => {
  const status = terminalStatus(task)
  switch (status) {
    case "active":
      return "tmd-is-running"
    case "error":
      return "tmd-is-failed"
    case "stopped":
      return "tmd-is-muted"
    default:
      return "tmd-is-completed"
  }
}

const summarizeContext = (
  context: ContextSnapshot | null | undefined,
): string => {
  if (!context?.filePath) {
    return "No Markdown context · open a note to ground the agent"
  }

  const selection = context.selection?.text?.trim()
  if (selection) {
    return `${context.filePath} · selection ${selection.length} chars`
  }

  const documentText = context.documentText?.trim() ?? ""
  return `${context.filePath} · note ${documentText.length} chars`
}

const summarizeTerminalMeta = (
  context: ContextSnapshot | null | undefined,
  runtimeSummary: { provider: string; model: string } | null,
): string => {
  const parts = [summarizeContext(context)]
  if (runtimeSummary) {
    parts.push(`${runtimeSummary.provider} · ${runtimeSummary.model}`)
  }
  return parts.join("  ·  ")
}

const NOISY_SYSTEM_PATTERNS = [
  /^Launching Ante server\b/,
  /^Reusing existing Ante session\b/,
  /^Ante TurnStart\b/,
  /^Ante ToolStart\b/,
  /^Ante ToolEnd\b/,
  /^Ante ToolUpdate\b/,
]

const shouldDisplaySystemLog = (text: string): boolean =>
  !NOISY_SYSTEM_PATTERNS.some((pattern) => pattern.test(text))

const extractRuntimeSummary = (
  task: TaskRecord | undefined,
): { provider: string; model: string } | null => {
  if (!task) {
    return null
  }
  for (const log of task.logs) {
    const match =
      /provider=([^\s·]+)\s+·\s+model=([^\s·]+)/.exec(log.text) ??
      /provider=([^\s·]+)\s+·\s+model=([^\s·]+)/.exec(
        log.text.replace(/\n/g, " "),
      )
    if (match?.[1] && match?.[2]) {
      return {
        provider: match[1],
        model: match[2],
      }
    }
  }
  return null
}

const parseJsonPayload = (value: string): unknown | null => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  const candidate = fenced ? fenced[1] : trimmed
  try {
    return JSON.parse(candidate) as unknown
  } catch {
    return null
  }
}

const extractStreamingJsonPreview = (value: string): string => {
  const candidates = [
    /"summary"\s*:\s*"((?:\\.|[^"])*)"/s,
    /"title"\s*:\s*"((?:\\.|[^"])*)"/s,
    /"afterText"\s*:\s*"((?:\\.|[^"])*)"/s,
  ]

  for (const pattern of candidates) {
    const match = pattern.exec(value)
    const raw = match?.[1]
    if (!raw) {
      continue
    }
    const normalized = raw
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\")
      .trim()
    if (normalized) {
      return normalized
    }
  }

  return ""
}

const extractPartialJsonPreview = (value: string): string => {
  const normalized = value
    .replace(/\r/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\")
    .trim()

  if (!normalized) {
    return ""
  }

  const afterTextMatch = /"afterText"\s*:\s*"([\s\S]*)$/s.exec(normalized)
  if (afterTextMatch?.[1]) {
    return afterTextMatch[1].trim()
  }

  const summaryMatch = /"summary"\s*:\s*"([\s\S]*)$/s.exec(normalized)
  if (summaryMatch?.[1]) {
    return summaryMatch[1].trim()
  }

  const titleMatch = /"title"\s*:\s*"([\s\S]*)$/s.exec(normalized)
  if (titleMatch?.[1]) {
    return titleMatch[1].trim()
  }

  return normalized
}

const clampTerminalPreview = (value: string): string => {
  const normalized = value.replace(/\r/g, "")
  if (!normalized) {
    return ""
  }

  const lines = normalized.split("\n")
  const tailLines =
    lines.length > MAX_TERMINAL_PREVIEW_LINES
      ? lines.slice(-MAX_TERMINAL_PREVIEW_LINES)
      : lines
  let preview = tailLines.join("\n")

  if (preview.length > MAX_TERMINAL_PREVIEW_CHARS) {
    preview = preview.slice(-MAX_TERMINAL_PREVIEW_CHARS)
  }

  if (preview !== normalized) {
    const omittedChars = Math.max(0, normalized.length - preview.length)
    const omittedLines = Math.max(0, lines.length - tailLines.length)
    const summary = `... truncated terminal preview (${omittedLines} lines, ${omittedChars} chars omitted) ...\n`
    preview = summary + preview
  }

  return preview.trim()
}

const analyzeOutput = (
  task: TaskRecord,
): { text: string; suppressStdout: boolean } => {
  const primaryText = task.textResult?.text.trim()
    ? task.textResult.text.trim()
    : task.stdoutText.trim()

  if (!primaryText) {
    return { text: "", suppressStdout: false }
  }

  const parsed = parseJsonPayload(primaryText)
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>
    if (
      (record.type === "text" || record.type === "terminal") &&
      typeof record.text === "string"
    ) {
      return {
        text: record.text.trim(),
        suppressStdout: Boolean(task.textResult?.text.trim()),
      }
    }
    if (record.type === "change") {
      const summary =
        typeof record.summary === "string" ? record.summary.trim() : ""
      const title = typeof record.title === "string" ? record.title.trim() : ""
      return { text: summary || title, suppressStdout: true }
    }
    if (record.type === "changes" && Array.isArray(record.changes)) {
      return {
        text: `${record.changes.length} change artifact(s) prepared.`,
        suppressStdout: true,
      }
    }
  }

  return {
    text: clampTerminalPreview(primaryText),
    suppressStdout: Boolean(task.textResult?.text.trim()),
  }
}

const buildStreamingPreview = (
  task: TaskRecord,
): { text: string; timestamp: string } | null => {
  const combined = task.stdoutText
  if (!combined.trim()) {
    return null
  }
  if (
    /"type"\s*:\s*"change"/.test(combined) ||
    /"type"\s*:\s*"changes"/.test(combined)
  ) {
    const extracted = extractStreamingJsonPreview(combined)
    const partial = extractPartialJsonPreview(combined)
    return {
      text: clampTerminalPreview(
        extracted || partial || "Preparing Markdown change...",
      ),
      timestamp: task.endedAt ?? task.startedAt,
    }
  }
  const normalized = combined.replace(/\r/g, "").replace(/\\n/g, "\n").trim()
  if (!normalized) {
    return null
  }

  return {
    text: clampTerminalPreview(normalized),
    timestamp: task.endedAt ?? task.startedAt,
  }
}

const clampDisplayLines = (text: string, maxLines = 3): string => {
  const normalized = text.replace(/\r\n?/g, "\n").trim()
  if (!normalized) {
    return ""
  }

  const lines = normalized.split("\n")
  if (lines.length <= maxLines) {
    return normalized
  }

  const visible = lines.slice(0, maxLines)
  visible[maxLines - 1] = `${visible[maxLines - 1].replace(/\s+$/g, "")} ...`
  return visible.join("\n")
}

const prefixForRow = (kind: TerminalRow["kind"]): string => {
  switch (kind) {
    case "command":
      return "$"
    case "output":
      return "ante"
    case "streaming":
      return "ante"
    case "process":
      return "out"
    case "error":
      return "err"
    case "artifact":
      return "git"
    case "loading":
      return ""
    default:
      return "sys"
  }
}

const buildProcessRows = (task: TaskRecord): TerminalRow[] => {
  const process = task.status === "running" ? task.processLane : undefined
  if (!process) {
    return []
  }

  const rows: TerminalRow[] = []
  const activeStep =
    process.steps.find((step) => step.status === "in_progress") ??
    process.steps.find((step) => step.status === "pending")

  rows.push({
    key: `${task.id}:process:label`,
    kind: "process",
    text: activeStep?.activeLabel ?? activeStep?.label ?? process.label,
    timestamp: task.startedAt,
  })

  for (const step of process.steps) {
    rows.push({
      key: `${task.id}:process:step:${step.id}`,
      kind: "process",
      text: `${step.status === "completed" ? "■" : step.status === "in_progress" ? "▪" : "□"} ${
        step.status === "in_progress" ? (step.activeLabel ?? step.label) : step.label
      }`,
      timestamp: task.startedAt,
    })
  }

  if (process.steps.length === 0 && process.label !== rows[0]?.text) {
    rows.push({
      key: `${task.id}:process:phase`,
      kind: "process",
      text: `${process.phase} · ${process.label}`,
      timestamp: task.startedAt,
    })
  }

  return rows
}

const buildRows = (task: TaskRecord, loadingFrame: number): TerminalRow[] => {
  const rows: TerminalRow[] = []
  rows.push({
    key: `${task.id}:command`,
    kind: "command",
    text: task.inlineInstruction || "(empty prompt)",
    timestamp: task.startedAt,
  })

  const hasStructuredOutput = Boolean(task.textResult?.text.trim())
  const output = analyzeOutput(task)
  const streamingPreview =
    !hasStructuredOutput && task.status === "running"
      ? buildStreamingPreview(task)
      : null

  let visibleLogIndex = 0
  for (const log of task.logs) {
    if (log.stream === "stdout") {
      continue
    }
    if (log.stream === "system" && !shouldDisplaySystemLog(log.text)) {
      continue
    }
    rows.push({
      key: `${task.id}:log:${visibleLogIndex}`,
      kind: log.stream === "stderr" ? "error" : "system",
      text: log.text,
      timestamp: log.timestamp,
    })
    visibleLogIndex += 1
  }

  rows.push(...buildProcessRows(task))

  if (streamingPreview) {
    rows.push({
      key: `${task.id}:streaming`,
      kind: "streaming",
      text: clampDisplayLines(streamingPreview.text),
      timestamp: streamingPreview.timestamp,
    })
  }

  if (output.text && !streamingPreview) {
    rows.push({
      key: `${task.id}:output`,
      kind: "output",
      text: output.text,
      timestamp: task.endedAt ?? task.startedAt,
    })
  }

  if (task.artifacts.length > 0) {
    rows.push({
      key: `${task.id}:artifact`,
      kind: "artifact",
      text: `${task.artifacts.length} change artifact(s) ready below.`,
      timestamp: task.endedAt ?? task.startedAt,
    })
  }

  if (task.error) {
    rows.push({
      key: `${task.id}:error`,
      kind: "error",
      text: task.error,
      timestamp: task.endedAt ?? task.startedAt,
    })
  }

  if (task.status === "running" && !output.text && !task.pendingApproval) {
    rows.push({
      key: `${task.id}:loading`,
      kind: "loading",
      text: loadingLabelForTask(task, loadingFrame),
      timestamp: new Date().toISOString(),
    })
  }

  return rows
}

const buildAllRows = (state: TmdState, loadingFrame: number): TerminalRow[] => {
  const tasks = state.tasks.filter((task) => task.triggerSource === "terminal")
  if (tasks.length === 0) {
    return [
      {
        key: EMPTY_ROW_KEY,
        kind: "system",
        text: "Ready.",
        timestamp: new Date().toISOString(),
      },
    ]
  }

  return [...tasks].reverse().flatMap((task) => buildRows(task, loadingFrame))
}

export class TmdTerminalView extends ItemView {
  private unsubscribe: (() => void) | null = null
  private loadingTimer: number | null = null
  private loadingFrame = 0
  private latestState: TmdState | null = null
  private liveContext: ContextSnapshot | null = null
  private frameEl!: HTMLDivElement
  private statusEl!: HTMLDivElement
  private metaLineEl!: HTMLDivElement
  private screenEl!: HTMLDivElement
  private streamEl!: HTMLDivElement
  private promptEl!: HTMLDivElement
  private editorEl!: HTMLDivElement
  private approvalEl: HTMLDivElement | null = null
  private inlineArtifactsEl!: HTMLDivElement
  private promptHistory: string[] = []
  private historyIndex: number = -1
  private draftPrompt = ""
  private isComposing = false
  private readonly rowEls = new Map<string, HTMLDivElement>()
  private readonly inlineExpandedArtifactIds = new Set<string>()
  private didInitialFocus = false
  private lastEditable = false
  private inlineResolvedArtifacts: ResolvedArtifactDiff[] = []
  private inlineArtifactSignature = ""
  private inlineResolvedTaskId: string | null = null
  private inlineResolveVersion = 0
  private initialFocusFrame: number | null = null

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: TmdPlugin,
  ) {
    super(leaf)
  }

  getViewType(): string {
    return TMD_TERMINAL_VIEW_TYPE
  }

  getDisplayText(): string {
    return "Ante Workspace"
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("tmd-view", "tmd-terminal-view")
    this.buildShell()
    this.initialFocusFrame = window.requestAnimationFrame(() => {
      this.initialFocusFrame = null
      this.editorEl.focus()
      this.moveCaretToEnd()
      this.didInitialFocus = true
    })
    this.liveContext = await this.plugin.hostAdapter.capturePreferredContext()
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        void this.refreshLiveContext()
      }),
    )
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        void this.refreshLiveContext()
      }),
    )
    this.unsubscribe = this.plugin.taskEngine.subscribe((state) => {
      this.latestState = state
      this.syncLoadingTimer(state)
      this.render(state)
    })
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.loadingTimer) {
      window.clearInterval(this.loadingTimer)
      this.loadingTimer = null
    }
    if (this.initialFocusFrame != null) {
      window.cancelAnimationFrame(this.initialFocusFrame)
      this.initialFocusFrame = null
    }
  }

  private buildShell(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl("h2", { text: "Ante Workspace" })

    this.frameEl = contentEl.createDiv({ cls: "tmd-terminal-frame" })
    const chrome = this.frameEl.createDiv({ cls: "tmd-terminal-chrome" })
    chrome.createDiv({
      cls: "tmd-terminal-chrome-title",
      text: "markdown context agent",
    })
    const chromeActions = chrome.createDiv({
      cls: "tmd-terminal-chrome-actions",
    })
    const stopButton = chromeActions.createEl("button", {
      cls: "tmd-terminal-stop-button",
    })
    stopButton.setAttr("aria-label", "Stop active Ante task")
    stopButton.createSpan({ cls: "tmd-terminal-stop-icon", text: "■" })
    stopButton.createSpan({ cls: "tmd-terminal-stop-label", text: "Stop" })
    stopButton.addEventListener("click", () =>
      this.plugin.taskEngine.cancelActiveTask(),
    )
    this.statusEl = chromeActions.createDiv({ cls: "tmd-terminal-status" })

    const meta = this.frameEl.createDiv({ cls: "tmd-terminal-meta" })
    this.metaLineEl = meta.createDiv({ cls: "tmd-terminal-meta-line" })

    this.screenEl = this.frameEl.createDiv({ cls: "tmd-terminal-screen" })
    this.streamEl = this.screenEl.createDiv({ cls: "tmd-terminal-stream" })
    this.promptEl = this.screenEl.createDiv({
      cls: "tmd-terminal-row tmd-terminal-promptline",
    })
    this.editorEl = this.promptEl.createDiv({
      cls: "tmd-terminal-shell-editor tmd-is-empty",
    })
    this.editorEl.setAttr("role", "textbox")
    this.editorEl.setAttr("aria-label", "Ante terminal prompt")
    this.editorEl.addEventListener("input", () => {
      const text = this.getEditorText()
      this.editorEl.classList.toggle("tmd-is-empty", text.length === 0)
      if (this.historyIndex === -1) {
        this.draftPrompt = text
      }
    })
    this.editorEl.addEventListener("compositionstart", () => {
      this.isComposing = true
    })
    this.editorEl.addEventListener("compositionend", () => {
      this.isComposing = false
    })
    this.editorEl.addEventListener("keydown", (event) => {
      if (
        shouldStopFromPromptShortcut({
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          key: event.key,
        })
      ) {
        const hasRunningTask = (
          this.latestState ?? this.plugin.taskEngine.getState()
        ).tasks.some((task) => task.status === "running")
        if (hasRunningTask) {
          event.preventDefault()
          this.plugin.taskEngine.cancelActiveTask()
          return
        }
      }
      if (
        !shouldHandlePromptEnter({
          isComposing: this.isComposing,
          eventIsComposing: event.isComposing,
          keyCode: (event as KeyboardEvent).keyCode,
        })
      ) {
        return
      }
      if (event.key === "Enter") {
        event.preventDefault()
        this.runPrompt()
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        this.navigatePromptHistory("up")
        return
      }
      if (event.key === "ArrowDown") {
        event.preventDefault()
        this.navigatePromptHistory("down")
      }
    })
    this.inlineArtifactsEl = contentEl.createDiv({
      cls: "tmd-terminal-inline-container",
    })
  }

  private render(state: TmdState): void {
    const tasks = state.tasks.filter(
      (task) => task.triggerSource === "terminal",
    )
    const latestTask = tasks[0]
    const context =
      this.liveContext ??
      latestTask?.context ??
      state.tasks.find((task) => task.context?.filePath)?.context ??
      null
    const runtimeSummary = extractRuntimeSummary(latestTask)
    const isEditable = !state.tasks.some((task) => task.status === "running")
    const shouldStickToBottom = this.shouldStickToBottom()

    this.statusEl.className = `tmd-terminal-status ${terminalStatusClass(latestTask)}`
    this.statusEl.setText(terminalStatus(latestTask))
    this.metaLineEl.setText(summarizeTerminalMeta(context, runtimeSummary))

    this.syncRows(buildAllRows(state, this.loadingFrame))
    this.syncPrompt(context, tasks, isEditable)
    this.syncInlineArtifacts(latestTask)
    this.syncApproval(latestTask)

    if (shouldStickToBottom && !this.hasSelectionInScreen()) {
      this.scrollToBottom()
    }
    if (
      (isEditable && !this.lastEditable) ||
      (isEditable && !this.didInitialFocus)
    ) {
      this.editorEl.focus()
      this.didInitialFocus = true
    }
    this.lastEditable = isEditable
  }

  private syncRows(rows: TerminalRow[]): void {
    const nextKeys = new Set(rows.map((row) => row.key))

    for (const [key, rowEl] of [...this.rowEls.entries()]) {
      if (!nextKeys.has(key)) {
        rowEl.remove()
        this.rowEls.delete(key)
      }
    }

    let previousEl: HTMLElement | null = null
    for (const row of rows) {
      let rowEl = this.rowEls.get(row.key)
      if (!rowEl) {
        rowEl = this.createRowElement(row)
        this.rowEls.set(row.key, rowEl)
      }
      this.updateRowElement(rowEl, row)
      const anchor: ChildNode | null = previousEl
        ? previousEl.nextSibling
        : this.streamEl.firstChild
      this.streamEl.insertBefore(rowEl, anchor)
      previousEl = rowEl
    }
  }

  private createRowElement(row: TerminalRow): HTMLDivElement {
    const rowEl = this.streamEl.createDiv({
      cls: `tmd-terminal-row tmd-is-${row.kind}`,
    })
    rowEl.createDiv({ cls: "tmd-terminal-row-time" })
    rowEl.createDiv({ cls: "tmd-terminal-row-prefix" })
    rowEl.createDiv({ cls: "tmd-terminal-row-text" })
    this.updateRowElement(rowEl, row)
    return rowEl
  }

  private updateRowElement(rowEl: HTMLDivElement, row: TerminalRow): void {
    const nextClassName = `tmd-terminal-row tmd-is-${row.kind}`
    if (rowEl.className !== nextClassName) {
      rowEl.className = nextClassName
    }
    const timeEl = rowEl.children[0] as HTMLDivElement | undefined
    const prefixEl = rowEl.children[1] as HTMLDivElement | undefined
    const textEl = rowEl.children[2] as HTMLDivElement | undefined
    const nextTime = formatTime(row.timestamp)
    const nextPrefix = prefixForRow(row.kind)
    if (timeEl && timeEl.dataset.value !== nextTime) {
      timeEl.dataset.value = nextTime
      timeEl.textContent = nextTime
    }
    if (prefixEl && prefixEl.dataset.value !== nextPrefix) {
      prefixEl.dataset.value = nextPrefix
      prefixEl.textContent = nextPrefix
    }
    if (textEl && textEl.dataset.value !== row.text) {
      textEl.dataset.value = row.text
      textEl.textContent = row.text
    }
  }

  private syncPrompt(
    context: ContextSnapshot | null,
    tasks: TaskRecord[],
    isEditable: boolean,
  ): void {
    this.promptEl.classList.toggle("tmd-is-editable", isEditable)
    this.editorEl.contentEditable = isEditable ? "true" : "false"
    this.editorEl.dataset.placeholder = context?.filePath
      ? `Use ${context.filePath} as Markdown context to plan, write, edit, or run tasks`
      : "Use the current Markdown context to plan, write, edit, or run tasks"
    if (!isEditable) {
      return
    }
    if (tasks.length === 0) {
      this.editorEl.classList.toggle(
        "tmd-is-empty",
        this.getEditorText().length === 0,
      )
    }
  }

  private getEditorText(): string {
    return this.editorEl.innerText.replace(/\n/g, " ").trim()
  }

  private setEditorText(text: string): void {
    this.editorEl.setText(text)
    this.editorEl.classList.toggle("tmd-is-empty", text.trim().length === 0)
    this.moveCaretToEnd()
  }

  private moveCaretToEnd(): void {
    const selection = window.getSelection()
    if (!selection) {
      return
    }
    const range = document.createRange()
    range.selectNodeContents(this.editorEl)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  private navigatePromptHistory(direction: "up" | "down"): void {
    const next = computePromptHistoryNavigation(
      this.promptHistory,
      this.historyIndex,
      this.draftPrompt,
      this.getEditorText(),
      direction,
    )
    this.historyIndex = next.historyIndex
    this.draftPrompt = next.draftPrompt
    if (next.nextText !== this.getEditorText()) {
      this.setEditorText(next.nextText)
    }
  }

  private syncApproval(task: TaskRecord | undefined): void {
    const approval =
      task?.status === "running" ? task.pendingApproval : undefined
    if (!approval || !task) {
      this.approvalEl?.remove()
      this.approvalEl = null
      return
    }

    const existing = this.approvalEl
    if (existing) {
      existing.remove()
    }

    const approvalCard = this.frameEl.createDiv({
      cls: "tmd-terminal-approval",
    })
    approvalCard.createDiv({
      cls: "tmd-terminal-approval-title",
      text: "Tool approval required",
    })
    approvalCard.createDiv({
      cls: "tmd-terminal-approval-message",
      text: approval.message,
    })

    for (const tool of approval.tools) {
      const toolRow = approvalCard.createDiv({
        cls: "tmd-terminal-approval-tool",
      })
      toolRow.createDiv({
        cls: "tmd-terminal-approval-tool-name",
        text: `${tool.name} · ${tool.id}`,
      })
      if (tool.argsText) {
        toolRow.createDiv({
          cls: "tmd-terminal-approval-tool-args",
          text: tool.argsText,
        })
      }
    }

    const actionRow = approvalCard.createDiv({
      cls: "tmd-terminal-approval-actions",
    })
    const renderAction = (
      label: string,
      decision: RuntimeApprovalDecision,
      cls: string,
    ) => {
      const button = actionRow.createEl("button", {
        cls: `tmd-terminal-approval-button ${cls}`,
        text: label,
      })
      button.addEventListener("click", () => {
        try {
          this.plugin.taskEngine.respondToTaskApproval(task.id, decision)
        } catch (error) {
          new Notice(
            error instanceof Error
              ? error.message
              : "Failed to send Ante approval",
          )
        }
      })
    }

    renderAction("Approve once", "Accept", "tmd-is-approve")
    renderAction("Allow session", "AcceptForSession", "tmd-is-approve-session")
    renderAction("Deny", "Skip", "tmd-is-deny")
    this.approvalEl = approvalCard
  }

  private runPrompt(): void {
    const promptText = this.getEditorText()
    if (!promptText) {
      return
    }
    this.promptHistory = [
      ...this.promptHistory.filter((entry) => entry !== promptText),
      promptText,
    ].slice(-50)
    this.historyIndex = -1
    this.draftPrompt = ""

    const tasks = (
      this.latestState ?? this.plugin.taskEngine.getState()
    ).tasks.filter((task) => task.triggerSource === "terminal")
    void this.plugin.hostAdapter
      .capturePreferredContext()
      .then((contextSnapshot) => {
        this.liveContext = contextSnapshot
        return contextSnapshot
      })
      .then((contextSnapshot) =>
        this.plugin.taskEngine.startTerminalTask(
          promptText,
          Boolean(
            tasks.find((task) => task.runtimeSession?.sessionId)
              ?.runtimeSession,
          ),
          contextSnapshot,
        ),
      )
      .then(() => {
        this.editorEl.empty()
        this.editorEl.classList.add("tmd-is-empty")
        this.draftPrompt = ""
      })
      .catch((error) => {
        new Notice(
          error instanceof Error
            ? error.message
            : "Failed to start Ante terminal task",
        )
      })
  }

  private syncInlineArtifacts(task: TaskRecord | undefined): void {
    if (!task || task.artifacts.length === 0) {
      this.inlineArtifactsEl.empty()
      this.inlineResolvedArtifacts = []
      this.inlineArtifactSignature = ""
      this.inlineResolvedTaskId = task?.id ?? null
      this.inlineExpandedArtifactIds.clear()
      return
    }

    const signature = [
      task.id,
      ...task.artifacts.map(
        (artifact) =>
          `${artifact.id}:${artifact.applyState}:${artifact.applyError ?? ""}`,
      ),
    ].join("|")

    if (this.inlineResolvedTaskId !== task.id) {
      this.inlineExpandedArtifactIds.clear()
    }

    if (
      this.inlineArtifactSignature === signature &&
      this.inlineResolvedTaskId === task.id &&
      this.inlineResolvedArtifacts.length > 0
    ) {
      this.renderInlineArtifacts(task, this.inlineResolvedArtifacts)
      return
    }

    this.inlineArtifactsEl.empty()
    const waiting = this.inlineArtifactsEl.createDiv({
      cls: "tmd-terminal-inline-placeholder",
    })
    waiting.setText("Preparing diff preview...")

    const resolveVersion = ++this.inlineResolveVersion
    void resolveArtifactDiffs(task).then((resolvedArtifacts) => {
      if (resolveVersion !== this.inlineResolveVersion) {
        return
      }
      this.inlineResolvedArtifacts = resolvedArtifacts
      this.inlineArtifactSignature = signature
      this.inlineResolvedTaskId = task.id
      this.renderInlineArtifacts(task, resolvedArtifacts)
    })
  }

  private renderInlineArtifacts(
    task: TaskRecord,
    resolvedArtifacts: ResolvedArtifactDiff[],
  ): void {
    this.inlineArtifactsEl.empty()
    const diffList = renderDiffSummary(
      this.inlineArtifactsEl,
      resolvedArtifacts,
      {
        actionLabel: "Apply all",
        isActionDisabled: resolvedArtifacts.every(
          ({ artifact }) =>
            artifact.applyState === "applied" ||
            artifact.applyState === "discarded",
        ),
        onAction: () => {
          void this.plugin.taskEngine
            .applyAllArtifacts(task.id)
            .catch((error) => {
              handleError(error, "Failed to apply all changes")
            })
        },
      },
    )
    for (const resolved of resolvedArtifacts) {
      const { artifact } = resolved
      renderArtifactDiff(
        diffList,
        this.plugin,
        task,
        resolved,
        this.inlineExpandedArtifactIds,
        () => {
          if (this.inlineExpandedArtifactIds.has(artifact.id)) {
            this.inlineExpandedArtifactIds.delete(artifact.id)
          } else {
            this.inlineExpandedArtifactIds.add(artifact.id)
          }
          this.renderInlineArtifacts(task, this.inlineResolvedArtifacts)
        },
      )
    }
  }

  private syncLoadingTimer(state: TmdState): void {
    const terminalTasks = state.tasks.filter(
      (task) => task.triggerSource === "terminal",
    )
    const shouldAnimate = terminalTasks
      .filter((task) => task.status === "running")
      .some((task) => !analyzeOutput(task).text && !task.pendingApproval)

    if (shouldAnimate && this.loadingTimer == null) {
      this.loadingTimer = window.setInterval(() => {
        this.loadingFrame = (this.loadingFrame + 1) % 4
        if (this.latestState) {
          this.render(this.latestState)
        }
      }, 500)
      return
    }

    if (!shouldAnimate && this.loadingTimer != null) {
      window.clearInterval(this.loadingTimer)
      this.loadingTimer = null
      this.loadingFrame = 0
    }
  }

  private shouldStickToBottom(): boolean {
    const threshold = 24
    return (
      this.screenEl.scrollTop + this.screenEl.clientHeight >=
      this.screenEl.scrollHeight - threshold
    )
  }

  private hasSelectionInScreen(): boolean {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return false
    }
    const anchorNode = selection.anchorNode
    const focusNode = selection.focusNode
    return Boolean(
      (anchorNode && this.screenEl.contains(anchorNode)) ||
      (focusNode && this.screenEl.contains(focusNode)),
    )
  }

  private scrollToBottom(): void {
    this.screenEl.scrollTop = this.screenEl.scrollHeight
  }

  private async refreshLiveContext(): Promise<void> {
    this.liveContext = await this.plugin.hostAdapter.capturePreferredContext()
    if (this.latestState) {
      this.render(this.latestState)
      return
    }
    this.metaLineEl.setText(summarizeTerminalMeta(this.liveContext, null))
    this.editorEl.dataset.placeholder = this.liveContext?.filePath
      ? `Use ${this.liveContext.filePath} as Markdown context to plan, write, edit, or run tasks`
      : "Use the current Markdown context to plan, write, edit, or run tasks"
  }
}
