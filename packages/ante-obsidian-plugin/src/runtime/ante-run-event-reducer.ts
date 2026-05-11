import type { RuntimeApprovalRequest, RuntimeProcessLane } from "../core/types";
import {
  buildProcessLaneFromToolPayload,
  extractErrorMessage,
  extractInfoMessage,
  extractToolCall,
  extractText,
  extractTurnPauseApproval,
  extractTurnPauseDetail,
  extractTurnStatus,
  extractUsage,
  parseAssistantMessage
} from "./ante-event-parser";
import { buildApprovalProcessLane, describeAutoApprovedTools } from "./ante-approval";
import type { RuntimeObserver } from "./ante-runtime";

export interface ActiveRun {
  observer: RuntimeObserver;
  request: import("../core/types").TaskRequest;
  autoApproveTools: boolean;
  finalMessage: string;
  emittedStdout: boolean;
  completed: boolean;
  processLane?: RuntimeProcessLane;
  startedAtMs: number;
  userInputSentAtMs?: number;
  userInputOpId?: string;
  sessionReadyAtMs?: number;
  firstEventAtMs?: number;
  firstStdoutAtMs?: number;
}

export interface ReducedRunOutcome {
  status: "completed" | "failed" | "cancelled";
  error?: string;
}

export interface ReduceRunVariantInput {
  activeRun: ActiveRun;
  variantName: string;
  payload: unknown;
  interruptPending: boolean;
  nowMs: () => number;
  logDebug: (message: string) => void;
  respondToApproval: (approval: RuntimeApprovalRequest, decision: "AcceptForSession") => void;
}

const previewText = (value: string, maxChars = 240): string =>
  value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;

const markFirstEvent = (activeRun: ActiveRun, nowMs: () => number): number => {
  if (activeRun.firstEventAtMs == null) {
    activeRun.firstEventAtMs = nowMs();
  }
  return activeRun.firstEventAtMs;
};

const markFirstStdout = (activeRun: ActiveRun, nowMs: () => number): void => {
  const firstEventAtMs = markFirstEvent(activeRun, nowMs);
  if (activeRun.firstStdoutAtMs == null) {
    activeRun.firstStdoutAtMs = firstEventAtMs;
  }
};

const approvalHasFileEditingTools = (approval: RuntimeApprovalRequest): boolean =>
  approval.tools.some((tool) => {
    const normalized = tool.name.trim().toLowerCase();
    return normalized === "write" || normalized === "edit";
  });

export const reduceRunVariant = ({
  activeRun,
  variantName,
  payload,
  interruptPending,
  nowMs,
  logDebug,
  respondToApproval
}: ReduceRunVariantInput): ReducedRunOutcome | null => {
  switch (variantName) {
    case "MessageDelta": {
      const delta = extractText(payload);
      if (!delta) {
        return null;
      }
      markFirstStdout(activeRun, nowMs);
      activeRun.finalMessage += delta;
      activeRun.observer.onEvent({ type: "log", stream: "stdout", text: delta });
      activeRun.emittedStdout = true;
      return null;
    }
    case "ThinkingDelta": {
      const delta = extractText(payload);
      if (!delta) {
        return null;
      }
      activeRun.observer.onEvent({
        type: "session.thinking",
        text: delta,
        mode: "delta"
      });
      return null;
    }
    case "Thinking": {
      const text = extractText(payload).trim();
      if (!text) {
        return null;
      }
      activeRun.observer.onEvent({
        type: "session.thinking",
        text,
        mode: "full"
      });
      return null;
    }
    case "AgentMessage": {
      const message = extractText(payload);
      if (!message.trim()) {
        return null;
      }
      logDebug(`AgentMessage len=${message.length} preview=${JSON.stringify(previewText(message))}`);
      markFirstStdout(activeRun, nowMs);
      activeRun.finalMessage = message;
      activeRun.observer.onEvent({ type: "log", stream: "stdout", text: message });
      activeRun.emittedStdout = true;
      return null;
    }
    case "ToolStart":
    case "ToolUpdate":
    case "TurnStart": {
      markFirstEvent(activeRun, nowMs);
      if (variantName === "ToolStart") {
        const tool = extractToolCall("ToolStart", payload);
        if (tool) {
          activeRun.observer.onEvent({ type: "session.tool", phase: "start", tool });
        }
      }
      const process =
        variantName === "TurnStart" ? undefined : buildProcessLaneFromToolPayload(variantName, payload, activeRun.processLane);
      if (process) {
        activeRun.processLane = process;
        activeRun.observer.onEvent({ type: "process.update", process });
      } else {
        const detail = extractText(payload).trim();
        activeRun.observer.onEvent({
          type: "log",
          stream: "system",
          text: detail ? `Ante ${variantName}: ${detail}` : `Ante ${variantName}`
        });
      }
      return null;
    }
    case "ToolEnd": {
      markFirstEvent(activeRun, nowMs);
      const tool = extractToolCall("ToolEnd", payload);
      if (tool) {
        activeRun.observer.onEvent({ type: "session.tool", phase: "end", tool });
      }
      const process = buildProcessLaneFromToolPayload("ToolEnd", payload, activeRun.processLane);
      if (process) {
        activeRun.processLane = process;
        activeRun.observer.onEvent({ type: "process.update", process });
      } else {
        const detail = extractText(payload).trim();
        activeRun.observer.onEvent({
          type: "log",
          stream: "system",
          text: detail ? `Ante ToolEnd: ${detail}` : "Ante ToolEnd"
        });
      }
      return null;
    }
    case "TurnPause": {
      markFirstEvent(activeRun, nowMs);
      const approval = extractTurnPauseApproval(payload);
      if (approval) {
        activeRun.processLane = buildApprovalProcessLane(approval, activeRun.processLane?.steps);
        activeRun.observer.onEvent({
          type: "process.update",
          process: activeRun.processLane
        });
        if (activeRun.autoApproveTools && !approvalHasFileEditingTools(approval)) {
          activeRun.observer.onEvent({
            type: "log",
            stream: "system",
            text: describeAutoApprovedTools(approval)
          });
          respondToApproval(approval, "AcceptForSession");
          return null;
        }
        activeRun.observer.onEvent({
          type: "session.approval",
          approval
        });
        return null;
      }
      const detail = extractTurnPauseDetail(payload);
      activeRun.observer.onEvent({
        type: "log",
        stream: "system",
        text: detail ? `Ante TurnPause: ${detail}` : "Ante TurnPause"
      });
      return null;
    }
    case "UsageUpdate":
      activeRun.observer.onEvent({
        type: "session.usage",
        usage: extractUsage(payload)
      });
      return null;
    case "CompactStart":
      activeRun.observer.onEvent({
        type: "session.compaction",
        phase: "start"
      });
      return null;
    case "CompactEnd":
      activeRun.observer.onEvent({
        type: "session.compaction",
        phase: "end"
      });
      return null;
    case "Info":
      activeRun.observer.onEvent({
        type: "session.info",
        level: "info",
        message: extractInfoMessage(payload)
      });
      return null;
    case "Goodbye":
      activeRun.observer.onEvent({
        type: "session.info",
        level: "goodbye",
        message: extractInfoMessage(payload)
      });
      return null;
    case "TurnEnd": {
      const status = extractTurnStatus(payload)?.toLowerCase();
      const errorMessage = extractErrorMessage(payload);
      const isSuccess = Boolean(status && ["completed", "success", "succeeded", "ok"].includes(status));
      const isInterrupted = Boolean(status && ["interrupted", "cancelled", "canceled", "aborted"].includes(status));
      const completedAtMs = nowMs();
      const totalMs = Math.round(completedAtMs - activeRun.startedAtMs);
      const sessionBootMs =
        activeRun.sessionReadyAtMs != null ? Math.round(activeRun.sessionReadyAtMs - activeRun.startedAtMs) : null;
      const postSendToFirstEventMs =
        activeRun.userInputSentAtMs != null && activeRun.firstEventAtMs != null
          ? Math.round(activeRun.firstEventAtMs - activeRun.userInputSentAtMs)
          : null;
      const postSendToFirstStdoutMs =
        activeRun.userInputSentAtMs != null && activeRun.firstStdoutAtMs != null
          ? Math.round(activeRun.firstStdoutAtMs - activeRun.userInputSentAtMs)
          : null;
      logDebug(
        `timing total=${totalMs}ms${sessionBootMs != null ? ` session=${sessionBootMs}ms` : ""}${postSendToFirstEventMs != null ? ` send->event=${postSendToFirstEventMs}ms` : ""}${postSendToFirstStdoutMs != null ? ` send->stdout=${postSendToFirstStdoutMs}ms` : ""}`
      );
      if (interruptPending && isInterrupted) {
        return { status: "cancelled" };
      }
      if (!isSuccess) {
        activeRun.observer.onEvent({ type: "process.update", process: undefined });
        activeRun.observer.onEvent({ type: "session.failed", error: errorMessage });
        return { status: "failed", error: errorMessage };
      }
      if (activeRun.finalMessage.trim()) {
        logDebug(
          `TurnEnd finalMessage len=${activeRun.finalMessage.length} preview=${JSON.stringify(previewText(activeRun.finalMessage, 1000))}`
        );
        const parsedEvents = parseAssistantMessage(activeRun.finalMessage);
        logDebug(
          `TurnEnd parsedEvents count=${parsedEvents.length} types=${parsedEvents.map((event) => event.type).join(",") || "none"}`
        );
        for (const event of parsedEvents) {
          activeRun.observer.onEvent(event);
        }
      } else {
        logDebug("TurnEnd finalMessage empty");
      }
      activeRun.observer.onEvent({ type: "process.update", process: undefined });
      activeRun.observer.onEvent({ type: "session.completed", summary: "Ante session completed" });
      return { status: "completed" };
    }
    default:
      return null;
  }
};
