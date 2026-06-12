import { buildInteractivePrompt } from "../core/runtime-prompt";
import {
  ANTE_DEFAULT_THINKING,
  resolveAnteThinkingPreference,
  type AnteThinkingPreference,
} from "../core/ante-thinking";
import type {
  RuntimeApprovalDecision,
  RuntimeApprovalRequest,
  RuntimeSessionInfo,
  TaskRequest,
} from "../core/types";
import {
  extractErrorMessage,
  extractSessionId,
  extractSessionModelSpec,
  extractSessionProviderSpec,
  getVariant,
} from "./ante-event-parser";
import { buildApprovalResponseOperation } from "./ante-approval";
import { cancelTimeout, scheduleTimeout, type TimerHandle } from "../core/timers";
import { reduceRunVariant, type ActiveRun } from "./ante-run-event-reducer";
import type { AnteRuntime, RuntimeObserver } from "./ante-runtime";
import type { AnteRuntimeConfig } from "./ante-runtime-config";
import { sessionTargetSignature } from "./ante-runtime-config";
import { AnteSessionLifecycle, type AnteTransportHooks } from "./ante-session-lifecycle";
import { generateOpId, parseEnvelope, serializeOperation } from "./ante-protocol";
import type { AnteTransport } from "./transport/ante-transport";
import { logDebug } from "../core/debug-log";

const INTERRUPT_FALLBACK_MS = 750;

const emitDiagnosticLog = (observer: RuntimeObserver | null | undefined, text: string): void => {
  observer?.onEvent({
    type: "log",
    stream: "system",
    text,
  });
};

const normalizeProtocolErrorMessage = (message: string): string => {
  const normalized = message.trim();
  if (/Failed to resume session: .*No such file or directory/i.test(normalized)) {
    return "Ante could not restore this chat because its saved session files are missing. Start a new chat to continue.";
  }
  return normalized;
};

type InterruptState = {
  timer: TimerHandle | null;
};

export type { AnteRuntimeConfig } from "./ante-runtime-config";
export { configSignature } from "./ante-runtime-config";

export class AnteSessionDriver implements AnteRuntime {
  private readonly lifecycle: AnteSessionLifecycle;
  private activeRun: ActiveRun | null = null;
  private interruptState: InterruptState | null = null;
  private lastSentContextFingerprint: string | null = null;
  private pendingSessionTargetSignature: string | null = null;
  private activeSessionDetails: {
    activeProvider?: string;
    activeModel?: string;
    availableModels?: string[];
  } = {};

  constructor(
    private readonly getConfig: () => AnteRuntimeConfig,
    createTransport: (config: AnteRuntimeConfig) => AnteTransport,
  ) {
    this.lifecycle = new AnteSessionLifecycle(createTransport);
  }

  async ensureWarmSession(target?: {
    provider: string;
    model: string;
    thinking: AnteThinkingPreference;
  }): Promise<void> {
    const config = target ? this.resolveTargetConfig(target) : this.getConfig();
    await this.lifecycle.ensureWarmSession(config, this.createTransportHooks(), (warmConfig) => {
      this.beginSession(warmConfig);
    });
  }

  getActiveSessionInfo(): RuntimeSessionInfo | null {
    const sessionId = this.lifecycle.getActiveSessionId();
    if (!sessionId) {
      return null;
    }
    return {
      provider: "ante",
      sessionId,
      ...this.activeSessionDetails,
    };
  }

  run(request: TaskRequest, observer: RuntimeObserver): void {
    void this.runInternal(request, observer);
  }

  cancelActiveRun(): void {
    if (!this.activeRun) {
      this.clearInterruptTimer();
      return;
    }
    if (!this.lifecycle.isTransportConnected() || this.interruptState) {
      this.finishCancelledRun(true);
      return;
    }

    this.interruptState = {
      timer: scheduleTimeout(() => {
        if (!this.interruptState) {
          return;
        }
        this.finishCancelledRun(true);
      }, INTERRUPT_FALLBACK_MS),
    };
    this.activeRun.observer.onEvent({
      type: "log",
      stream: "system",
      text: "Interrupting Ante turn",
    });
    this.sendOperation("Interrupt");
  }

  dispose(): void {
    this.cancelActiveRun();
    this.lifecycle.stopTransport();
  }

  async persistActiveSession(): Promise<void> {
    if (!this.lifecycle.getActiveSessionId() || this.activeRun) {
      return;
    }
    emitDiagnosticLog(
      undefined,
      `Persisting Ante session via Shutdown · session=${this.lifecycle.getActiveSessionId()}`,
    );
    await this.lifecycle.persistActiveSession(() => {
      this.lifecycle.send(serializeOperation("Shutdown", generateOpId()));
    });
  }

  getActiveSessionId(): string | null {
    return this.lifecycle.getActiveSessionId();
  }

  respondToApproval(approval: RuntimeApprovalRequest, decision: RuntimeApprovalDecision): void {
    if (!this.lifecycle.isTransportConnected() || !this.activeRun) {
      throw new Error("Ante is not waiting for approval");
    }
    const operation = buildApprovalResponseOperation(approval, decision);
    if (operation.ApprovalResponse.responses.length === 0) {
      throw new Error("Ante approval request did not include any tools");
    }
    this.sendOperation(operation);
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
      logDebug(`transport recv envelope without variant parent=${envelope.parent ?? "none"}`);
      return;
    }

    if (
      [
        "TurnPause",
        "ToolStart",
        "ToolEnd",
        "TurnEnd",
        "SessionStart",
        "SessionUpdated",
        "ExtensionRefreshed",
      ].includes(variant.name)
    ) {
      logDebug(`transport variant type=${variant.name} parent=${envelope.parent ?? "none"}`);
    }

    if (this.handleLifecycleVariant(variant.name, variant.payload, envelope.parent)) {
      return;
    }

    if (!this.activeRun) {
      return;
    }

    if (this.shouldIgnoreEventForActiveRun(envelope.parent)) {
      emitDiagnosticLog(
        this.activeRun.observer,
        `Ignoring replay event · type=${variant.name} · parent=${envelope.parent ?? "none"} · expected=${this.activeRun.userInputOpId ?? "none"}`,
      );
      return;
    }

    const outcome = reduceRunVariant({
      activeRun: this.activeRun,
      variantName: variant.name,
      payload: variant.payload,
      interruptPending: Boolean(this.interruptState),
      nowMs: () => performance.now(),
      logDebug: (message) => logDebug(message),
      respondToApproval: (approval, decision) => this.respondToApproval(approval, decision),
    });

    if (!outcome || !this.activeRun) {
      return;
    }

    if (outcome.status === "cancelled") {
      this.finishCancelledRun(false);
      return;
    }

    if (outcome.status === "failed") {
      this.activeRun.completed = true;
      this.activeRun.observer.onExit({ status: "failed", error: outcome.error });
      this.clearInterruptTimer();
      this.activeRun = null;
      return;
    }

    this.activeRun.completed = true;
    this.activeRun.observer.onExit({ status: "completed" });
    this.clearInterruptTimer();
    this.activeRun = null;
  }

  private async runInternal(request: TaskRequest, observer: RuntimeObserver): Promise<void> {
    const config = this.resolveConfigForRequest(request);
    observer.onEvent({
      type: "log",
      stream: "system",
      text: `Executing turn · provider=${config.provider} · model=${config.model} · thinking=${config.thinking ?? "default"}`,
    });
    if (!config.command.trim()) {
      observer.onExit({ status: "failed", error: "Ante command is required" });
      return;
    }
    if (!config.provider.trim()) {
      observer.onExit({ status: "failed", error: "Ante provider is required" });
      return;
    }
    if (this.activeRun) {
      observer.onExit({ status: "failed", error: "Another Ante task is already running" });
      return;
    }

    const hooks = this.createTransportHooks();
    try {
      const prepMode = await this.lifecycle.prepareSessionForRequest(
        request,
        config,
        observer,
        hooks,
        (freshConfig) => this.beginSession(freshConfig),
        (targetSessionId) => this.beginResumeSession(targetSessionId),
      );
      if (prepMode === "launch") {
        observer.onEvent({
          type: "log",
          stream: "system",
          text: `Launching Ante server · provider=${config.provider.trim()} · model=${config.model.trim()} · thinking=${config.thinking ?? "default"} · cwd=${config.cwd.trim() || process.cwd()}`,
        });
      } else if (prepMode === "reuse") {
        observer.onEvent({
          type: "log",
          stream: "system",
          text: `Reusing existing Ante session · provider=${config.provider.trim()} · model=${config.model.trim()} · thinking=${config.thinking ?? "default"}`,
        });
      } else {
        observer.onEvent({
          type: "log",
          stream: "system",
          text: `Booting Ante session · provider=${config.provider.trim()} · model=${config.model.trim()} · thinking=${config.thinking ?? "default"}`,
        });
      }

      emitDiagnosticLog(
        observer,
        `Session prep start · requested=${request.runtimeSessionId?.trim() || "new"} · current=${this.lifecycle.getActiveSessionId() ?? "none"} · mode=${request.mode ?? "initial"}`,
      );
      emitDiagnosticLog(
        observer,
        `Session prep ready · active=${this.lifecycle.getActiveSessionId() ?? "none"}`,
      );
      await this.ensureSessionTarget(request, config, observer);
    } catch (error) {
      const startupError =
        error instanceof Error
          ? this.lifecycle.withStartupDiagnostics(error)
          : this.lifecycle.withStartupDiagnostics(new Error(String(error)));
      observer.onExit({ status: "failed", error: startupError.message });
      return;
    }

    this.activeRun = {
      observer,
      request,
      autoApproveTools: config.autoApproveTools,
      finalMessage: "",
      emittedStdout: false,
      completed: false,
      startedAtMs: performance.now(),
    };

    const activeSessionId = this.lifecycle.getActiveSessionId();
    if (activeSessionId) {
      observer.onEvent({
        type: "runtime.session",
        provider: "ante",
        sessionId: activeSessionId,
        ...this.activeSessionDetails,
      });
    }
    this.sendUserInput(request);
  }

  private createTransportHooks(): AnteTransportHooks {
    return {
      onMessage: (message) => this.handleTransportMessage(message),
      onDiagnostic: (event) => {
        this.lifecycle.pushStartupDiagnostic(event);
        this.activeRun?.observer.onEvent({ type: "log", stream: event.stream, text: event.text });
      },
      onError: (error) => {
        console.error("[tmd transport] error", error);
        const errorWithDiagnostics = this.lifecycle.withStartupDiagnostics(error);
        this.clearInterruptTimer();
        this.lifecycle.rejectShutdown(errorWithDiagnostics);
        this.lifecycle.rejectWarmup(error);
        this.lifecycle.rejectSessionTransition(errorWithDiagnostics);
        if (this.activeRun) {
          this.lifecycle.flushStartupDiagnostics((entry) => {
            this.activeRun?.observer.onEvent({
              type: "log",
              stream: entry.stream,
              text: entry.text,
            });
          });
          this.activeRun.observer.onExit({ status: "failed", error: errorWithDiagnostics.message });
          this.activeRun = null;
        }
        this.lifecycle.stopTransport();
      },
      onClose: (info) => {
        this.clearInterruptTimer();
        const closeError = new Error(
          info?.reason === "SIGTERM"
            ? "Ante server exited after SIGTERM"
            : `Ante server exited with code ${info?.code ?? "unknown"}`,
        );
        const errorWithDiagnostics = this.lifecycle.withStartupDiagnostics(closeError);
        const activeRun = this.activeRun;
        const shutdownResolved = this.lifecycle.handleSessionEnd();
        if (shutdownResolved) {
          return;
        }
        this.lifecycle.rejectSessionTransition(errorWithDiagnostics);
        if (!activeRun || activeRun.completed) {
          this.lifecycle.rejectWarmup(errorWithDiagnostics);
          this.activeRun = null;
          this.lifecycle.stopTransport();
          return;
        }
        this.lifecycle.flushStartupDiagnostics((entry) => {
          activeRun.observer.onEvent({ type: "log", stream: entry.stream, text: entry.text });
        });
        activeRun.observer.onExit({
          status: info?.reason === "SIGTERM" ? "cancelled" : "failed",
          error: info?.reason === "SIGTERM" ? undefined : errorWithDiagnostics.message,
        });
        this.activeRun = null;
        this.lifecycle.stopTransport();
      },
    };
  }

  private handleLifecycleVariant(
    variantName: string,
    payload: unknown,
    parentOpId: string | undefined,
  ): boolean {
    switch (variantName) {
      case "SessionStart": {
        const sessionId = extractSessionId(payload) ?? crypto.randomUUID();
        const modelSpec = extractSessionModelSpec(payload);
        const providerSpec = extractSessionProviderSpec(payload);
        this.activeSessionDetails = {
          activeProvider: providerSpec?.name,
          activeModel: modelSpec?.name,
          availableModels: providerSpec?.preferredModels.map((model) => model.name),
        };
        this.lifecycle.resolveWarmup(sessionId);
        this.lifecycle.handleSessionStart(sessionId, emitDiagnosticLog);
        emitDiagnosticLog(
          this.activeRun?.observer ?? null,
          `Protocol SessionStart · session=${sessionId} · parent=${parentOpId ?? "none"}`,
        );
        if (!this.activeRun) {
          return true;
        }
        this.activeRun.sessionReadyAtMs = performance.now();
        this.activeRun.observer.onEvent({
          type: "runtime.session",
          provider: "ante",
          sessionId,
          ...this.activeSessionDetails,
        });
        return true;
      }
      case "Error": {
        const rawMessage = extractErrorMessage(payload);
        const message = normalizeProtocolErrorMessage(rawMessage);
        let payloadText = "";
        try {
          payloadText = JSON.stringify(payload);
        } catch {
          payloadText = String(payload);
        }
        emitDiagnosticLog(
          this.activeRun?.observer ?? null,
          `Protocol Error · message=${rawMessage} · parent=${parentOpId ?? "none"} · payload=${payloadText}`,
        );
        this.lifecycle.rejectShutdown(new Error(message));
        this.lifecycle.rejectSessionTransition(new Error(message));
        if (!this.activeRun) {
          return true;
        }
        this.activeRun.observer.onEvent({ type: "process.update", process: undefined });
        this.activeRun.observer.onEvent({ type: "session.failed", error: message });
        this.activeRun.completed = true;
        this.activeRun.observer.onExit({ status: "failed", error: message });
        this.activeRun = null;
        return true;
      }
      case "SessionEnd":
        emitDiagnosticLog(
          this.activeRun?.observer ?? null,
          `Protocol SessionEnd · parent=${parentOpId ?? "none"}`,
        );
        if (!this.activeRun) {
          this.lifecycle.handleSessionEnd();
          return true;
        }
        return true;
      case "ExtensionRefreshed":
        this.lifecycle.handleExtensionRefresh(extractSessionId(payload), emitDiagnosticLog);
        emitDiagnosticLog(
          this.activeRun?.observer ?? null,
          `Protocol ExtensionRefreshed · session=${extractSessionId(payload) ?? "none"} · parent=${parentOpId ?? "none"}`,
        );
        return true;
      case "SessionUpdated":
        {
          const modelSpec = extractSessionModelSpec(payload);
          const providerSpec = extractSessionProviderSpec(payload);
          this.activeSessionDetails = {
            activeProvider: providerSpec?.name ?? this.activeSessionDetails.activeProvider,
            activeModel: modelSpec?.name ?? this.activeSessionDetails.activeModel,
            availableModels:
              providerSpec && providerSpec.preferredModels.length > 0
                ? providerSpec.preferredModels.map((model) => model.name)
                : this.activeSessionDetails.availableModels,
          };
        }
        this.lifecycle.handleSessionUpdated(emitDiagnosticLog);
        if (this.pendingSessionTargetSignature) {
          this.lifecycle.setSessionTargetSignature(this.pendingSessionTargetSignature);
          this.pendingSessionTargetSignature = null;
        }
        if (this.activeRun) {
          this.activeRun.observer.onEvent({
            type: "session.info",
            level: "info",
            message: "Ante session updated",
          });
        }
        return true;
      default:
        return false;
    }
  }

  private sendUserInput(request: TaskRequest): void {
    const startedAt = performance.now();
    const fingerprint = this.getContextFingerprint(request);
    const shouldReuseContext =
      request.kind === "terminal" &&
      Boolean(this.lifecycle.getActiveSessionId()) &&
      this.lastSentContextFingerprint === fingerprint;

    request.reusePriorContext = shouldReuseContext;
    this.activeRun?.observer.onEvent({
      type: "log",
      stream: "system",
      text: shouldReuseContext
        ? `Sending context reference · note=${request.context.filePath ?? "none"}`
        : `Sending Markdown context · note=${request.context.filePath ?? "none"}`,
    });

    const prompt = buildInteractivePrompt(request);
    logDebug(
      `prompt stats prompt=${prompt.length} chars doc=${request.context.documentText?.length ?? 0} chars selection=${request.context.selection?.text.length ?? 0} chars`,
    );

    const opId = this.sendOperation({
      UserInput: prompt,
    });
    if (this.activeRun) {
      this.activeRun.userInputOpId = opId;
      this.activeRun.userInputSentAtMs = performance.now();
      emitDiagnosticLog(
        this.activeRun.observer,
        `Sent UserInput · op=${opId} · session=${this.lifecycle.getActiveSessionId() ?? "none"}`,
      );
    }
    const elapsed = Math.round(performance.now() - startedAt);
    if (elapsed >= 16) {
      logDebug(
        `sendUserInput ${elapsed}ms file=${request.context.filePath ?? "none"} prompt=${prompt.length} chars doc=${request.context.documentText?.length ?? 0}`,
      );
    }
    this.lastSentContextFingerprint = fingerprint;
  }

  private sendOperation(
    op:
      | {
          StartSession: {
            model: string;
            provider: string;
            streaming: boolean;
            thinking: AnteRuntimeConfig["thinking"];
          };
        }
      | { ResumeSession: { session_id: string } }
      | { UpdateSession: { model: { name: string }; provider: string } }
      | { UserInput: string }
      | {
          ApprovalResponse: {
            turn_id: string;
            responses: Array<[string, RuntimeApprovalDecision]>;
          };
        }
      | "Interrupt"
      | "Shutdown",
  ): string {
    const opId = generateOpId();
    this.lifecycle.send(serializeOperation(op, opId));
    return opId;
  }

  private beginSession(config: AnteRuntimeConfig): void {
    this.lifecycle.setSessionTargetSignature(sessionTargetSignature(config));
    this.sendOperation({
      StartSession: {
        model: config.model.trim(),
        provider: config.provider.trim(),
        streaming: true,
        thinking: config.thinking,
      },
    });
  }

  private beginResumeSession(targetSessionId: string): void {
    this.sendOperation({
      ResumeSession: {
        session_id: targetSessionId,
      },
    });
  }

  private beginUpdateSession(config: AnteRuntimeConfig): void {
    this.pendingSessionTargetSignature = sessionTargetSignature(config);
    this.sendOperation({
      UpdateSession: {
        model: {
          name: config.model.trim(),
        },
        provider: config.provider.trim(),
      },
    });
  }

  private clearInterruptTimer(): void {
    if (this.interruptState?.timer != null) {
      cancelTimeout(this.interruptState.timer);
      this.interruptState.timer = null;
    }
    this.interruptState = null;
  }

  private finishCancelledRun(disconnectTransport: boolean): void {
    const activeRun = this.activeRun;
    if (!activeRun) {
      this.clearInterruptTimer();
      if (disconnectTransport) {
        this.lifecycle.stopTransport();
      }
      return;
    }

    this.clearInterruptTimer();
    activeRun.observer.onEvent({ type: "process.update", process: undefined });
    activeRun.completed = true;
    if (disconnectTransport) {
      this.activeRun = null;
      this.lifecycle.stopTransport();
      activeRun.observer.onExit({ status: "cancelled" });
      return;
    }
    activeRun.observer.onExit({ status: "cancelled" });
    this.activeRun = null;
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
      selection: request.context.selection,
    });
  }

  private resolveConfigForRequest(request: TaskRequest): AnteRuntimeConfig {
    const config = this.getConfig();
    if (!request.runtimeTarget) {
      return config;
    }
    return this.resolveTargetConfig(request.runtimeTarget);
  }

  private resolveTargetConfig(target: {
    provider: string;
    model: string;
    thinking: AnteThinkingPreference;
  }): AnteRuntimeConfig {
    const config = this.getConfig();
    return {
      ...config,
      provider: target.provider.trim(),
      model: target.model.trim(),
      thinking:
        target.thinking === ANTE_DEFAULT_THINKING
          ? config.thinking
          : resolveAnteThinkingPreference(target.thinking),
    };
  }

  private async ensureSessionTarget(
    request: TaskRequest,
    config: AnteRuntimeConfig,
    observer: RuntimeObserver,
  ): Promise<void> {
    if (!request.runtimeTarget) {
      return;
    }
    if (!this.lifecycle.getActiveSessionId()) {
      return;
    }
    const nextTargetSignature = sessionTargetSignature(config);
    if (this.lifecycle.getSessionTargetSignature() === nextTargetSignature) {
      return;
    }
    observer.onEvent({
      type: "log",
      stream: "system",
      text: `Updating Ante session · provider=${config.provider.trim()} · model=${config.model.trim()} · thinking=${config.thinking ?? "default"}`,
    });
    await this.lifecycle.updateSession(config, observer, (nextConfig) => {
      this.beginUpdateSession(nextConfig);
    });
  }
}
