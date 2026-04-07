import type {
  RuntimeApprovalDecision,
  RuntimeApprovalRequest,
  RuntimeProcessLane,
  RuntimeProcessStep
} from "../core/types";

export const buildApprovalResponseOperation = (
  approval: RuntimeApprovalRequest,
  decision: RuntimeApprovalDecision
): { ApprovalResponse: { turn_id: string; responses: Array<[string, RuntimeApprovalDecision]> } } => ({
  ApprovalResponse: {
    turn_id: approval.turnId,
    responses: approval.tools.map((tool) => [tool.id, decision] as [string, RuntimeApprovalDecision])
  }
});

export const buildApprovalProcessLane = (
  approval: RuntimeApprovalRequest,
  previousSteps?: RuntimeProcessStep[]
): RuntimeProcessLane => ({
  phase: "paused",
  label: approval.message || "Awaiting tool approval",
  toolName: approval.tools[0]?.name,
  steps: previousSteps ?? []
});

export const describeAutoApprovedTools = (approval: RuntimeApprovalRequest): string =>
  `Ante auto-approved ${approval.tools.map((tool) => tool.name).join(", ") || "tool call"}`;
