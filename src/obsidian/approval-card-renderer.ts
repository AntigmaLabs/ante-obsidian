import type {
  RuntimeApprovalDecision,
  RuntimeApprovalRequest,
} from "../core/types"

export interface ApprovalActionDefinition {
  label: string
  decision: RuntimeApprovalDecision
  className: string
}

export const DEFAULT_APPROVAL_ACTIONS: readonly ApprovalActionDefinition[] = [
  {
    label: "Approve once",
    decision: "Accept",
    className: "tmd-is-approve",
  },
  {
    label: "Allow session",
    decision: "AcceptForSession",
    className: "tmd-is-approve-session",
  },
  {
    label: "Deny",
    decision: "Skip",
    className: "tmd-is-deny",
  },
]

export const buildApprovalSignature = (
  approval: RuntimeApprovalRequest | null | undefined,
  ownerKey?: string,
): string =>
  [
    ...(ownerKey ? [ownerKey] : []),
    approval?.turnId ?? "",
    approval?.message ?? "",
    ...(approval?.tools ?? []).map(
      (tool) => `${tool.id}:${tool.name}:${tool.argsText ?? ""}`,
    ),
  ].join("|")

export const renderApprovalCard = (
  container: HTMLElement,
  approval: RuntimeApprovalRequest,
  onDecision: (decision: RuntimeApprovalDecision) => void,
  actions: readonly ApprovalActionDefinition[] = DEFAULT_APPROVAL_ACTIONS,
): HTMLDivElement => {
  const approvalCard = container.createDiv({ cls: "tmd-terminal-approval" })
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
  for (const action of actions) {
    const button = actionRow.createEl("button", {
      cls: `tmd-terminal-approval-button ${action.className}`,
      text: action.label,
    })
    button.addEventListener("click", () => {
      onDecision(action.decision)
    })
  }

  return approvalCard
}
