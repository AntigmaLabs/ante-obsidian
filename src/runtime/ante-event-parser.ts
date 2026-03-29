import type {
  InsertAnchor,
  RuntimeApprovalRequest,
  RuntimeChangeSuggestion,
  RuntimeEvent,
  RuntimeProcessLane,
  RuntimeProcessStep,
  RuntimeProcessStepStatus
} from "../core/types";

const parseInsertAnchor = (value: unknown): InsertAnchor | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const by = typeof record.by === "string" ? record.by.trim() : "";
  if (by === "document-start" || by === "document-end" || by === "selection") {
    return { by };
  }
  if ((by === "heading" || by === "text") && typeof record.value === "string" && record.value.trim()) {
    return { by, value: record.value.trim() };
  }
  if (by === "paragraph-index" && typeof record.value === "number" && Number.isInteger(record.value)) {
    return { by, value: record.value };
  }
  return undefined;
};

const getStringField = (value: unknown, keys: string[]): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return null;
};

const findNestedStringField = (value: unknown, keys: string[]): string | null => {
  const direct = getStringField(value, keys);
  if (direct) {
    return direct;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findNestedStringField(entry, keys);
      if (nested) {
        return nested;
      }
    }
    return null;
  }
  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    const nested = findNestedStringField(nestedValue, keys);
    if (nested) {
      return nested;
    }
  }
  return null;
};

export const getVariant = (event: unknown): { name: string; payload: unknown } | null => {
  if (typeof event === "string") {
    return { name: event, payload: undefined };
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }
  const entries = Object.entries(event as Record<string, unknown>);
  if (entries.length !== 1) {
    return null;
  }
  return { name: entries[0][0], payload: entries[0][1] };
};

export const extractText = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => extractText(entry)).join("");
  }
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  for (const key of ["text", "delta", "message", "content"]) {
    const extracted = extractText(record[key]);
    if (extracted) {
      return extracted;
    }
  }
  for (const key of ["parts", "responses"]) {
    const extracted = extractText(record[key]);
    if (extracted) {
      return extracted;
    }
  }
  return "";
};

export const extractErrorMessage = (value: unknown): string => {
  const direct = findNestedStringField(value, ["message", "error", "description", "details"]);
  return direct ?? "Ante returned an unknown error";
};

export const extractTurnPauseApproval = (value: unknown): RuntimeApprovalRequest | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const turnId = typeof record.turn_id === "string" ? record.turn_id.trim() : "";
  const reason = record.reason;
  if (!reason || typeof reason !== "object" || Array.isArray(reason)) {
    return null;
  }
  const approval = (reason as Record<string, unknown>).Approval;
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
    return null;
  }

  const approvalRecord = approval as Record<string, unknown>;
  const message = findNestedStringField(approvalRecord, ["message"]) ?? "Please approve the following tool calls";
  const tools =
    Array.isArray(approvalRecord.tools)
      ? approvalRecord.tools.reduce<RuntimeApprovalRequest["tools"]>((all, tool) => {
          if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
            return all;
          }
          const toolRecord = tool as Record<string, unknown>;
          const name = typeof toolRecord.name === "string" ? toolRecord.name.trim() : "";
          const id = typeof toolRecord.id === "string" ? toolRecord.id.trim() : "";
          if (!id) {
            return all;
          }
          const argsText =
            toolRecord.args && typeof toolRecord.args === "object" && !Array.isArray(toolRecord.args)
              ? JSON.stringify(toolRecord.args)
              : undefined;
          all.push({
            id,
            name: name || "Tool",
            argsText
          });
          return all;
        }, [])
      : [];

  if (!turnId) {
    return null;
  }

  return {
    turnId,
    message,
    tools
  };
};

export const extractTurnPauseDetail = (value: unknown): string => {
  const approval = extractTurnPauseApproval(value);
  if (!approval) {
    return "";
  }
  const toolSummary =
    approval.tools.length > 0
      ? `Approval required for ${approval.tools.map((tool) => `${tool.name} ${tool.id}`.trim()).join(", ")}`
      : "Approval required";
  return [toolSummary, approval.message].filter(Boolean).join(": ");
};

const normalizeProcessStepStatus = (value: unknown): RuntimeProcessStepStatus => {
  if (typeof value !== "string") {
    return "pending";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "completed" || normalized === "done") {
    return "completed";
  }
  if (normalized === "in_progress" || normalized === "in-progress" || normalized === "active" || normalized === "running") {
    return "in_progress";
  }
  return "pending";
};

const extractTodoSteps = (value: unknown): RuntimeProcessStep[] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const record = value as Record<string, unknown>;
  const candidates = [
    record.todos,
    record.args && typeof record.args === "object" && !Array.isArray(record.args)
      ? (record.args as Record<string, unknown>).todos
      : undefined
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }
    return candidate.reduce<RuntimeProcessStep[]>((steps, entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return steps;
      }
      const todo = entry as Record<string, unknown>;
      const labelCandidate = typeof todo.content === "string" ? todo.content.trim() : "";
      const activeLabelCandidate = typeof todo.activeForm === "string" ? todo.activeForm.trim() : "";
      const label = labelCandidate || activeLabelCandidate;
      if (!label) {
        return steps;
      }
      steps.push({
        id: typeof todo.id === "string" && todo.id.trim() ? todo.id.trim() : `todo-${index}`,
        label,
        activeLabel: activeLabelCandidate || undefined,
        status: normalizeProcessStepStatus(todo.status)
      });
      return steps;
    }, []);
  }

  return [];
};

export const buildProcessLaneFromToolPayload = (
  eventName: "ToolStart" | "ToolUpdate" | "ToolEnd",
  payload: unknown,
  current: RuntimeProcessLane | undefined
): RuntimeProcessLane | undefined => {
  const toolName = getStringField(payload, ["name", "tool_name"]) ?? current?.toolName;
  const todoSteps = extractTodoSteps(payload);

  if (toolName === "TodoWrite" && todoSteps.length > 0) {
    const activeStep =
      todoSteps.find((step) => step.status === "in_progress") ??
      todoSteps.find((step) => step.status === "pending") ??
      todoSteps[0];
    return {
      phase: "planning",
      label: activeStep?.activeLabel ?? activeStep?.label ?? "Updating plan",
      toolName,
      steps: todoSteps
    };
  }

  if (eventName === "ToolEnd") {
    return current;
  }

  if (!toolName) {
    return undefined;
  }

  return {
    phase: "running",
    label: `Running ${toolName}`,
    toolName,
    steps: current?.steps ?? []
  };
};

export const extractSessionId = (value: unknown): string | null => getStringField(value, ["session_id", "sessionId", "id"]);

export const extractTurnStatus = (value: unknown): string | null => {
  const direct = getStringField(value, ["status", "finish_reason", "finishReason"]);
  if (direct) {
    return direct;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["status", "finish_reason", "finishReason"]) {
    const candidate = record[key];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }
    const entries = Object.entries(candidate as Record<string, unknown>);
    if (entries.length === 1 && entries[0]?.[0]) {
      return entries[0][0];
    }
  }
  return null;
};

const parseJsonPayload = (value: string): unknown | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = (fenced ? fenced[1] : trimmed).replace(/\s*\[end_turn\]\s*$/i, "").trim();
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
};

const extractTopLevelJsonObject = (value: string, startIndex = 0): string | null => {
  const normalized = value.replace(/\s*\[end_turn\]\s*$/i, "").trim();
  const start = normalized.indexOf("{", startIndex);
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return normalized.slice(start, index + 1);
      }
    }
  }

  return null;
};

const extractStructuredTextFallback = (message: string): string | null => {
  let searchFrom = 0;
  while (true) {
    const candidate = extractTopLevelJsonObject(message, searchFrom);
    if (!candidate) {
      return null;
    }

    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (record.type === "text" && typeof record.text === "string") {
          return record.text;
        }
      }
    } catch {
      // Keep scanning later brace-delimited objects.
    }

    const nextSearchStart = message.indexOf(candidate, searchFrom);
    if (nextSearchStart < 0) {
      return null;
    }
    searchFrom = nextSearchStart + candidate.length;
  }
};

export const parseAssistantMessage = (message: string): RuntimeEvent[] => {
  const parsed = parseJsonPayload(message);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      return [{ type: "result.text", text: record.text }];
    }
    if (record.type === "change" && typeof record.operation === "string" && typeof record.afterText === "string") {
      return [{
        type: "result.change",
        change: {
          kind: "change",
          operation: record.operation as RuntimeChangeSuggestion["operation"],
          targetPath: typeof record.targetPath === "string" ? record.targetPath : undefined,
          afterText: record.afterText,
          anchor: parseInsertAnchor(record.anchor),
          placement: record.placement === "before" || record.placement === "after" ? record.placement : undefined,
          title: typeof record.title === "string" ? record.title : undefined,
          summary: typeof record.summary === "string" ? record.summary : undefined
        }
      }];
    }
    if (record.type === "changes" && Array.isArray(record.changes)) {
      const changes = record.changes.flatMap((entry): RuntimeChangeSuggestion[] => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return [];
        }
        const change = entry as Record<string, unknown>;
        if (typeof change.operation !== "string" || typeof change.afterText !== "string") {
          return [];
        }
        return [
          {
            kind: "change",
            operation: change.operation as RuntimeChangeSuggestion["operation"],
            targetPath: typeof change.targetPath === "string" ? change.targetPath : undefined,
            afterText: change.afterText,
            anchor: parseInsertAnchor(change.anchor),
            placement: change.placement === "before" || change.placement === "after" ? change.placement : undefined,
            title: typeof change.title === "string" ? change.title : undefined,
            summary: typeof change.summary === "string" ? change.summary : undefined
          }
        ];
      });
      if (changes.length > 0) {
        return [{ type: "result.changes", changes }];
      }
    }
  }

  const fallbackText = extractStructuredTextFallback(message);
  if (fallbackText != null) {
    return [{ type: "result.text", text: fallbackText }];
  }

  return [{ type: "result.text", text: message.trim() }];
};
