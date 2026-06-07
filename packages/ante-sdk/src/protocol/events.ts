import type {
  ApprovalRequest,
  ModelSpec,
  ProcessLane,
  ProcessStep,
  ProviderSpec,
  ToolCall,
  Usage
} from "../types";

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

const findNestedNumberField = (value: unknown, keys: string[]): number | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findNestedNumberField(entry, keys);
      if (nested != null) {
        return nested;
      }
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  for (const nestedValue of Object.values(record)) {
    const nested = findNestedNumberField(nestedValue, keys);
    if (nested != null) {
      return nested;
    }
  }
  return undefined;
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
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  const direct = findNestedStringField(value, ["message", "error", "description", "details"]);
  if (direct) {
    return direct;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Check status.Failed pattern
    if (record.status && typeof record.status === "object" && !Array.isArray(record.status)) {
      const statusRecord = record.status as Record<string, unknown>;
      if (statusRecord.Failed) {
        if (typeof statusRecord.Failed === "string") {
          return statusRecord.Failed;
        }
        if (statusRecord.Failed && typeof statusRecord.Failed === "object") {
          const nested = findNestedStringField(statusRecord.Failed, ["message", "error", "description", "details"]);
          if (nested) {
            return nested;
          }
          try {
            return JSON.stringify(statusRecord.Failed);
          } catch {
            return String(statusRecord.Failed);
          }
        }
      }
    }
    // General fallback: serialize the payload
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return "Ante returned an unknown error";
};

export const extractUsage = (value: unknown): Usage => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { raw: value };
  }

  return {
    promptTokens: findNestedNumberField(value, [
      "prompt_tokens",
      "promptTokens",
      "input_tokens",
      "inputTokens",
      "prompt_token_count",
      "input_token_count"
    ]),
    completionTokens: findNestedNumberField(value, [
      "completion_tokens",
      "completionTokens",
      "output_tokens",
      "outputTokens",
      "completion_token_count",
      "output_token_count"
    ]),
    totalTokens: findNestedNumberField(value, [
      "total_tokens",
      "totalTokens",
      "total_token_count"
    ]),
    raw: value
  };
};

export const extractInfoMessage = (value: unknown): string | undefined => {
  const text = extractText(value).trim();
  if (text) {
    return text;
  }
  const direct = findNestedStringField(value, ["message", "text", "content", "details"]);
  return direct?.trim() || undefined;
};

export const extractTurnPauseApproval = (value: unknown): ApprovalRequest | null => {
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
      ? approvalRecord.tools.reduce<ApprovalRequest["tools"]>((all, tool) => {
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

const normalizeProcessStepStatus = (value: unknown): ProcessStep["status"] => {
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

const extractTodoSteps = (value: unknown): ProcessStep[] => {
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
    return candidate.reduce<ProcessStep[]>((steps, entry, index) => {
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
  current: ProcessLane | undefined
): ProcessLane | undefined => {
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

export const extractToolCall = (
  eventName: "ToolStart" | "ToolEnd",
  payload: unknown
): ToolCall | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const idCandidate = eventName === "ToolEnd" ? record.tool_use_id : record.id;
  const id = typeof idCandidate === "string" ? idCandidate.trim() : "";
  if (!id) {
    return null;
  }

  const name = getStringField(record, ["name", "tool_name"]) ?? "Tool";
  const argsText =
    record.args && typeof record.args === "object" && !Array.isArray(record.args) ? JSON.stringify(record.args) : undefined;
  const resultText =
    record.result_json == null
      ? undefined
      : typeof record.result_json === "string"
        ? record.result_json
        : typeof record.result_json === "object" && !Array.isArray(record.result_json)
          ? JSON.stringify(record.result_json)
          : undefined;
  const status = getStringField(record, ["status"]) ?? undefined;

  return {
    id,
    name,
    argsText,
    resultText,
    status,
    isError: record.is_error === true
  };
};

export const extractSessionId = (value: unknown): string | null => getStringField(value, ["session_id", "sessionId", "id"]);

export const extractModelSpec = (value: unknown): ModelSpec | null => {
  if (typeof value === "string" && value.trim()) {
    return { name: value.trim() };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) {
    return null;
  }
  return {
    name,
    description: typeof record.description === "string" && record.description.trim() ? record.description.trim() : undefined,
    thinking: typeof record.thinking === "string" && record.thinking.trim() ? record.thinking.trim() : undefined
  };
};

export const extractSessionModelSpec = (value: unknown): ModelSpec | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return extractModelSpec((value as Record<string, unknown>).model);
};

export const extractProviderSpec = (value: unknown): ProviderSpec | null => {
  if (typeof value === "string" && value.trim()) {
    return { name: value.trim(), preferredModels: [] };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) {
    return null;
  }
  const rawModels = Array.isArray(record.preferred_models)
    ? record.preferred_models
    : Array.isArray(record.preferredModels)
      ? record.preferredModels
      : [];
  return {
    name,
    displayName:
      typeof record.display_name === "string" && record.display_name.trim()
        ? record.display_name.trim()
        : typeof record.displayName === "string" && record.displayName.trim()
          ? record.displayName.trim()
          : undefined,
    baseUrl:
      typeof record.base_url === "string" && record.base_url.trim()
        ? record.base_url.trim()
        : typeof record.baseUrl === "string" && record.baseUrl.trim()
          ? record.baseUrl.trim()
          : undefined,
    preferredModels: rawModels.flatMap((entry) => {
      const model = extractModelSpec(entry);
      return model ? [model] : [];
    })
  };
};

export const extractSessionProviderSpec = (value: unknown): ProviderSpec | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return extractProviderSpec((value as Record<string, unknown>).provider);
};

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

const extractJsonCandidates = (value: string): string[] => {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const normalized = trimmed.replace(/\s*\[end_turn\]\s*$/i, "").trim();
  const candidates: string[] = [];
  const exactFence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(normalized);
  if (exactFence?.[1]) {
    candidates.push(exactFence[1].trim());
  }

  const fencePattern = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  for (const match of normalized.matchAll(fencePattern)) {
    const candidate = match[1]?.trim();
    if (candidate) {
      candidates.push(candidate);
    }
  }

  candidates.push(normalized);
  return [...new Set(candidates)];
};

const parseJsonPayload = (value: string): unknown => {
  for (const candidate of extractJsonCandidates(value)) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next candidate, for example a fenced JSON block inside prose.
    }
  }
  return null;
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

export const parseAssistantMessage = (message: string): Array<{ type: "result.text"; text: string }> => {
  const parsed = parseJsonPayload(message);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      return [{ type: "result.text", text: record.text }];
    }
  }

  const fallbackText = extractStructuredTextFallback(message);
  if (fallbackText != null) {
    return [{ type: "result.text", text: fallbackText }];
  }

  return [{ type: "result.text", text: message.trim() }];
};
