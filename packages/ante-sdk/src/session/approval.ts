import type { ApprovalDecision, ApprovalRequest, ProcessLane, ProcessStep } from "../types";

export const buildApprovalResponseOperation = (
  approval: ApprovalRequest,
  decision: ApprovalDecision,
): { ApprovalResponse: { turn_id: string; responses: Array<[string, ApprovalDecision]> } } => ({
  ApprovalResponse: {
    turn_id: approval.turnId,
    responses: approval.tools.map((tool) => [tool.id, decision] as [string, ApprovalDecision]),
  },
});

export const buildApprovalProcessLane = (
  approval: ApprovalRequest,
  previousSteps?: ProcessStep[],
): ProcessLane => ({
  phase: "paused",
  label: approval.message || "Awaiting tool approval",
  toolName: approval.tools[0]?.name,
  steps: previousSteps ?? [],
});

export const describeAutoApprovedTools = (approval: ApprovalRequest): string =>
  `Ante auto-approved ${approval.tools.map((tool) => tool.name).join(", ") || "tool call"}`;
