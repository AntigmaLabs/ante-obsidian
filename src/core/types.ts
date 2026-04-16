import type { AnteThinkingPreference } from "./ante-thinking";

export type PresetId = string;
export type TaskTriggerSource = "mention" | "context-menu" | "command" | "chat" | "terminal";
export type TaskKind = "document" | "chat" | "terminal";
export type TaskStatus =
  | "idle"
  | "running"
  | "completed"
  | "cancelled"
  | "failed"
  | "awaiting-apply"
  | "applied"
  | "discarded";
export type DocumentChangeOperation = "replace-file" | "create-file";
export type ApplyState = "pending" | "applying" | "applied" | "reverting" | "reverted" | "failed" | "discarded";
export type LogStream = "stdout" | "stderr" | "system" | "user";
export type RuntimeApprovalDecision = "Accept" | "AcceptForSession" | "Skip" | "Abort";
export type RuntimeProcessStepStatus = "pending" | "in_progress" | "completed";
export type RuntimeInfoLevel = "info" | "goodbye";

export interface TextPosition {
  line: number;
  ch: number;
}

export interface SelectionSnapshot {
  text: string;
  from: TextPosition;
  to: TextPosition;
}

export interface ContextSnapshot {
  vaultPath: string | null;
  filePath: string | null;
  noteTitle: string | null;
  documentText: string | null;
  selection: SelectionSnapshot | null;
}

export interface PresetDefinition {
  id: PresetId;
  label: string;
  goal: string;
  systemInstructions: string;
  source?: "builtin" | "custom";
  enabled?: boolean;
  sortOrder?: number;
  interactionMode?: "inline" | "panel";
}

export interface LogEntry {
  stream: LogStream;
  text: string;
  timestamp: string;
}

export interface RuntimeSessionInfo {
  provider: "ante";
  sessionId: string;
}

export interface RuntimeApprovalTool {
  id: string;
  name: string;
  argsText?: string;
}

export interface RuntimeToolCall {
  id: string;
  name: string;
  argsText?: string;
  resultText?: string;
  status?: string;
  isError?: boolean;
}

export interface RuntimeApprovalRequest {
  turnId: string;
  message: string;
  tools: RuntimeApprovalTool[];
}

export interface RuntimeProcessStep {
  id: string;
  label: string;
  activeLabel?: string;
  status: RuntimeProcessStepStatus;
}

export interface RuntimeProcessLane {
  phase: "planning" | "running" | "paused";
  label: string;
  toolName?: string;
  steps: RuntimeProcessStep[];
}

export interface RuntimeUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  raw?: unknown;
}

export interface RuntimeTimelineEntry {
  kind: "info" | "goodbye" | "compaction-start" | "compaction-end";
  message?: string;
  timestamp: string;
}

export interface RuntimeTelemetryState {
  thinkingText?: string;
  usage?: RuntimeUsage;
  compacting?: boolean;
  lastInfo?: {
    level: RuntimeInfoLevel;
    message?: string;
    timestamp: string;
  };
  timeline: RuntimeTimelineEntry[];
}

export type DocumentChangeTarget = {
  type: "file";
  path: string;
};

export interface DocumentChangeArtifact {
  id: string;
  title: string;
  summary?: string;
  operation: DocumentChangeOperation;
  target: DocumentChangeTarget;
  beforeText: string;
  afterText: string;
  applyState: ApplyState;
  applyError?: string;
  runtimeToolId?: string;
  baselinePath?: string;
  stagedPath?: string;
  stagedRoot?: string;
  runtimeMode?: "approval" | "staged-preview" | "observed";
}

export interface TextResult {
  kind: "text";
  text: string;
}

export interface TaskRecord {
  id: string;
  kind: TaskKind;
  preset: PresetDefinition;
  triggerSource: TaskTriggerSource;
  inlineInstruction: string;
  context: ContextSnapshot | null;
  status: TaskStatus;
  logs: LogEntry[];
  stdoutText: string;
  textResult?: TextResult;
  artifacts: DocumentChangeArtifact[];
  pendingApproval?: RuntimeApprovalRequest;
  processLane?: RuntimeProcessLane;
  telemetry?: RuntimeTelemetryState;
  error?: string;
  startedAt: string;
  endedAt?: string;
  runtimeSession?: RuntimeSessionInfo;
}

export interface TmdState {
  currentTaskId: string | null;
  tasks: TaskRecord[];
}

export interface TaskRequest {
  taskId: string;
  kind: TaskKind;
  triggerSource: TaskTriggerSource;
  preset: PresetDefinition;
  context: ContextSnapshot;
  inlineInstruction: string;
  obsidianCliPromptBlock?: string;
  mode?: "initial" | "followup";
  followUpPrompt?: string;
  runtimeSessionId?: string;
  reusePriorContext?: boolean;
  runtimeTarget?: {
    provider: string;
    model: string;
    thinking: AnteThinkingPreference;
  };
}

export type RuntimeEvent =
  | { type: "log"; stream: LogStream; text: string }
  | { type: "runtime.session"; provider: "ante"; sessionId: string }
  | { type: "session.approval"; approval: RuntimeApprovalRequest }
  | { type: "session.tool"; phase: "start" | "end"; tool: RuntimeToolCall }
  | { type: "process.update"; process?: RuntimeProcessLane }
  | { type: "session.thinking"; text: string; mode: "full" | "delta" }
  | { type: "session.usage"; usage: RuntimeUsage }
  | { type: "session.compaction"; phase: "start" | "end" }
  | { type: "session.info"; level: RuntimeInfoLevel; message?: string }
  | { type: "result.text"; text: string }
  | { type: "session.completed"; summary?: string }
  | { type: "session.failed"; error: string };

export const createInitialState = (): TmdState => ({
  currentTaskId: null,
  tasks: []
});
