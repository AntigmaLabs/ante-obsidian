import type { AnteThinkingPreference } from "../core/ante-thinking";
import type { RuntimeApprovalDecision, RuntimeApprovalRequest, RuntimeEvent, RuntimeSessionInfo, TaskRequest } from "../core/types";

export interface RuntimeObserver {
  onEvent: (event: RuntimeEvent) => void;
  onExit: (result: { status: "completed" | "failed" | "cancelled"; error?: string }) => void;
}

export interface AnteRuntime {
  ensureWarmSession(target?: { provider: string; model: string; thinking: AnteThinkingPreference }): Promise<void>;
  run(request: TaskRequest, observer: RuntimeObserver): void;
  cancelActiveRun(): void;
  respondToApproval(approval: RuntimeApprovalRequest, decision: RuntimeApprovalDecision): void;
  persistActiveSession(): Promise<void>;
  getActiveSessionId(): string | null;
  getActiveSessionInfo(): RuntimeSessionInfo | null;
  dispose(): void;
}
