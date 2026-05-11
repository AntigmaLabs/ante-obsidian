import { buildApprovalResponseOperation } from "./approval";
import { permissionModeToPolicy, resolveOptions, type ResolvedOptions } from "./options";
import { createTransport } from "../transport/factory";
import type { AnteTransport } from "../transport/transport";
import type { ApprovalDecision, ApprovalRequest, Options, SDKMessage } from "../types";
import {
  buildProcessLaneFromToolPayload,
  extractErrorMessage,
  extractInfoMessage,
  extractSessionId,
  extractText,
  extractToolCall,
  extractTurnPauseApproval,
  extractTurnStatus,
  extractUsage,
  getVariant
} from "../protocol/events";
import { generateOpId, parseEnvelope, serializeOperation, type AnteOperation } from "../protocol/wire";

export interface AnteClient {
  connect(): Promise<void>;
  startSession(): Promise<string>;
  resumeSession(sessionId: string): Promise<string>;
  sendUserInput(prompt: string): string;
  respondToApproval(approval: ApprovalRequest, decision: ApprovalDecision): void;
  interrupt(): void;
  shutdown(): void;
  close(): void;
  setMessageHandler(handler: (message: SDKMessage) => void): void;
  setDoneHandler(handler: (result: { status: "completed" | "failed" | "cancelled"; error?: string }) => void): void;
  getSessionId(): string | null;
}

export class AnteProtocolClient implements AnteClient {
  private readonly options: ResolvedOptions;
  private readonly transport: AnteTransport;
  private onMessage: (message: SDKMessage) => void = () => {};
  private onDone: (result: { status: "completed" | "failed" | "cancelled"; error?: string }) => void = () => {};
  private sessionId: string | null = null;
  private finalText = "";
  private activeInputOpId: string | null = null;
  private pendingSession:
    | {
        targetSessionId?: string;
        resolve: (sessionId: string) => void;
        reject: (error: Error) => void;
      }
    | null = null;

  constructor(options: Options = {}, transportFactory: (options: ResolvedOptions) => AnteTransport = createTransport) {
    this.options = resolveOptions(options);
    this.transport = transportFactory(this.options);
  }

  async connect(): Promise<void> {
    this.transport.setMessageHandler((line) => this.handleTransportMessage(line));
    this.transport.setDiagnosticHandler((event) => {
      this.options.stderr?.(event.text);
      this.emit({ type: "system", subtype: "diagnostic", stream: event.stream, text: event.text, session_id: this.sessionId ?? undefined });
    });
    this.transport.setErrorHandler((error) => {
      this.rejectPendingSession(error);
      this.emitDone({ status: "failed", error: error.message });
    });
    this.transport.setCloseHandler((info) => {
      if (info?.reason === "SIGTERM") {
        this.rejectPendingSession(new Error("Ante server exited after SIGTERM"));
        this.emitDone({ status: "cancelled" });
        return;
      }
      const error = new Error(`Ante server exited with code ${info?.code ?? "unknown"}`);
      this.rejectPendingSession(error);
      this.emitDone({ status: "failed", error: error.message });
    });
    await this.transport.connect();
  }

  startSession(): Promise<string> {
    if (!this.options.model.trim() || !this.options.provider.trim()) {
      throw new Error("Ante model and provider are required");
    }
    this.sendOperation({
      StartSession: {
        model: this.options.model,
        provider: this.options.provider,
        streaming: true,
        thinking: this.options.thinking,
        policy: permissionModeToPolicy(this.options.permissionMode),
        system_prompt: this.options.systemPrompt,
        append_system_prompt: this.options.appendSystemPrompt,
        allowed_tools: this.options.allowedTools,
        disallowed_tools: this.options.disallowedTools,
        cwd: this.options.cwd
      }
    });
    return this.createPendingSession();
  }

  resumeSession(sessionId: string): Promise<string> {
    this.sendOperation({ ResumeSession: { session_id: sessionId } });
    return this.createPendingSession(sessionId);
  }

  sendUserInput(prompt: string): string {
    const opId = this.sendOperation({ UserInput: prompt });
    this.activeInputOpId = opId;
    return opId;
  }

  respondToApproval(approval: ApprovalRequest, decision: ApprovalDecision): void {
    this.sendOperation(buildApprovalResponseOperation(approval, decision));
  }

  interrupt(): void {
    this.sendOperation("Interrupt");
  }

  shutdown(): void {
    this.sendOperation("Shutdown");
  }

  close(): void {
    this.rejectPendingSession(new Error("Ante client closed"));
    this.transport.disconnect();
  }

  setMessageHandler(handler: (message: SDKMessage) => void): void {
    this.onMessage = handler;
  }

  setDoneHandler(handler: (result: { status: "completed" | "failed" | "cancelled"; error?: string }) => void): void {
    this.onDone = handler;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  private sendOperation(op: AnteOperation): string {
    const opId = generateOpId();
    this.transport.send(serializeOperation(op, opId));
    return opId;
  }

  private handleTransportMessage(line: string): void {
    const envelope = parseEnvelope(line);
    if (!envelope) {
      this.emit({ type: "system", subtype: "diagnostic", stream: "stdout", text: line, session_id: this.sessionId ?? undefined });
      return;
    }

    const variant = getVariant(envelope.event);
    if (!variant) {
      return;
    }
    if (!this.isLifecycleVariant(variant.name) && this.activeInputOpId && envelope.parent && envelope.parent !== this.activeInputOpId) {
      return;
    }
    this.handleVariant(variant.name, variant.payload);
  }

  private handleVariant(name: string, payload: unknown): void {
    switch (name) {
      case "SessionStart": {
        this.sessionId = extractSessionId(payload) ?? this.sessionId;
        this.resolvePendingSession(this.sessionId);
        this.emit({
          type: "system",
          subtype: "init",
          session_id: this.sessionId ?? "",
          cwd: this.options.cwd,
          model: this.options.model,
          provider: this.options.provider,
          permissionMode: this.options.permissionMode
        });
        return;
      }
      case "MessageDelta": {
        const text = extractText(payload);
        if (text) {
          this.finalText += text;
          this.emit({ type: "stream_event", event: { type: "text_delta", text }, session_id: this.sessionId ?? undefined });
        }
        return;
      }
      case "ThinkingDelta": {
        const text = extractText(payload);
        if (text) {
          this.emit({ type: "stream_event", event: { type: "thinking_delta", text }, session_id: this.sessionId ?? undefined });
        }
        return;
      }
      case "AgentMessage": {
        const text = extractText(payload);
        if (text) {
          this.finalText = text;
          this.emit({ type: "assistant", message: { content: [{ type: "text", text }] }, session_id: this.sessionId ?? undefined });
        }
        return;
      }
      case "ToolStart":
      case "ToolEnd": {
        const tool = extractToolCall(name, payload);
        if (tool) {
          this.emit({ type: "tool", phase: name === "ToolStart" ? "start" : "end", tool, session_id: this.sessionId ?? undefined });
          return;
        }
        const process = buildProcessLaneFromToolPayload(name, payload, undefined);
        this.emit({
          type: "system",
          subtype: "diagnostic",
          stream: "system",
          text: process?.label ?? `Ante ${name}`,
          session_id: this.sessionId ?? undefined
        });
        return;
      }
      case "TurnPause": {
        const approval = extractTurnPauseApproval(payload);
        if (approval) {
          this.emit({ type: "approval", approval, session_id: this.sessionId ?? undefined });
        }
        return;
      }
      case "UsageUpdate":
        this.emit({ type: "usage", usage: extractUsage(payload), session_id: this.sessionId ?? undefined });
        return;
      case "CompactStart":
        this.emit({ type: "system", subtype: "status", status: "compacting", session_id: this.sessionId ?? undefined });
        return;
      case "CompactEnd":
        this.emit({ type: "system", subtype: "status", status: null, session_id: this.sessionId ?? undefined });
        return;
      case "Info":
      case "Goodbye":
        this.emit({
          type: "system",
          subtype: "diagnostic",
          stream: "system",
          text: extractInfoMessage(payload) ?? name,
          session_id: this.sessionId ?? undefined
        });
        return;
      case "Error": {
        const error = extractErrorMessage(payload);
        this.emit({ type: "result", subtype: "error", error, session_id: this.sessionId ?? undefined });
        this.rejectPendingSession(new Error(error));
        this.emitDone({ status: "failed", error });
        return;
      }
      case "TurnEnd": {
        const status = extractTurnStatus(payload)?.toLowerCase();
        const interrupted = Boolean(status && ["interrupted", "cancelled", "canceled", "aborted"].includes(status));
        if (interrupted) {
          this.emit({ type: "result", subtype: "cancelled", session_id: this.sessionId ?? undefined });
          this.emitDone({ status: "cancelled" });
          return;
        }
        this.emit({ type: "result", subtype: "success", result: this.finalText, session_id: this.sessionId ?? undefined });
        this.emitDone({ status: "completed" });
        return;
      }
      case "SessionEnd":
        this.close();
        return;
      default:
        return;
    }
  }

  private emit(message: SDKMessage): void {
    this.onMessage(message);
  }

  private emitDone(result: { status: "completed" | "failed" | "cancelled"; error?: string }): void {
    this.onDone(result);
  }

  private createPendingSession(targetSessionId?: string): Promise<string> {
    if (this.pendingSession) {
      this.pendingSession.reject(new Error("Ante session transition was superseded"));
    }
    return new Promise((resolve, reject) => {
      this.pendingSession = {
        targetSessionId,
        resolve,
        reject
      };
    });
  }

  private resolvePendingSession(sessionId: string | null): void {
    const pending = this.pendingSession;
    if (!pending || !sessionId) {
      return;
    }
    if (pending.targetSessionId && pending.targetSessionId !== sessionId) {
      return;
    }
    this.pendingSession = null;
    pending.resolve(sessionId);
  }

  private rejectPendingSession(error: Error): void {
    const pending = this.pendingSession;
    if (!pending) {
      return;
    }
    this.pendingSession = null;
    pending.reject(error);
  }

  private isLifecycleVariant(name: string): boolean {
    return name === "SessionStart" || name === "Error" || name === "SessionEnd";
  }
}

export const createAnteClient = (options?: Options): AnteClient => new AnteProtocolClient(options);
