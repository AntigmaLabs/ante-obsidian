import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { buildInteractivePrompt } from "../core/runtime-prompt";
import type {
  RuntimeApprovalDecision,
  RuntimeApprovalRequest,
  RuntimeChangeSuggestion,
  RuntimeEvent,
  TaskRequest
} from "../core/types";

export interface AnteRuntimeConfig {
  command: string;
  argsJson: string;
  cwd: string;
  model: string;
  provider: string;
  autoApproveTools: boolean;
  env: Record<string, string>;
}

export interface RuntimeObserver {
  onEvent: (event: RuntimeEvent) => void;
  onExit: (result: { status: "completed" | "failed" | "cancelled"; error?: string }) => void;
}

type AnteEventEnvelope = {
  event?: unknown;
};

type ActiveRun = {
  observer: RuntimeObserver;
  request: TaskRequest;
  autoApproveTools: boolean;
  finalMessage: string;
  emittedStdout: boolean;
  completed: boolean;
};

type AnteServerState = {
  child: ChildProcessWithoutNullStreams;
  signature: string;
};

const ensureServeArgs = (args: string[]): string[] => {
  if (!args.includes("serve")) {
    args.unshift("serve");
  }
  if (!args.includes("--stdio")) {
    args.push("--stdio");
  }
  return args;
};

const generateUlid = (): string => {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let timestamp = Date.now();
  let result = "";
  for (let index = 0; index < 10; index += 1) {
    result = alphabet[timestamp % 32] + result;
    timestamp = Math.floor(timestamp / 32);
  }
  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  for (let index = 0; index < randomBytes.length; index += 1) {
    result += alphabet[randomBytes[index] % 32];
  }
  return result;
};

const generateOpId = (): string => `op_${generateUlid()}`;

const configSignature = (config: AnteRuntimeConfig): string =>
  JSON.stringify({
    command: config.command.trim(),
    argsJson: config.argsJson.trim(),
    cwd: config.cwd.trim(),
    model: config.model.trim(),
    provider: config.provider.trim(),
    env: Object.entries(config.env)
      .filter(([, value]) => value.trim())
      .sort(([left], [right]) => left.localeCompare(right))
  });

const getVariant = (event: unknown): { name: string; payload: unknown } | null => {
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

const extractText = (value: unknown): string => {
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

const extractErrorMessage = (value: unknown): string => {
  const direct = findNestedStringField(value, ["message", "error", "description", "details"]);
  return direct ?? "Ante returned an unknown error";
};

const extractTurnPauseDetail = (value: unknown): string => {
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

const extractTurnPauseApproval = (value: unknown): RuntimeApprovalRequest | null => {
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

const extractSessionId = (value: unknown): string | null => getStringField(value, ["session_id", "sessionId", "id"]);
const extractTurnStatus = (value: unknown): string | null => {
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

const flushBufferedLines = (buffer: string, emit: (line: string) => void): string => {
  const lines = buffer.split(/\r?\n/);
  const pending = lines.pop() ?? "";
  for (const line of lines) {
    emit(line);
  }
  return pending;
};

const parseJsonPayload = (value: string): unknown | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
};

const parseAssistantMessage = (message: string): RuntimeEvent => {
  const parsed = parseJsonPayload(message);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      return { type: "result.text", text: record.text };
    }
    if (
      record.type === "change" &&
      typeof record.operation === "string" &&
      typeof record.afterText === "string"
    ) {
      return {
        type: "result.change",
        change: {
          kind: "change",
          operation: record.operation as RuntimeChangeSuggestion["operation"],
          targetPath: typeof record.targetPath === "string" ? record.targetPath : undefined,
          afterText: record.afterText,
          title: typeof record.title === "string" ? record.title : undefined,
          summary: typeof record.summary === "string" ? record.summary : undefined
        }
      };
    }
  }

  return { type: "result.text", text: message.trim() };
};

export const __test__ = {
  extractErrorMessage,
  extractTurnPauseApproval,
  extractTurnStatus
};

export class AnteServeRuntimeAdapter {
  private server: AnteServerState | null = null;
  private activeRun: ActiveRun | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private sessionId: string | null = null;

  constructor(private readonly getConfig: () => AnteRuntimeConfig) {}

  run(request: TaskRequest, observer: RuntimeObserver): void {
    const config = this.getConfig();
    if (!config.command.trim()) {
      observer.onExit({ status: "failed", error: "Ante command is required" });
      return;
    }
    if (!config.model.trim() || !config.provider.trim()) {
      observer.onExit({ status: "failed", error: "Ante model and provider are required" });
      return;
    }
    if (this.activeRun) {
      observer.onExit({ status: "failed", error: "Another Ante task is already running" });
      return;
    }

    const shouldReuse = request.mode === "followup" && this.server && this.sessionId && this.server.signature === configSignature(config);
    if (!shouldReuse) {
      this.stopServer();
      if (!this.startServer(config, observer)) {
        return;
      }
      this.sessionId = null;
      observer.onEvent({
        type: "log",
        stream: "system",
        text: `Launching Ante server · provider=${config.provider.trim()} · model=${config.model.trim()} · cwd=${config.cwd.trim() || process.cwd()}`
      });
    } else {
      observer.onEvent({
        type: "log",
        stream: "system",
        text: `Reusing existing Ante session · provider=${config.provider.trim()} · model=${config.model.trim()}`
      });
    }

    this.activeRun = {
      observer,
      request,
      autoApproveTools: config.autoApproveTools,
      finalMessage: "",
      emittedStdout: false,
      completed: false
    };

    if (shouldReuse && this.sessionId) {
      observer.onEvent({ type: "runtime.session", provider: "ante", sessionId: this.sessionId });
      this.sendUserInput(request);
      return;
    }

    this.sendOperation({
      StartSession: {
        model: config.model.trim(),
        provider: config.provider.trim(),
        streaming: true
      }
    });
  }

  cancelActiveRun(): void {
    if (this.activeRun) {
      const observer = this.activeRun.observer;
      this.activeRun = null;
      this.stopServer();
      observer.onExit({ status: "cancelled" });
    }
  }

  dispose(): void {
    this.cancelActiveRun();
    this.stopServer();
  }

  respondToApproval(approval: RuntimeApprovalRequest, decision: RuntimeApprovalDecision): void {
    if (!this.server || !this.activeRun) {
      throw new Error("Ante is not waiting for approval");
    }
    const responses = approval.tools.map((tool) => [tool.id, decision]);
    if (responses.length === 0) {
      throw new Error("Ante approval request did not include any tools");
    }
    this.sendOperation({
      ApprovalResponse: {
        turn_id: approval.turnId,
        responses
      }
    });
  }

  private startServer(config: AnteRuntimeConfig, observer: RuntimeObserver): boolean {
    try {
      const args = ensureServeArgs(this.parseArgs(config.argsJson));
      const child = spawn(config.command.trim(), args, {
        cwd: config.cwd.trim() || undefined,
        env: {
          ...process.env,
          ...config.env
        },
        stdio: ["pipe", "pipe", "pipe"]
      });
      this.server = {
        child,
        signature: configSignature(config)
      };
      this.stdoutBuffer = "";
      this.stderrBuffer = "";

      child.stdout.on("data", (chunk: Buffer) => {
        this.stdoutBuffer += chunk.toString("utf8");
        this.stdoutBuffer = flushBufferedLines(this.stdoutBuffer, (line) => this.handleStdoutLine(line));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        this.stderrBuffer += chunk.toString("utf8");
        this.stderrBuffer = flushBufferedLines(this.stderrBuffer, (line) => {
          this.activeRun?.observer.onEvent({ type: "log", stream: "stderr", text: line });
        });
      });
      child.once("error", (error) => {
        if (this.server?.child !== child) {
          return;
        }
        observer.onExit({ status: "failed", error: error.message });
        this.activeRun = null;
        this.stopServer();
      });
      child.once("close", (code, signal) => {
        if (this.server?.child !== child) {
          return;
        }
        const activeRun = this.activeRun;
        this.stopServer();
        if (!activeRun || activeRun.completed) {
          this.activeRun = null;
          return;
        }
        activeRun.observer.onExit({
          status: signal === "SIGTERM" ? "cancelled" : "failed",
          error: signal === "SIGTERM" ? undefined : `Ante server exited with code ${code ?? "unknown"}`
        });
        this.activeRun = null;
      });
      return true;
    } catch (error) {
      observer.onExit({
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  private handleStdoutLine(line: string): void {
    if (!line.trim()) {
      return;
    }

    let envelope: AnteEventEnvelope;
    try {
      envelope = JSON.parse(line) as AnteEventEnvelope;
    } catch {
      this.activeRun?.observer.onEvent({ type: "log", stream: "stderr", text: line });
      return;
    }

    const variant = getVariant(envelope.event);
    if (!variant || !this.activeRun) {
      return;
    }

    switch (variant.name) {
      case "SessionStart": {
        const sessionId = extractSessionId(variant.payload) ?? crypto.randomUUID();
        this.sessionId = sessionId;
        this.activeRun.observer.onEvent({ type: "runtime.session", provider: "ante", sessionId });
        this.sendUserInput(this.activeRun.request);
        return;
      }
      case "MessageDelta": {
        const delta = extractText(variant.payload);
        if (!delta) {
          return;
        }
        this.activeRun.finalMessage += delta;
        this.activeRun.observer.onEvent({ type: "log", stream: "stdout", text: delta });
        this.activeRun.emittedStdout = true;
        return;
      }
      case "AgentMessage": {
        const message = extractText(variant.payload);
        if (!message.trim()) {
          return;
        }
        this.activeRun.finalMessage = message;
        this.activeRun.observer.onEvent({ type: "log", stream: "stdout", text: message });
        this.activeRun.emittedStdout = true;
        return;
      }
      case "ToolStart":
      case "ToolUpdate":
      case "ToolEnd":
      case "TurnStart": {
        const detail = extractText(variant.payload).trim();
        this.activeRun.observer.onEvent({
          type: "log",
          stream: "system",
          text: detail ? `Ante ${variant.name}: ${detail}` : `Ante ${variant.name}`
        });
        return;
      }
      case "TurnPause": {
        const approval = extractTurnPauseApproval(variant.payload);
        if (approval) {
          if (this.activeRun.autoApproveTools) {
            this.activeRun.observer.onEvent({
              type: "log",
              stream: "system",
              text: `Ante auto-approved ${approval.tools.map((tool) => tool.name).join(", ") || "tool call"}`
            });
            this.respondToApproval(approval, "AcceptForSession");
          } else {
            this.activeRun.observer.onEvent({
              type: "session.approval",
              approval
            });
          }
        }
        const detail = extractTurnPauseDetail(variant.payload);
        this.activeRun.observer.onEvent({
          type: "log",
          stream: "system",
          text: detail ? `Ante TurnPause: ${detail}` : "Ante TurnPause"
        });
        return;
      }
      case "Error": {
        const message = extractErrorMessage(variant.payload);
        this.activeRun.observer.onEvent({ type: "session.failed", error: message });
        this.activeRun.completed = true;
        this.activeRun.observer.onExit({ status: "failed", error: message });
        this.activeRun = null;
        return;
      }
      case "TurnEnd": {
        const status = extractTurnStatus(variant.payload)?.toLowerCase();
        const errorMessage = extractErrorMessage(variant.payload);
        const isSuccess = Boolean(status && ["completed", "success", "succeeded", "ok"].includes(status));
        if (!isSuccess) {
          this.activeRun.observer.onEvent({ type: "session.failed", error: errorMessage });
          this.activeRun.completed = true;
          this.activeRun.observer.onExit({ status: "failed", error: errorMessage });
          this.activeRun = null;
          return;
        }
        if (this.activeRun.finalMessage.trim()) {
          this.activeRun.observer.onEvent(parseAssistantMessage(this.activeRun.finalMessage));
        }
        this.activeRun.observer.onEvent({ type: "session.completed", summary: "Ante session completed" });
        this.activeRun.completed = true;
        this.activeRun.observer.onExit({ status: "completed" });
        this.activeRun = null;
        return;
      }
      default:
        return;
    }
  }

  private sendUserInput(request: TaskRequest): void {
    this.sendOperation({
      UserInput: buildInteractivePrompt(request)
    });
  }

  private sendOperation(op: Record<string, unknown>): void {
    this.server?.child.stdin.write(`${JSON.stringify({ op, id: generateOpId() })}\n`);
  }

  private stopServer(): void {
    this.server?.child.kill("SIGTERM");
    this.server = null;
    this.sessionId = null;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
  }

  private parseArgs(rawArgs: string): string[] {
    const trimmed = rawArgs.trim();
    if (!trimmed) {
      return [];
    }
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
      throw new Error("Ante args must be a JSON string array");
    }
    return [...parsed];
  }
}
