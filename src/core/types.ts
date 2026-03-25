export type PresetId = string;
export type TaskTriggerSource = "mention" | "context-menu" | "command" | "chat" | "terminal";
export type TaskKind = "document" | "chat" | "terminal";
export type TaskStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "awaiting-apply"
  | "applied"
  | "discarded";
export type DocumentChangeOperation = "replace-selection" | "append-block" | "replace-file" | "create-file";
export type ApplyState = "pending" | "applying" | "applied" | "reverting" | "reverted" | "failed" | "discarded";
export type LogStream = "stdout" | "stderr" | "system" | "user";
export type RuntimeApprovalDecision = "Accept" | "AcceptForSession" | "Skip" | "Abort";
export type RuntimeProcessStepStatus = "pending" | "in_progress" | "completed";

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

export type DocumentChangeTarget =
  | {
      type: "selection";
      filePath: string;
      from: TextPosition;
      to: TextPosition;
    }
  | {
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
  sourceChanges: RuntimeChangeSuggestion[];
  applyState: ApplyState;
  applyError?: string;
}

export interface TextResult {
  kind: "text";
  text: string;
}

export interface RuntimeChangeSuggestion {
  kind: "change";
  operation: DocumentChangeOperation;
  targetPath?: string;
  afterText: string;
  title?: string;
  summary?: string;
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
  inlineChanges?: RuntimeChangeSuggestion[];
  artifacts: DocumentChangeArtifact[];
  pendingApproval?: RuntimeApprovalRequest;
  processLane?: RuntimeProcessLane;
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
  captureChangesAsArtifacts?: boolean;
  mode?: "initial" | "followup";
  followUpPrompt?: string;
  runtimeSessionId?: string;
  reusePriorContext?: boolean;
}

export type RuntimeEvent =
  | { type: "log"; stream: LogStream; text: string }
  | { type: "runtime.session"; provider: "ante"; sessionId: string }
  | { type: "session.approval"; approval: RuntimeApprovalRequest }
  | { type: "process.update"; process?: RuntimeProcessLane }
  | { type: "result.text"; text: string }
  | { type: "result.change"; change: RuntimeChangeSuggestion }
  | { type: "result.changes"; changes: RuntimeChangeSuggestion[] }
  | { type: "session.completed"; summary?: string }
  | { type: "session.failed"; error: string };

export const createInitialState = (): TmdState => ({
  currentTaskId: null,
  tasks: []
});
