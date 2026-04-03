import { buildInteractivePrompt } from "../core/runtime-prompt";
import type {
  RuntimeApprovalDecision,
  RuntimeApprovalRequest,
  RuntimeProcessLane,
  TaskRequest
} from "../core/types";
import {
  buildProcessLaneFromToolPayload,
  extractErrorMessage,
  extractSessionId,
  extractText,
  extractTurnPauseApproval,
  extractTurnPauseDetail,
  extractTurnStatus,
  getVariant,
  parseAssistantMessage
} from "./ante-event-parser";
import { generateOpId, parseEnvelope, serializeOperation } from "./ante-protocol";
import type { AnteRuntime, RuntimeObserver } from "./ante-runtime";
import type { AnteTransport } from "./transport/ante-transport";

export interface AnteRuntimeConfig {
  connectionMode: "stdio" | "websocket";
  command: string;
  argsJson: string;
  cwd: string;
  wsAddress: string;
  model: string;
  provider: string;
  autoApproveTools: boolean;
  env: Record<string, string>;
}

type ActiveRun = {
  observer: RuntimeObserver;
  request: TaskRequest;
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
};

type WarmupState = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
};

type SessionTransitionKind = "start" | "resume";

type SessionTransitionState = {
  kind: SessionTransitionKind;
  observer: RuntimeObserver;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  targetSessionId?: string;
  hasSeenTargetSession: boolean;
  settleTimer: ReturnType<typeof setTimeout> | null;
};

type ShutdownState = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

const logDebug = (...args: unknown[]): void => {
  if (globalThis.localStorage?.getItem("tmd-debug") === "true") {
    console.info("[tmd]", ...args);
  }
};

const emitDiagnosticLog = (observer: RuntimeObserver | null | undefined, text: string): void => {
  console.info("[tmd session]", text);
  observer?.onEvent({
    type: "log",
    stream: "system",
    text
  });
};

const normalizeProtocolErrorMessage = (message: string): string => {
  const normalized = message.trim();
  if (/Failed to resume session: .*No such file or directory/i.test(normalized)) {
    return "Ante could not restore this chat because its saved session files are missing. Start a new chat to continue.";
  }
  return normalized;
};

export const configSignature = (config: AnteRuntimeConfig): string =>
  JSON.stringify({
    connectionMode: config.connectionMode,
    command: config.command.trim(),
    argsJson: config.argsJson.trim(),
    cwd: config.cwd.trim(),
    wsAddress: config.wsAddress.trim(),
    model: config.model.trim(),
    provider: config.provider.trim(),
    env: Object.entries(config.env)
      .filter(([, value]) => value.trim())
      .sort(([left], [right]) => left.localeCompare(right))
  });

export class AnteSessionDriver implements AnteRuntime {
  private transport: AnteTransport | null = null;
  private transportGeneration = 0;
  private transportSignature: string | null = null;
  private transportStarting: { signature: string; promise: Promise<void> } | null = null;
  private activeRun: ActiveRun | null = null;
  private sessionId: string | null = null;
  private sessionStarting = false;
  private sessionTransition: SessionTransitionState | null = null;
  private shutdownState: ShutdownState | null = null;
  private warmup: WarmupState | null = null;
  private lastSentContextFingerprint: string | null = null;
  private readonly startupDiagnostics: Array<{ stream: "stdout" | "stderr"; text: string }> = [];

  constructor(
    private readonly getConfig: () => AnteRuntimeConfig,
    private readonly createTransport: (config: AnteRuntimeConfig) => AnteTransport
  ) {}

  async ensureWarmSession(): Promise<void> {
    const config = this.getConfig();
    if (!config.command.trim() || !config.model.trim() || !config.provider.trim()) {
      return;
    }

    await this.awaitPendingShutdown();

    const signature = configSignature(config);
    if (this.transportSignature === signature && this.sessionId) {
      return;
    }
    if (this.transportSignature !== signature) {
      this.stopTransport();
    }
    if (!this.transport) {
      await this.ensureTransportStarted(config);
    }

    if (!this.warmup) {
      this.warmup = this.createWarmupState();
    }
    if (!this.sessionStarting) {
      this.beginSession(config);
    }
    return this.warmup.promise;
  }

  run(request: TaskRequest, observer: RuntimeObserver): void {
    void this.runInternal(request, observer);
  }

  cancelActiveRun(): void {
    if (this.activeRun) {
      const observer = this.activeRun.observer;
      this.activeRun = null;
      this.stopTransport();
      observer.onExit({ status: "cancelled" });
    }
  }

  dispose(): void {
    this.cancelActiveRun();
    this.stopTransport();
  }

  async persistActiveSession(): Promise<void> {
    if (!this.transport || !this.transport.isConnected() || !this.sessionId || this.activeRun) {
      return;
    }
    if (this.sessionTransition) {
      await this.sessionTransition.promise;
    }
    if (this.shutdownState) {
      await this.shutdownState.promise;
      return;
    }

    const shutdown = this.createShutdownState();
    this.shutdownState = shutdown;
    emitDiagnosticLog(undefined, `Persisting Ante session via Shutdown · session=${this.sessionId}`);
    this.transport.send(serializeOperation("Shutdown", generateOpId()));
    await shutdown.promise;
  }

  getActiveSessionId(): string | null {
    return this.sessionId;
  }

  respondToApproval(approval: RuntimeApprovalRequest, decision: RuntimeApprovalDecision): void {
    if (!this.transport || !this.activeRun) {
      throw new Error("Ante is not waiting for approval");
    }
    const responses = approval.tools.map((tool) => [tool.id, decision] as [string, RuntimeApprovalDecision]);
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

  private async runInternal(request: TaskRequest, observer: RuntimeObserver): Promise<void> {
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

    await this.awaitPendingShutdown();

    const signature = configSignature(config);
    const hasCompatibleTransport = this.transportSignature === signature;
    const hasReadySession = hasCompatibleTransport && Boolean(this.sessionId) && this.transport?.isConnected();

    if (!hasCompatibleTransport) {
      this.stopTransport();
      try {
        await this.ensureTransportStarted(config);
      } catch (error) {
        const errorWithDiagnostics =
          error instanceof Error ? this.withStartupDiagnostics(error) : new Error(String(error));
        observer.onExit({
          status: "failed",
          error: errorWithDiagnostics.message
        });
        return;
      }
      this.sessionId = null;
      observer.onEvent({
        type: "log",
        stream: "system",
        text: `Launching Ante server · provider=${config.provider.trim()} · model=${config.model.trim()} · cwd=${config.cwd.trim() || process.cwd()}`
      });
    } else if (hasReadySession) {
      observer.onEvent({
        type: "log",
        stream: "system",
        text: `Reusing existing Ante session · provider=${config.provider.trim()} · model=${config.model.trim()}`
      });
    } else {
      observer.onEvent({
        type: "log",
        stream: "system",
        text: `Booting Ante session · provider=${config.provider.trim()} · model=${config.model.trim()}`
      });
    }

    try {
      emitDiagnosticLog(
        observer,
        `Session prep start · requested=${request.runtimeSessionId?.trim() || "new"} · current=${this.sessionId ?? "none"} · mode=${request.mode ?? "initial"}`
      );
      await this.ensureRequestSession(request, config, observer);
      emitDiagnosticLog(observer, `Session prep ready · active=${this.sessionId ?? "none"}`);
    } catch (error) {
      const resumeError =
        error instanceof Error ? this.withStartupDiagnostics(error) : this.withStartupDiagnostics(new Error(String(error)));
      observer.onExit({ status: "failed", error: resumeError.message });
      return;
    }

    this.activeRun = {
      observer,
      request,
      autoApproveTools: config.autoApproveTools,
      finalMessage: "",
      emittedStdout: false,
      completed: false,
      startedAtMs: performance.now()
    };

    if (this.sessionId) {
      observer.onEvent({ type: "runtime.session", provider: "ante", sessionId: this.sessionId });
    }
    this.sendUserInput(request);
  }

  private async startTransport(config: AnteRuntimeConfig): Promise<void> {
    const transport = this.createTransport(config);
    const generation = this.transportGeneration + 1;
    this.transportGeneration = generation;
    const isStaleTransport = (): boolean => generation !== this.transportGeneration || this.transport !== transport;

    transport.setMessageHandler((message) => {
      if (isStaleTransport()) {
        return;
      }
      this.handleTransportMessage(message);
    });
    transport.setDiagnosticHandler((event) => {
      if (isStaleTransport()) {
        return;
      }
      this.startupDiagnostics.push(event);
      if (this.startupDiagnostics.length > 50) {
        this.startupDiagnostics.shift();
      }
      console.info("[tmd transport]", `${event.stream}: ${event.text}`);
      this.activeRun?.observer.onEvent({ type: "log", stream: event.stream, text: event.text });
    });
    transport.setErrorHandler((error) => {
      if (isStaleTransport()) {
        return;
      }
      console.error("[tmd transport] error", error);
      const errorWithDiagnostics = this.withStartupDiagnostics(error);
      this.rejectShutdown(errorWithDiagnostics);
      this.warmup?.reject(error);
      this.warmup = null;
      this.rejectSessionTransition(errorWithDiagnostics);
      if (this.activeRun) {
        this.flushStartupDiagnostics();
        this.activeRun.observer.onExit({ status: "failed", error: errorWithDiagnostics.message });
        this.activeRun = null;
      }
      if (this.transport === transport) {
        this.stopTransport();
      }
    });
    transport.setCloseHandler((info) => {
      if (isStaleTransport()) {
        return;
      }
      console.info("[tmd transport] close", info ?? {});
      const shutdown = this.shutdownState;
      if (shutdown) {
        this.clearShutdownTimer(shutdown);
        this.shutdownState = null;
      }
      const activeRun = this.activeRun;
      if (this.transport === transport) {
        this.stopTransport();
      }
      if (shutdown) {
        shutdown.resolve();
        return;
      }
      this.rejectSessionTransition(new Error("Ante server closed during session transition"));
      if (!activeRun || activeRun.completed) {
        this.warmup?.reject(new Error("Ante server closed before the warm session became ready"));
        this.warmup = null;
        this.activeRun = null;
        return;
      }
      this.flushStartupDiagnostics();
      activeRun.observer.onExit({
        status: info?.reason === "SIGTERM" ? "cancelled" : "failed",
        error: info?.reason === "SIGTERM" ? undefined : `Ante server exited with code ${info?.code ?? "unknown"}`
      });
      this.activeRun = null;
    });
    await transport.connect();
    this.transport = transport;
    this.transportSignature = configSignature(config);
  }

  private async ensureTransportStarted(config: AnteRuntimeConfig): Promise<void> {
    if (this.transport) {
      return;
    }
    const signature = configSignature(config);
    if (!this.transportStarting || this.transportStarting.signature !== signature) {
      const promise = this.startTransport(config).finally(() => {
        if (this.transportStarting?.signature === signature) {
          this.transportStarting = null;
        }
      });
      this.transportStarting = {
        signature,
        promise
      };
    }
    await this.transportStarting.promise;
  }

  private flushStartupDiagnostics(): void {
    if (!this.activeRun) {
      return;
    }
    for (const entry of this.startupDiagnostics) {
      this.activeRun.observer.onEvent({ type: "log", stream: entry.stream, text: entry.text });
    }
    this.startupDiagnostics.length = 0;
  }

  private withStartupDiagnostics(error: Error): Error {
    if (this.startupDiagnostics.length === 0) {
      return error;
    }
    const tail = this.startupDiagnostics
      .slice(-5)
      .map((entry) => `[${entry.stream}] ${entry.text}`)
      .join(" | ");
    return new Error(`${error.message} | startup: ${tail}`);
  }

  protected handleTransportMessage(line: string): void {
    if (!line.trim()) {
      return;
    }

    const envelope = parseEnvelope(line);
    if (!envelope) {
      this.activeRun?.observer.onEvent({ type: "log", stream: "stderr", text: line });
      return;
    }

    const variant = getVariant(envelope.event);
    if (!variant) {
      return;
    }

    switch (variant.name) {
      case "SessionStart": {
        const sessionId = extractSessionId(variant.payload) ?? crypto.randomUUID();
        this.sessionId = sessionId;
        this.sessionStarting = false;
        this.warmup?.resolve();
        this.warmup = null;
        this.handleSessionTransitionSessionStart(sessionId);
        emitDiagnosticLog(this.activeRun?.observer ?? this.sessionTransition?.observer, `Protocol SessionStart · session=${sessionId} · parent=${envelope.parent ?? "none"}`);
        if (!this.activeRun) {
          return;
        }
        this.activeRun.sessionReadyAtMs = performance.now();
        this.activeRun.observer.onEvent({ type: "runtime.session", provider: "ante", sessionId });
        return;
      }
      case "Error": {
        const rawMessage = extractErrorMessage(variant.payload);
        const message = normalizeProtocolErrorMessage(rawMessage);
        const payloadText = (() => {
          try {
            return JSON.stringify(variant.payload);
          } catch {
            return String(variant.payload);
          }
        })();
        emitDiagnosticLog(
          this.activeRun?.observer ?? this.sessionTransition?.observer,
          `Protocol Error · message=${rawMessage} · parent=${envelope.parent ?? "none"} · payload=${payloadText}`
        );
        if (this.sessionTransition) {
          this.rejectSessionTransition(new Error(message));
          return;
        }
        if (this.shutdownState) {
          this.rejectShutdown(new Error(message));
          this.stopTransport();
          return;
        }
        if (!this.activeRun) {
          return;
        }
        this.activeRun.observer.onEvent({ type: "process.update", process: undefined });
        this.activeRun.observer.onEvent({ type: "session.failed", error: message });
        this.activeRun.completed = true;
        this.activeRun.observer.onExit({ status: "failed", error: message });
        this.activeRun = null;
        return;
      }
      case "SessionEnd":
        this.sessionId = null;
        emitDiagnosticLog(this.activeRun?.observer ?? this.sessionTransition?.observer, `Protocol SessionEnd · parent=${envelope.parent ?? "none"}`);
        if (this.shutdownState) {
          const shutdown = this.shutdownState;
          this.clearShutdownTimer(shutdown);
          this.shutdownState = null;
          shutdown.resolve();
          this.stopTransport();
          return;
        }
        if (!this.activeRun) {
          return;
        }
        return;
      case "ExtensionRefreshed":
        this.handleSessionTransitionExtensionRefresh(extractSessionId(variant.payload));
        emitDiagnosticLog(
          this.activeRun?.observer ?? this.sessionTransition?.observer,
          `Protocol ExtensionRefreshed · session=${extractSessionId(variant.payload) ?? "none"} · parent=${envelope.parent ?? "none"}`
        );
        if (!this.activeRun) {
          return;
        }
        return;
      case "SessionUpdated":
        if (!this.activeRun) {
          return;
        }
        return;
      default:
        if (!this.activeRun) {
          return;
        }
        break;
    }

    if (this.shouldIgnoreEventForActiveRun(envelope.parent)) {
      emitDiagnosticLog(
        this.activeRun?.observer,
        `Ignoring replay event · type=${variant.name} · parent=${envelope.parent ?? "none"} · expected=${this.activeRun?.userInputOpId ?? "none"}`
      );
      return;
    }

    switch (variant.name) {
      case "MessageDelta": {
        const delta = extractText(variant.payload);
        if (!delta) {
          return;
        }
        if (this.activeRun.firstEventAtMs == null) {
          this.activeRun.firstEventAtMs = performance.now();
        }
        if (this.activeRun.firstStdoutAtMs == null) {
          this.activeRun.firstStdoutAtMs = this.activeRun.firstEventAtMs;
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
        if (this.activeRun.firstEventAtMs == null) {
          this.activeRun.firstEventAtMs = performance.now();
        }
        if (this.activeRun.firstStdoutAtMs == null) {
          this.activeRun.firstStdoutAtMs = this.activeRun.firstEventAtMs;
        }
        this.activeRun.finalMessage = message;
        this.activeRun.observer.onEvent({ type: "log", stream: "stdout", text: message });
        this.activeRun.emittedStdout = true;
        return;
      }
      case "ToolStart":
      case "ToolUpdate":
      case "TurnStart": {
        if (this.activeRun.firstEventAtMs == null) {
          this.activeRun.firstEventAtMs = performance.now();
        }
        const process =
          variant.name === "TurnStart" ? undefined : buildProcessLaneFromToolPayload(variant.name, variant.payload, this.activeRun.processLane);
        if (process) {
          this.activeRun.processLane = process;
          this.activeRun.observer.onEvent({ type: "process.update", process });
        }
        const detail = extractText(variant.payload).trim();
        if (!process) {
          this.activeRun.observer.onEvent({
            type: "log",
            stream: "system",
            text: detail ? `Ante ${variant.name}: ${detail}` : `Ante ${variant.name}`
          });
        }
        return;
      }
      case "ToolEnd": {
        if (this.activeRun.firstEventAtMs == null) {
          this.activeRun.firstEventAtMs = performance.now();
        }
        const process = buildProcessLaneFromToolPayload("ToolEnd", variant.payload, this.activeRun.processLane);
        if (process) {
          this.activeRun.processLane = process;
          this.activeRun.observer.onEvent({ type: "process.update", process });
          return;
        }
        const detail = extractText(variant.payload).trim();
        this.activeRun.observer.onEvent({
          type: "log",
          stream: "system",
          text: detail ? "Ante ToolEnd: " + detail : "Ante ToolEnd"
        });
        return;
      }
      case "TurnPause": {
        if (this.activeRun.firstEventAtMs == null) {
          this.activeRun.firstEventAtMs = performance.now();
        }
        const approval = extractTurnPauseApproval(variant.payload);
        if (approval) {
          this.activeRun.processLane = {
            phase: "paused",
            label: approval.message || "Awaiting tool approval",
            toolName: approval.tools[0]?.name,
            steps: this.activeRun.processLane?.steps ?? []
          };
          this.activeRun.observer.onEvent({
            type: "process.update",
            process: this.activeRun.processLane
          });
          if (this.activeRun.autoApproveTools) {
            this.activeRun.observer.onEvent({
              type: "log",
              stream: "system",
              text: `Ante auto-approved ${approval.tools.map((tool) => tool.name).join(", ") || "tool call"}`
            });
            this.respondToApproval(approval, "AcceptForSession");
            return;
          }
          this.activeRun.observer.onEvent({
            type: "session.approval",
            approval
          });
          return;
        }
        const detail = extractTurnPauseDetail(variant.payload);
        this.activeRun.observer.onEvent({
          type: "log",
          stream: "system",
          text: detail ? `Ante TurnPause: ${detail}` : "Ante TurnPause"
        });
        return;
      }
      case "TurnEnd": {
        const status = extractTurnStatus(variant.payload)?.toLowerCase();
        const errorMessage = extractErrorMessage(variant.payload);
        const isSuccess = Boolean(status && ["completed", "success", "succeeded", "ok"].includes(status));
        const completedAtMs = performance.now();
        const totalMs = Math.round(completedAtMs - this.activeRun.startedAtMs);
        const sessionBootMs =
          this.activeRun.sessionReadyAtMs != null ? Math.round(this.activeRun.sessionReadyAtMs - this.activeRun.startedAtMs) : null;
        const postSendToFirstEventMs =
          this.activeRun.userInputSentAtMs != null && this.activeRun.firstEventAtMs != null
            ? Math.round(this.activeRun.firstEventAtMs - this.activeRun.userInputSentAtMs)
            : null;
        const postSendToFirstStdoutMs =
          this.activeRun.userInputSentAtMs != null && this.activeRun.firstStdoutAtMs != null
            ? Math.round(this.activeRun.firstStdoutAtMs - this.activeRun.userInputSentAtMs)
            : null;
        logDebug(
          `timing total=${totalMs}ms${sessionBootMs != null ? ` session=${sessionBootMs}ms` : ""}${postSendToFirstEventMs != null ? ` send->event=${postSendToFirstEventMs}ms` : ""}${postSendToFirstStdoutMs != null ? ` send->stdout=${postSendToFirstStdoutMs}ms` : ""}`
        );
        if (!isSuccess) {
          this.activeRun.observer.onEvent({ type: "process.update", process: undefined });
          this.activeRun.observer.onEvent({ type: "session.failed", error: errorMessage });
          this.activeRun.completed = true;
          this.activeRun.observer.onExit({ status: "failed", error: errorMessage });
          this.activeRun = null;
          return;
        }
        if (this.activeRun.finalMessage.trim()) {
          for (const event of parseAssistantMessage(this.activeRun.finalMessage)) {
            this.activeRun.observer.onEvent(event);
          }
        }
        this.activeRun.observer.onEvent({ type: "process.update", process: undefined });
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
    const startedAt = performance.now();
    const fingerprint = this.getContextFingerprint(request);
    const shouldReuseContext =
      request.kind === "terminal" && Boolean(this.sessionId) && this.lastSentContextFingerprint === fingerprint;

    request.reusePriorContext = shouldReuseContext;
    this.activeRun?.observer.onEvent({
      type: "log",
      stream: "system",
      text: shouldReuseContext
        ? `Sending context reference · note=${request.context.filePath ?? "none"}`
        : `Sending Markdown context · note=${request.context.filePath ?? "none"}`
    });

    const prompt = buildInteractivePrompt(request);
    logDebug(
      `prompt stats prompt=${prompt.length} chars doc=${request.context.documentText?.length ?? 0} chars selection=${request.context.selection?.text.length ?? 0} chars`
    );

    const opId = this.sendOperation({
      UserInput: prompt
    });
    if (this.activeRun) {
      this.activeRun.userInputOpId = opId;
      this.activeRun.userInputSentAtMs = performance.now();
      emitDiagnosticLog(this.activeRun.observer, `Sent UserInput · op=${opId} · session=${this.sessionId ?? "none"}`);
    }
    const elapsed = Math.round(performance.now() - startedAt);
    if (elapsed >= 16) {
      logDebug(
        `sendUserInput ${elapsed}ms file=${request.context.filePath ?? "none"} prompt=${prompt.length} chars doc=${request.context.documentText?.length ?? 0}`
      );
    }
    this.lastSentContextFingerprint = fingerprint;
  }

  private sendOperation(
    op:
      | { StartSession: { model: string; provider: string; streaming: boolean } }
      | { ResumeSession: { session_id: string } }
      | { UserInput: string }
      | { ApprovalResponse: { turn_id: string; responses: Array<[string, RuntimeApprovalDecision]> } }
      | "Shutdown"
  ): string {
    const opId = generateOpId();
    this.transport?.send(serializeOperation(op, opId));
    return opId;
  }

  private stopTransport(): void {
    if (this.shutdownState) {
      this.clearShutdownTimer(this.shutdownState);
      this.shutdownState = null;
    }
    if (this.warmup) {
      this.warmup.reject(new Error("Ante warm session was interrupted"));
      this.warmup = null;
    }
    this.rejectSessionTransition(new Error("Ante session transition was interrupted"));
    this.transport?.disconnect();
    this.transport = null;
    this.transportGeneration += 1;
    this.transportSignature = null;
    this.transportStarting = null;
    this.sessionId = null;
    this.sessionStarting = false;
    this.lastSentContextFingerprint = null;
    this.startupDiagnostics.length = 0;
  }

  private beginSession(config: AnteRuntimeConfig): void {
    this.sessionStarting = true;
    this.sendOperation({
      StartSession: {
        model: config.model.trim(),
        provider: config.provider.trim(),
        streaming: true
      }
    });
  }

  private beginResumeSession(targetSessionId: string): void {
    this.sendOperation({
      ResumeSession: {
        session_id: targetSessionId
      }
    });
  }

  private createWarmupState(): WarmupState {
    let resolve = () => {};
    let reject = (_error: Error) => {};
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }

  private async awaitPendingShutdown(): Promise<void> {
    if (!this.shutdownState) {
      return;
    }
    emitDiagnosticLog(undefined, "Waiting for Ante shutdown to finish before starting the next session");
    await this.shutdownState.promise;
  }

  private createShutdownState(): ShutdownState {
    let resolve = () => {};
    let reject = (_error: Error) => {};
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const shutdown: ShutdownState = {
      promise,
      resolve,
      reject,
      timer: null
    };
    shutdown.timer = setTimeout(() => {
      if (this.shutdownState !== shutdown) {
        return;
      }
      this.shutdownState = null;
      reject(new Error("Timed out while waiting for Ante to persist the active session"));
      this.stopTransport();
    }, 5000);
    return shutdown;
  }

  private clearShutdownTimer(shutdown: ShutdownState | null): void {
    if (shutdown?.timer != null) {
      clearTimeout(shutdown.timer);
      shutdown.timer = null;
    }
  }

  private rejectShutdown(error: Error): void {
    const shutdown = this.shutdownState;
    if (!shutdown) {
      return;
    }
    this.clearShutdownTimer(shutdown);
    this.shutdownState = null;
    shutdown.reject(error);
  }

  private createSessionTransition(
    kind: SessionTransitionKind,
    observer: RuntimeObserver,
    targetSessionId?: string
  ): SessionTransitionState {
    let resolve = () => {};
    let reject = (_error: Error) => {};
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return {
      kind,
      observer,
      promise,
      resolve,
      reject,
      targetSessionId,
      hasSeenTargetSession: false,
      settleTimer: null
    };
  }

  private clearSessionTransitionTimer(transition: SessionTransitionState | null): void {
    if (transition?.settleTimer != null) {
      clearTimeout(transition.settleTimer);
      transition.settleTimer = null;
    }
  }

  private rejectSessionTransition(error: Error): void {
    const transition = this.sessionTransition;
    if (!transition) {
      return;
    }
    this.clearSessionTransitionTimer(transition);
    this.sessionTransition = null;
    transition.reject(error);
  }

  private scheduleSessionTransitionSettle(): void {
    const transition = this.sessionTransition;
    if (!transition || !transition.hasSeenTargetSession) {
      return;
    }
    this.clearSessionTransitionTimer(transition);
    if (this.sessionTransition !== transition) {
      return;
    }
    this.sessionTransition = null;
    transition.resolve();
  }

  private handleSessionTransitionSessionStart(sessionId: string): void {
    const transition = this.sessionTransition;
    if (!transition) {
      return;
    }
    if (transition.kind === "resume" && transition.targetSessionId && transition.targetSessionId !== sessionId) {
      return;
    }
    transition.hasSeenTargetSession = true;
    emitDiagnosticLog(transition.observer, `Session transition matched target · kind=${transition.kind} · session=${sessionId}`);
    this.scheduleSessionTransitionSettle();
  }

  private handleSessionTransitionExtensionRefresh(sessionId: string | null): void {
    const transition = this.sessionTransition;
    if (!transition) {
      return;
    }
    if (transition.kind === "resume" && transition.targetSessionId && sessionId && transition.targetSessionId !== sessionId) {
      return;
    }
    emitDiagnosticLog(transition.observer, `Session transition extension refresh · kind=${transition.kind} · session=${sessionId ?? "none"}`);
    this.scheduleSessionTransitionSettle();
  }

  private shouldStartFreshSession(request: TaskRequest): boolean {
    return (request.kind === "chat" || request.kind === "terminal") && request.mode === "initial";
  }

  private async ensureRequestSession(request: TaskRequest, config: AnteRuntimeConfig, observer: RuntimeObserver): Promise<void> {
    const requestedSessionId = request.runtimeSessionId?.trim() ?? "";

    if (requestedSessionId) {
      if (this.sessionId === requestedSessionId) {
        return;
      }
      await this.resumeSession(requestedSessionId, observer);
      return;
    }

    if (this.shouldStartFreshSession(request) || !this.sessionId) {
      await this.startFreshSession(config, observer);
    }
  }

  private async startFreshSession(config: AnteRuntimeConfig, observer: RuntimeObserver): Promise<void> {
    if (this.sessionTransition) {
      await this.sessionTransition.promise;
    }
    const transition = this.createSessionTransition("start", observer);
    this.sessionTransition = transition;
    emitDiagnosticLog(observer, "Starting fresh Ante session");
    this.beginSession(config);
    await transition.promise;
  }

  private async resumeSession(targetSessionId: string, observer: RuntimeObserver): Promise<void> {
    if (this.sessionTransition) {
      await this.sessionTransition.promise;
    }
    const transition = this.createSessionTransition("resume", observer, targetSessionId);
    this.sessionTransition = transition;
    emitDiagnosticLog(observer, `Resuming Ante session · target=${targetSessionId}`);
    this.beginResumeSession(targetSessionId);
    await transition.promise;
  }

  private shouldIgnoreEventForActiveRun(parentOpId: string | undefined): boolean {
    if (!this.activeRun?.userInputOpId) {
      return false;
    }
    return parentOpId != null && parentOpId !== this.activeRun.userInputOpId;
  }

  private getContextFingerprint(request: TaskRequest): string {
    return JSON.stringify({
      filePath: request.context.filePath,
      noteTitle: request.context.noteTitle,
      documentText: request.context.documentText,
      selection: request.context.selection
    });
  }
}
