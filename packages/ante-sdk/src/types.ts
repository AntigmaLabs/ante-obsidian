export const ANTE_THINKING_LEVELS = [
  "Disabled",
  "Enabled",
  "Deep",
  "Max"
] as const;

export type AnteThinkingLevel = (typeof ANTE_THINKING_LEVELS)[number];

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "dontAsk"
  | "auto";

export type ApprovalDecision = "Accept" | "AcceptForSession" | "Skip" | "Abort";

export interface ApprovalTool {
  id: string;
  name: string;
  argsText?: string;
}

export interface ApprovalRequest {
  turnId: string;
  message: string;
  tools: ApprovalTool[];
}

export interface ToolCall {
  id: string;
  name: string;
  argsText?: string;
  resultText?: string;
  status?: string;
  isError?: boolean;
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  raw?: unknown;
}

export interface ProcessStep {
  id: string;
  label: string;
  activeLabel?: string;
  status: "pending" | "in_progress" | "completed";
}

export interface ProcessLane {
  phase: "planning" | "running" | "paused";
  label: string;
  toolName?: string;
  steps: ProcessStep[];
}

export type SDKUserMessage = {
  type: "user";
  message: string;
};

export type SDKMessage =
  | { type: "system"; subtype: "init"; session_id: string; cwd: string; model: string; provider: string; permissionMode: PermissionMode }
  | { type: "assistant"; message: { content: Array<{ type: "text"; text: string }> }; session_id?: string }
  | { type: "stream_event"; event: { type: "text_delta" | "thinking_delta"; text: string }; session_id?: string }
  | { type: "tool"; phase: "start" | "end"; tool: ToolCall; session_id?: string }
  | { type: "approval"; approval: ApprovalRequest; session_id?: string }
  | { type: "usage"; usage: Usage; session_id?: string }
  | { type: "system"; subtype: "status"; status: "compacting" | null; session_id?: string }
  | { type: "system"; subtype: "diagnostic"; stream: "stdout" | "stderr" | "system"; text: string; session_id?: string }
  | { type: "result"; subtype: "success" | "error" | "cancelled"; result?: string; error?: string; session_id?: string };

export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    toolUseID: string;
  }
) => Promise<{ behavior: "allow" | "deny"; message?: string }>;

export interface Options {
  abortController?: AbortController;
  allowedTools?: string[];
  anteArgs?: string[];
  canUseTool?: CanUseTool;
  continue?: boolean;
  cwd?: string;
  disallowedTools?: string[];
  env?: Record<string, string | undefined>;
  model?: string;
  pathToAnteExecutable?: string;
  permissionMode?: PermissionMode;
  provider?: string;
  resume?: string;
  stderr?: (data: string) => void;
  systemPrompt?: string | { type: "preset"; preset: "ante"; append?: string };
  appendSystemPrompt?: string;
  thinking?: AnteThinkingLevel | { type: "disabled" | "enabled" | "deep" | "max" } | null;
  transport?: "stdio" | "websocket";
  wsAddress?: string;
}

export interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
  close(): void;
}
