import type {
  ContextSnapshot,
  TaskRecord,
  TmdState,
} from "../core/types"
import { formatLoadingLabel } from "../core/loading-label"

export interface TerminalRow {
  key: string
  kind: "command" | "output" | "streaming" | "process" | "system" | "error" | "artifact" | "loading"
  text: string
  timestamp: string
}

export const EMPTY_ROW_KEY = "terminal-empty"
export const MAX_TERMINAL_PREVIEW_CHARS = 12000
export const MAX_TERMINAL_PREVIEW_LINES = 160

export const hasContextDispatchLog = (task: TaskRecord): boolean =>
  task.logs.some(
    (log) =>
      log.stream === "system" &&
      (/^Sending Markdown context\b/.test(log.text) ||
        /^Sending context reference\b/.test(log.text)),
  )

export const hasTurnActivityLog = (task: TaskRecord): boolean =>
  task.logs.some(
    (log) =>
      log.stream === "system" &&
      (/^Ante TurnStart\b/.test(log.text) ||
        /^Ante ToolStart\b/.test(log.text) ||
        /^Ante ToolUpdate\b/.test(log.text) ||
        /^Ante ToolEnd\b/.test(log.text) ||
        /^Ante TurnPause\b/.test(log.text)),
  )

export const hasStdoutLog = (task: TaskRecord): boolean =>
  task.stdoutText.trim().length > 0

export const loadingLabelForTask = (task: TaskRecord, frameIndex: number): string => {
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

export const summarizeContext = (
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

export const summarizeTerminalMeta = (
  context: ContextSnapshot | null | undefined,
  runtimeSummary: { provider: string; model: string } | null,
): string => {
  const parts = [summarizeContext(context)]
  if (runtimeSummary) {
    parts.push(`${runtimeSummary.provider} · ${runtimeSummary.model}`)
  }
  return parts.join("  ·  ")
}

export const NOISY_SYSTEM_PATTERNS = [
  /^Launching Ante server\b/,
  /^Reusing existing Ante session\b/,
  /^Ante TurnStart\b/,
  /^Ante ToolStart\b/,
  /^Ante ToolEnd\b/,
  /^Ante ToolUpdate\b/,
]

export const shouldDisplaySystemLog = (
  text: string,
  showFullProcessLogs: boolean,
): boolean =>
  showFullProcessLogs || !NOISY_SYSTEM_PATTERNS.some((pattern) => pattern.test(text))

export const extractRuntimeSummary = (
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

export const parseJsonPayload = (value: string): unknown => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const candidates: string[] = []
  const exactFence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  if (exactFence?.[1]) {
    candidates.push(exactFence[1].trim())
  }

  const fencePattern = /```(?:json)?\s*([\s\S]*?)\s*```/gi
  for (const match of trimmed.matchAll(fencePattern)) {
    const candidate = match[1]?.trim()
    if (candidate) {
      candidates.push(candidate)
    }
  }

  candidates.push(trimmed)
  for (const candidate of [...new Set(candidates)]) {
    try {
      return JSON.parse(candidate) as unknown
    } catch {
      // Keep scanning for a parseable fenced JSON payload.
    }
  }

  return null
}

export const clampTerminalPreview = (
  value: string,
  showFullProcessLogs: boolean,
): string => {
  const normalized = value.replace(/\r/g, "")
  if (!normalized) {
    return ""
  }

  if (showFullProcessLogs) {
    return normalized.trim()
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

export const analyzeOutput = (
  task: TaskRecord,
  showFullProcessLogs: boolean,
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
  }

  return {
    text: clampTerminalPreview(primaryText, showFullProcessLogs),
    suppressStdout: Boolean(task.textResult?.text.trim()),
  }
}

export const buildStreamingPreview = (
  task: TaskRecord,
  showFullProcessLogs: boolean,
): { text: string; timestamp: string } | null => {
  const combined = task.stdoutText
  if (!combined.trim()) {
    return null
  }
  const normalized = combined.replace(/\r/g, "").replace(/\\n/g, "\n").trim()
  if (!normalized) {
    return null
  }

  return {
    text: clampTerminalPreview(normalized, showFullProcessLogs),
    timestamp: task.endedAt ?? task.startedAt,
  }
}

export const clampDisplayLines = (
  text: string,
  showFullProcessLogs: boolean,
  maxLines = 3,
): string => {
  const normalized = text.replace(/\r\n?/g, "\n").trim()
  if (!normalized) {
    return ""
  }

  if (showFullProcessLogs) {
    return normalized
  }

  const lines = normalized.split("\n")
  if (lines.length <= maxLines) {
    return normalized
  }

  const visible = lines.slice(0, maxLines)
  visible[maxLines - 1] = `${visible[maxLines - 1].replace(/\s+$/g, "")} ...`
  return visible.join("\n")
}

export const prefixForRow = (kind: TerminalRow["kind"]): string => {
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

export const buildProcessRows = (task: TaskRecord): TerminalRow[] => {
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

export const buildRows = (
  task: TaskRecord,
  loadingFrame: number,
  showFullProcessLogs: boolean,
): TerminalRow[] => {
  const rows: TerminalRow[] = []
  rows.push({
    key: `${task.id}:command`,
    kind: "command",
    text: task.inlineInstruction || "(empty prompt)",
    timestamp: task.startedAt,
  })

  const hasStructuredOutput = Boolean(task.textResult?.text.trim())
  const output = analyzeOutput(task, showFullProcessLogs)
  const streamingPreview =
    !hasStructuredOutput && task.status === "running"
      ? buildStreamingPreview(task, showFullProcessLogs)
      : null

  let visibleLogIndex = 0
  for (const log of task.logs) {
    if (log.stream === "stdout") {
      continue
    }
    if (log.stream === "system" && !shouldDisplaySystemLog(log.text, showFullProcessLogs)) {
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
      text: clampDisplayLines(streamingPreview.text, showFullProcessLogs),
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

export const buildAllRows = (
  state: TmdState,
  loadingFrame: number,
  showFullProcessLogs: boolean,
): TerminalRow[] => {
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

  return [...tasks].reverse().flatMap((task) =>
    buildRows(task, loadingFrame, showFullProcessLogs),
  )
}
