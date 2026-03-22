export type PresetId = "default" | "research" | "plan";
export type TaskTriggerSource = "mention" | "context-menu" | "command" | "console" | "terminal";
export type TaskKind = "document" | "console" | "terminal";
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
  textResult?: TextResult;
  artifacts: DocumentChangeArtifact[];
  pendingApproval?: RuntimeApprovalRequest;
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
  mode?: "initial" | "followup";
  followUpPrompt?: string;
  runtimeSessionId?: string;
}

export type RuntimeEvent =
  | { type: "log"; stream: LogStream; text: string }
  | { type: "runtime.session"; provider: "ante"; sessionId: string }
  | { type: "session.approval"; approval: RuntimeApprovalRequest }
  | { type: "result.text"; text: string }
  | { type: "result.change"; change: RuntimeChangeSuggestion }
  | { type: "session.completed"; summary?: string }
  | { type: "session.failed"; error: string };

export const createInitialState = (): TmdState => ({
  currentTaskId: null,
  tasks: []
});
