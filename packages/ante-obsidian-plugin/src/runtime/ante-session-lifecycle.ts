import type { TaskRequest } from "../core/types";
import type { RuntimeObserver } from "./ante-runtime";
import type { AnteRuntimeConfig } from "./ante-runtime-config";
import { configSignature, sessionTargetSignature } from "./ante-runtime-config";
import type { AnteTransport } from "./transport/ante-transport";

type WarmupState = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
};

type SessionTransitionKind = "start" | "resume" | "update";

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

export interface AnteTransportHooks {
  onMessage: (message: string) => void;
  onDiagnostic: (event: { stream: "stdout" | "stderr"; text: string }) => void;
  onError: (error: Error) => void;
  onClose: (info?: { code?: number; reason?: string }) => void;
}

export class AnteSessionLifecycle {
  private transport: AnteTransport | null = null;
  private transportGeneration = 0;
  private transportSignature: string | null = null;
  private transportStarting: { signature: string; promise: Promise<void> } | null = null;
  private sessionId: string | null = null;
  private currentSessionTargetSignature: string | null = null;
  private sessionStarting = false;
  private sessionTransition: SessionTransitionState | null = null;
  private shutdownState: ShutdownState | null = null;
  private warmup: WarmupState | null = null;
  private readonly startupDiagnostics: Array<{ stream: "stdout" | "stderr"; text: string }> = [];

  constructor(private readonly createTransport: (config: AnteRuntimeConfig) => AnteTransport) {}

  getActiveSessionId(): string | null {
    return this.sessionId;
  }

  getSessionTargetSignature(): string | null {
    return this.currentSessionTargetSignature;
  }

  setSessionTargetSignature(signature: string | null): void {
    this.currentSessionTargetSignature = signature;
  }

  isTransportConnected(): boolean {
    return Boolean(this.transport?.isConnected());
  }

  hasReadySession(signature: string): boolean {
    return this.transportSignature === signature && Boolean(this.sessionId) && Boolean(this.transport?.isConnected());
  }

  hasCompatibleTransport(signature: string): boolean {
    return this.transportSignature === signature;
  }

  async ensureWarmSession(
    config: AnteRuntimeConfig,
    hooks: AnteTransportHooks,
    beginSession: (config: AnteRuntimeConfig) => void
  ): Promise<void> {
    if (!config.command.trim() || !config.provider.trim()) {
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
      await this.ensureTransportStarted(config, hooks);
    }

    if (!this.warmup) {
      this.warmup = this.createWarmupState();
    }
    if (!this.sessionStarting) {
      this.sessionStarting = true;
      beginSession(config);
    }
    return this.warmup.promise;
  }

  async ensureTransportStarted(config: AnteRuntimeConfig, hooks: AnteTransportHooks): Promise<void> {
    if (this.transport) {
      return;
    }
    const signature = configSignature(config);
    if (!this.transportStarting || this.transportStarting.signature !== signature) {
      const promise = this.startTransport(config, hooks).finally(() => {
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

  async prepareSessionForRequest(
    request: TaskRequest,
    config: AnteRuntimeConfig,
    observer: RuntimeObserver,
    hooks: AnteTransportHooks,
    beginSession: (config: AnteRuntimeConfig) => void,
    beginResumeSession: (targetSessionId: string) => void
  ): Promise<"launch" | "reuse" | "boot"> {
    await this.awaitPendingShutdown();

    const signature = configSignature(config);
    const hasCompatibleTransport = this.hasCompatibleTransport(signature);
    const hasReadySession = this.hasReadySession(signature);

    if (!hasCompatibleTransport) {
      this.stopTransport();
      await this.ensureTransportStarted(config, hooks);
      this.sessionId = null;
    }

    const transitionAction = await this.ensureRequestSession(request, config, observer, beginSession, beginResumeSession);

    if (!hasCompatibleTransport) {
      return "launch";
    }
    if (transitionAction === "none" && hasReadySession) {
      return "reuse";
    }
    return "boot";
  }

  async persistActiveSession(sendShutdown: () => void): Promise<void> {
    if (!this.transport || !this.transport.isConnected() || !this.sessionId) {
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
    sendShutdown();
    await shutdown.promise;
  }

  send(message: string): void {
    this.transport?.send(message);
  }

  stopTransport(): void {
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
    this.currentSessionTargetSignature = null;
    this.sessionStarting = false;
    this.startupDiagnostics.length = 0;
  }

  pushStartupDiagnostic(event: { stream: "stdout" | "stderr"; text: string }): void {
    this.startupDiagnostics.push(event);
    if (this.startupDiagnostics.length > 50) {
      this.startupDiagnostics.shift();
    }
  }

  flushStartupDiagnostics(emit: (event: { stream: "stdout" | "stderr"; text: string }) => void): void {
    for (const entry of this.startupDiagnostics) {
      emit(entry);
    }
    this.startupDiagnostics.length = 0;
  }

  withStartupDiagnostics(error: Error): Error {
    if (this.startupDiagnostics.length === 0) {
      return error;
    }
    const tail = this.startupDiagnostics
      .slice(-5)
      .map((entry) => `[${entry.stream}] ${entry.text}`)
      .join(" | ");
    return new Error(`${error.message} | startup: ${tail}`);
  }

  resolveWarmup(sessionId: string): void {
    this.sessionId = sessionId;
    this.sessionStarting = false;
    this.warmup?.resolve();
    this.warmup = null;
  }

  rejectWarmup(error: Error): void {
    this.warmup?.reject(error);
    this.warmup = null;
  }

  handleSessionStart(sessionId: string, emitDiagnostic: (observer: RuntimeObserver, text: string) => void): void {
    const transition = this.sessionTransition;
    if (!transition) {
      return;
    }
    if (transition.kind === "resume" && transition.targetSessionId && transition.targetSessionId !== sessionId) {
      return;
    }
    transition.hasSeenTargetSession = true;
    emitDiagnostic(transition.observer, `Session transition matched target · kind=${transition.kind} · session=${sessionId}`);
    this.scheduleSessionTransitionSettle();
  }

  handleExtensionRefresh(sessionId: string | null, emitDiagnostic: (observer: RuntimeObserver, text: string) => void): void {
    const transition = this.sessionTransition;
    if (!transition) {
      return;
    }
    if (transition.kind === "resume" && transition.targetSessionId && sessionId && transition.targetSessionId !== sessionId) {
      return;
    }
    emitDiagnostic(transition.observer, `Session transition extension refresh · kind=${transition.kind} · session=${sessionId ?? "none"}`);
    this.scheduleSessionTransitionSettle();
  }

  handleSessionUpdated(emitDiagnostic: (observer: RuntimeObserver, text: string) => void): void {
    const transition = this.sessionTransition;
    if (!transition || transition.kind !== "update") {
      return;
    }
    transition.hasSeenTargetSession = true;
    emitDiagnostic(transition.observer, "Session transition updated active target");
    this.scheduleSessionTransitionSettle();
  }

  handleSessionEnd(): boolean {
    this.sessionId = null;
    this.currentSessionTargetSignature = null;
    const shutdown = this.shutdownState;
    if (!shutdown) {
      return false;
    }
    this.clearShutdownTimer(shutdown);
    this.shutdownState = null;
    shutdown.resolve();
    this.stopTransport();
    return true;
  }

  rejectShutdown(error: Error): void {
    const shutdown = this.shutdownState;
    if (!shutdown) {
      return;
    }
    this.clearShutdownTimer(shutdown);
    this.shutdownState = null;
    shutdown.reject(error);
  }

  rejectSessionTransition(error: Error): void {
    const transition = this.sessionTransition;
    if (!transition) {
      return;
    }
    this.clearSessionTransitionTimer(transition);
    this.sessionTransition = null;
    transition.reject(error);
  }

  async awaitPendingShutdown(): Promise<void> {
    if (!this.shutdownState) {
      return;
    }
    await this.shutdownState.promise;
  }

  private async startTransport(config: AnteRuntimeConfig, hooks: AnteTransportHooks): Promise<void> {
    const transport = this.createTransport(config);
    const generation = this.transportGeneration + 1;
    this.transportGeneration = generation;
    const isStaleTransport = (): boolean => generation !== this.transportGeneration || this.transport !== transport;

    transport.setMessageHandler((message) => {
      if (!isStaleTransport()) {
        hooks.onMessage(message);
      }
    });
    transport.setDiagnosticHandler((event) => {
      if (!isStaleTransport()) {
        hooks.onDiagnostic(event);
      }
    });
    transport.setErrorHandler((error) => {
      if (!isStaleTransport()) {
        hooks.onError(error);
      }
    });
    transport.setCloseHandler((info) => {
      if (!isStaleTransport()) {
        hooks.onClose(info);
      }
    });
    await transport.connect();
    this.transport = transport;
    this.transportSignature = configSignature(config);
  }

  private shouldStartFreshSession(request: TaskRequest): boolean {
    return (request.kind === "chat" || request.kind === "terminal") && request.mode === "initial";
  }

  private async ensureRequestSession(
    request: TaskRequest,
    config: AnteRuntimeConfig,
    observer: RuntimeObserver,
    beginSession: (config: AnteRuntimeConfig) => void,
    beginResumeSession: (targetSessionId: string) => void
  ): Promise<"none" | "start" | "resume"> {
    const requestedSessionId = request.runtimeSessionId?.trim() ?? "";

    if (requestedSessionId) {
      if (this.sessionId === requestedSessionId) {
        return "none";
      }
      await this.resumeSession(requestedSessionId, observer, beginResumeSession);
      return "resume";
    }

    if (this.shouldStartFreshSession(request) || !this.sessionId) {
      await this.startFreshSession(config, observer, beginSession);
      return "start";
    }

    return "none";
  }

  private async startFreshSession(
    config: AnteRuntimeConfig,
    observer: RuntimeObserver,
    beginSession: (config: AnteRuntimeConfig) => void
  ): Promise<void> {
    if (this.sessionTransition) {
      await this.sessionTransition.promise;
    }
    const transition = this.createSessionTransition("start", observer);
    this.sessionTransition = transition;
    this.currentSessionTargetSignature = sessionTargetSignature(config);
    beginSession(config);
    await transition.promise;
  }

  private async resumeSession(
    targetSessionId: string,
    observer: RuntimeObserver,
    beginResumeSession: (targetSessionId: string) => void
  ): Promise<void> {
    if (this.sessionTransition) {
      await this.sessionTransition.promise;
    }
    const transition = this.createSessionTransition("resume", observer, targetSessionId);
    this.sessionTransition = transition;
    this.currentSessionTargetSignature = null;
    beginResumeSession(targetSessionId);
    await transition.promise;
  }

  async updateSession(
    config: AnteRuntimeConfig,
    observer: RuntimeObserver,
    beginUpdateSession: (config: AnteRuntimeConfig) => void
  ): Promise<void> {
    if (this.sessionTransition) {
      await this.sessionTransition.promise;
    }
    const transition = this.createSessionTransition("update", observer);
    this.sessionTransition = transition;
    beginUpdateSession(config);
    await transition.promise;
    this.currentSessionTargetSignature = sessionTargetSignature(config);
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

  private clearShutdownTimer(shutdown: ShutdownState | null): void {
    if (shutdown?.timer != null) {
      clearTimeout(shutdown.timer);
      shutdown.timer = null;
    }
  }

  private clearSessionTransitionTimer(transition: SessionTransitionState | null): void {
    if (transition?.settleTimer != null) {
      clearTimeout(transition.settleTimer);
      transition.settleTimer = null;
    }
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
}
