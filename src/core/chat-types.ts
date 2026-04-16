import type { AnteThinkingPreference } from "./ante-thinking";
import type {
  ContextSnapshot,
  DocumentChangeArtifact,
  RuntimeApprovalRequest,
  RuntimeProcessLane,
  RuntimeTelemetryState
} from "./types";

export type ChatMessageRole = "user" | "assistant";
export type ChatMessageStatus = "streaming" | "completed" | "cancelled" | "failed" | "awaiting-apply";

export interface ChatTurnRef {
  taskId: string;
  runtimeSessionId?: string;
}

export interface ChatMessageRuntimeState {
  approval?: RuntimeApprovalRequest;
  processLane?: RuntimeProcessLane;
  telemetry?: RuntimeTelemetryState;
  error?: string;
  artifactIds: string[];
  artifacts?: DocumentChangeArtifact[];
}

export interface ChatMessageRecord {
  id: string;
  conversationId: string;
  role: ChatMessageRole;
  status: ChatMessageStatus;
  text: string;
  submissionText?: string;
  attachmentPaths?: string[];
  createdAt: string;
  updatedAt: string;
  context?: ContextSnapshot | null;
  turn?: ChatTurnRef;
  runtime?: ChatMessageRuntimeState;
}

export interface ChatConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinnedContext: ContextSnapshot | null;
  runtimeTarget?: {
    provider: string;
    model: string;
    thinking: AnteThinkingPreference;
  };
  messageIds: string[];
  archived: boolean;
}

export interface ChatPersistenceState {
  conversations: ChatConversationRecord[];
  messages: ChatMessageRecord[];
  activeConversationId: string | null;
}

export interface ChatStateSnapshot {
  conversations: ChatConversationRecord[];
  messagesByConversation: Record<string, ChatMessageRecord[]>;
  activeConversationId: string | null;
}
