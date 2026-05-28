import test from "node:test";
import assert from "node:assert/strict";
import { AnteSessionDriver, configSignature, type AnteRuntimeConfig } from "../src/runtime/ante-session-driver";
import type { RuntimeObserver } from "../src/runtime/ante-runtime";
import type { TaskRequest } from "../src/core/types";
import type { AnteTransport } from "../src/runtime/transport/ante-transport";
import { buildInteractivePrompt } from "../src/core/runtime-prompt";

const request: TaskRequest = {
  taskId: "task-1",
  kind: "document",
  triggerSource: "mention",
  preset: {
    id: "default",
    label: "Default",
    goal: "Edit the current note",
    systemInstructions: ""
  },
  context: {
    vaultPath: "/vaults/test",
    filePath: "Note.md",
    noteTitle: "Note",
    documentText: "hello",
    selection: null
  },
  inlineInstruction: "test"
};

class FakeTransport implements AnteTransport {
  connected = false;
  readonly sentMessages: string[] = [];
  messageHandler: (message: string) => void = () => {};
  errorHandler: (error: Error) => void = () => {};
  closeHandler: (info?: { code?: number; reason?: string }) => void = () => {};
  diagnosticHandler: (event: { stream: "stderr"; text: string }) => void = () => {};

  async connect(): Promise<void> {
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  send(message: string): void {
    this.sentMessages.push(message);
  }

  isConnected(): boolean {
    return this.connected;
  }

  setMessageHandler(handler: (message: string) => void): void {
    this.messageHandler = handler;
  }

  setErrorHandler(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  setCloseHandler(handler: (info?: { code?: number; reason?: string }) => void): void {
    this.closeHandler = handler;
  }

  setDiagnosticHandler(handler: (event: { stream: "stderr"; text: string }) => void): void {
    this.diagnosticHandler = handler;
  }
}

class TestSessionDriver extends AnteSessionDriver {
  emit(raw: string): void {
    this.handleTransportMessage(raw);
  }

  primeRun(observer: RuntimeObserver): void {
    (this as unknown as {
      activeRun: {
        observer: RuntimeObserver;
        request: TaskRequest;
        autoApproveTools: boolean;
        finalMessage: string;
        emittedStdout: boolean;
        completed: boolean;
      };
    }).activeRun = {
      observer,
      request,
      autoApproveTools: true,
      finalMessage: "",
      emittedStdout: false,
      completed: false
    };
  }

  primeSession(transport: FakeTransport, sessionId: string): void {
    (this as unknown as {
      lifecycle: {
        transport: FakeTransport;
        transportSignature: string;
        sessionId: string;
      };
    }).lifecycle.transport = transport;
    (this as unknown as {
      lifecycle: {
        transport: FakeTransport;
        transportSignature: string;
        sessionId: string;
      };
    }).lifecycle.transportSignature = configSignature(config);
    (this as unknown as {
      lifecycle: {
        transport: FakeTransport;
        transportSignature: string;
        sessionId: string;
      };
    }).lifecycle.sessionId = sessionId;
    transport.connected = true;
  }
}

const config: AnteRuntimeConfig = {
  connectionMode: "stdio",
  command: "ante",
  argsJson: JSON.stringify(["serve", "--stdio"]),
  cwd: "",
  wsAddress: "",
  model: "gpt-5.4",
  provider: "openai-subscription",
  thinking: null,
  autoApproveTools: true,
  env: {}
};

test("run reports invalid startup errors as a failed exit instead of throwing", async () => {
  const driver = new TestSessionDriver(
    () => config,
    () => {
      throw new Error("bad startup json");
    }
  );

  const exits: Array<{ status: "completed" | "failed" | "cancelled"; error?: string }> = [];
  const observer: RuntimeObserver = {
    onEvent: () => {},
    onExit: (result) => {
      exits.push(result);
    }
  };

  assert.doesNotThrow(() => {
    driver.run(request, observer);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(exits.length, 1);
  assert.equal(exits[0]?.status, "failed");
  assert.match(exits[0]?.error ?? "", /bad startup json/i);
});

test("non-approval TurnPause still emits a log when auto-approve is enabled", () => {
  const events: Array<{ type: string; text?: string }> = [];
  const driver = new TestSessionDriver(() => config, () => new FakeTransport());
  const observer: RuntimeObserver = {
    onEvent: (event) => {
      if (event.type === "log") {
        events.push(event);
      }
    },
    onExit: () => {}
  };

  driver.primeRun(observer);
  driver.emit(
    JSON.stringify({
      event: {
        TurnPause: {
          turn_id: "op_789",
          reason: {
            Wait: {
              message: "still waiting"
            }
          }
        }
      }
    })
  );
  assert.equal(events.length, 1);
  assert.match(events[0]?.text ?? "", /Ante TurnPause/);
});

test("thinking, usage, and compaction events are surfaced as structured runtime events", () => {
  const driver = new TestSessionDriver(() => config, () => new FakeTransport());
  const events: Array<{ type: string; text?: string; mode?: string; phase?: string; totalTokens?: number }> = [];
  const observer: RuntimeObserver = {
    onEvent: (event) => {
      switch (event.type) {
        case "session.thinking":
          events.push({ type: event.type, text: event.text, mode: event.mode });
          break;
        case "session.usage":
          events.push({ type: event.type, totalTokens: event.usage.totalTokens });
          break;
        case "session.compaction":
          events.push({ type: event.type, phase: event.phase });
          break;
      }
    },
    onExit: () => {}
  };

  driver.primeRun(observer);
  driver.emit(JSON.stringify({ event: { ThinkingDelta: { delta: "plan..." } } }));
  driver.emit(JSON.stringify({ event: { UsageUpdate: { total_tokens: 42 } } }));
  driver.emit(JSON.stringify({ event: "CompactStart" }));
  driver.emit(JSON.stringify({ event: "CompactEnd" }));

  assert.deepEqual(events, [
    { type: "session.thinking", text: "plan...", mode: "delta" },
    { type: "session.usage", totalTokens: 42 },
    { type: "session.compaction", phase: "start" },
    { type: "session.compaction", phase: "end" }
  ]);
});

test("cancelActiveRun sends Interrupt and preserves the session when Ante confirms interruption", () => {
  const transport = new FakeTransport();
  const driver = new TestSessionDriver(() => config, () => transport);
  const exits: Array<{ status: "completed" | "failed" | "cancelled"; error?: string }> = [];
  const observer: RuntimeObserver = {
    onEvent: () => {},
    onExit: (result) => {
      exits.push(result);
    }
  };

  driver.primeSession(transport, "ses_current");
  driver.primeRun(observer);

  driver.cancelActiveRun();

  assert.equal(JSON.parse(transport.sentMessages.at(-1) ?? "{}").op, "Interrupt");

  driver.emit(JSON.stringify({ event: { TurnEnd: { status: "Interrupted" } } }));

  assert.equal(exits.at(-1)?.status, "cancelled");
  assert.equal(driver.getActiveSessionId(), "ses_current");
  assert.equal(transport.connected, true);
});

test("cancelActiveRun falls back to disconnect when Ante does not acknowledge the interrupt", async () => {
  const transport = new FakeTransport();
  const driver = new TestSessionDriver(() => config, () => transport);
  const exits: Array<{ status: "completed" | "failed" | "cancelled"; error?: string }> = [];
  const observer: RuntimeObserver = {
    onEvent: () => {},
    onExit: (result) => {
      exits.push(result);
    }
  };

  driver.primeSession(transport, "ses_current");
  driver.primeRun(observer);

  driver.cancelActiveRun();
  await new Promise((resolve) => setTimeout(resolve, 850));

  assert.equal(exits.at(-1)?.status, "cancelled");
  assert.equal(driver.getActiveSessionId(), null);
  assert.equal(transport.connected, false);
});

test("run resumes the requested session before sending user input", async () => {
  const transport = new FakeTransport();
  const driver = new TestSessionDriver(() => config, () => transport);
  const events: Array<{ type: string; sessionId?: string; text?: string }> = [];
  const exits: Array<{ status: "completed" | "failed" | "cancelled"; error?: string }> = [];
  const observer: RuntimeObserver = {
    onEvent: (event) => {
      if (event.type === "runtime.session") {
        events.push({ type: event.type, sessionId: event.sessionId });
      }
      if (event.type === "result.text") {
        events.push({ type: event.type, text: event.text });
      }
    },
    onExit: (result) => {
      exits.push(result);
    }
  };

  driver.run(
    {
      ...request,
      kind: "chat",
      triggerSource: "chat",
      mode: "followup",
      runtimeSessionId: "ses_target"
    },
    observer
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(transport.sentMessages.length, 1);
  assert.deepEqual(JSON.parse(transport.sentMessages[0] ?? "{}").op, {
    ResumeSession: {
      session_id: "ses_target"
    }
  });

  driver.emit(JSON.stringify({ event: { SessionStart: { session_id: "ses_target" } } }));
  driver.emit(JSON.stringify({ event: { ExtensionRefreshed: { session_id: "ses_target", skills: [], subagents: [] } } }));
  driver.emit(JSON.stringify({ event: { AgentMessage: "old replay that should be ignored" } }));
  driver.emit(JSON.stringify({ event: { TurnEnd: { status: "Completed" } } }));

  await new Promise((resolve) => setTimeout(resolve, 180));

  assert.equal(transport.sentMessages.length, 2);
  assert.deepEqual(JSON.parse(transport.sentMessages[1] ?? "{}").op, {
    UserInput: buildInteractivePrompt({
      ...request,
      kind: "chat",
      triggerSource: "chat",
      mode: "followup",
      runtimeSessionId: "ses_target"
    })
  });

  driver.emit(JSON.stringify({ event: { AgentMessage: "{\"type\":\"text\",\"text\":\"fresh response\"}" } }));
  driver.emit(JSON.stringify({ event: { TurnEnd: { status: "Completed" } } }));

  assert.deepEqual(
    events.filter((event) => event.type === "runtime.session"),
    [{ type: "runtime.session", sessionId: "ses_target" }]
  );
  assert.deepEqual(
    events.filter((event) => event.type === "result.text"),
    [{ type: "result.text", text: "fresh response" }]
  );
  assert.equal(exits.at(-1)?.status, "completed");
});

test("resume continues after SessionStart even when ExtensionRefreshed is not emitted", async () => {
  const transport = new FakeTransport();
  const driver = new TestSessionDriver(() => config, () => transport);

  driver.run(
    {
      ...request,
      kind: "chat",
      triggerSource: "chat",
      mode: "followup",
      runtimeSessionId: "ses_target_no_extension"
    },
    {
      onEvent: () => {},
      onExit: () => {}
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(transport.sentMessages.length, 1);
  driver.emit(JSON.stringify({ event: { SessionStart: { session_id: "ses_target_no_extension" } } }));
  driver.emit(JSON.stringify({ event: { AgentMessage: "history replay ignored" } }));
  driver.emit(JSON.stringify({ event: { TurnEnd: { status: "Completed" } } }));

  await new Promise((resolve) => setTimeout(resolve, 180));

  assert.equal(transport.sentMessages.length, 2);
  assert.deepEqual(JSON.parse(transport.sentMessages[1] ?? "{}").op, {
    UserInput: buildInteractivePrompt({
      ...request,
      kind: "chat",
      triggerSource: "chat",
      mode: "followup",
      runtimeSessionId: "ses_target_no_extension"
    })
  });
});

test("initial chat requests start a fresh session instead of reusing the current one", async () => {
  const transport = new FakeTransport();
  const driver = new TestSessionDriver(() => config, () => transport);
  driver.primeSession(transport, "ses_current");

  driver.run(
    {
      ...request,
      kind: "chat",
      triggerSource: "chat",
      mode: "initial"
    },
    {
      onEvent: () => {},
      onExit: () => {}
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(transport.sentMessages.length, 1);
  assert.deepEqual(JSON.parse(transport.sentMessages[0] ?? "{}").op, {
    StartSession: {
      model: config.model,
      provider: config.provider,
      streaming: true,
      thinking: null
    }
  });
});

test("runtime target think level is forwarded when starting a fresh session", async () => {
  const transport = new FakeTransport();
  const driver = new TestSessionDriver(() => config, () => transport);

  driver.run(
    {
      ...request,
      kind: "chat",
      triggerSource: "chat",
      mode: "initial",
      runtimeTarget: {
        provider: "openai-subscription",
        model: "gpt-5.4",
        thinking: "Max"
      }
    },
    {
      onEvent: () => {},
      onExit: () => {}
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(JSON.parse(transport.sentMessages[0] ?? "{}").op, {
    StartSession: {
      model: "gpt-5.4",
      provider: "openai-subscription",
      streaming: true,
      thinking: "Max"
    }
  });
});

test("SessionStart preferred models are surfaced on runtime session events", async () => {
  const transport = new FakeTransport();
  const driver = new TestSessionDriver(() => config, () => transport);
  const events: Array<{
    type: string;
    sessionId?: string;
    activeProvider?: string;
    activeModel?: string;
    availableModels?: string[];
  }> = [];

  driver.run(
    {
      ...request,
      kind: "chat",
      triggerSource: "chat",
      mode: "initial"
    },
    {
      onEvent: (event) => {
        if (event.type === "runtime.session") {
          events.push(event);
        }
      },
      onExit: () => {}
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  driver.emit(
    JSON.stringify({
      event: {
        SessionStart: {
          session_id: "ses_models",
          model: { name: "gpt-5.4" },
          provider: {
            name: "openai-subscription",
            preferred_models: [{ name: "gpt-5.5" }, { name: "gpt-5.4" }]
          }
        }
      }
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(events.length, 1);
  assert.equal(events[0]?.sessionId, "ses_models");
  assert.equal(events[0]?.activeProvider, "openai-subscription");
  assert.equal(events[0]?.activeModel, "gpt-5.4");
  assert.deepEqual(events[0]?.availableModels, ["gpt-5.5", "gpt-5.4"]);
});

test("resuming a different saved session on a compatible transport does not report reuse", async () => {
  const transport = new FakeTransport();
  const driver = new TestSessionDriver(() => config, () => transport);
  driver.primeSession(transport, "ses_current");

  const logs: string[] = [];
  driver.run(
    {
      ...request,
      kind: "chat",
      triggerSource: "chat",
      mode: "followup",
      runtimeSessionId: "ses_other"
    },
    {
      onEvent: (event) => {
        if (event.type === "log" && event.stream === "system") {
          logs.push(event.text);
        }
      },
      onExit: () => {}
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(logs.some((entry) => entry.includes("Reusing existing Ante session")), false);
});

test("persistActiveSession sends Shutdown and waits for transport close", async () => {
  const transport = new FakeTransport();
  const driver = new TestSessionDriver(() => config, () => transport);
  const warmup = driver.ensureWarmSession();
  await new Promise((resolve) => setTimeout(resolve, 0));
  driver.emit(JSON.stringify({ event: { SessionStart: { session_id: "ses_current" } } }));
  await warmup;

  const pending = driver.persistActiveSession();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(transport.sentMessages.length, 2);
  assert.equal(JSON.parse(transport.sentMessages[1] ?? "{}").op, "Shutdown");

  transport.closeHandler({ code: 0 });
  await pending;
  assert.equal(driver.getActiveSessionId(), null);
});

test("run waits for a pending shutdown to finish before resuming another session", async () => {
  const transport = new FakeTransport();
  const driver = new TestSessionDriver(() => config, () => transport);
  const warmup = driver.ensureWarmSession();
  await new Promise((resolve) => setTimeout(resolve, 0));
  driver.emit(JSON.stringify({ event: { SessionStart: { session_id: "ses_current" } } }));
  await warmup;

  const shutdown = driver.persistActiveSession();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(JSON.parse(transport.sentMessages.at(-1) ?? "{}").op, "Shutdown");

  driver.run(
    {
      ...request,
      kind: "chat",
      triggerSource: "chat",
      mode: "followup",
      runtimeSessionId: "ses_next"
    },
    {
      onEvent: () => {},
      onExit: () => {}
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(
    transport.sentMessages.some((message) => JSON.parse(message).op?.ResumeSession?.session_id === "ses_next"),
    false
  );

  transport.closeHandler({ code: 0 });
  await shutdown;
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(
    transport.sentMessages.some((message) => JSON.parse(message).op?.ResumeSession?.session_id === "ses_next"),
    true
  );
});

test("persistActiveSession resolves after SessionEnd even before transport close", async () => {
  const transport = new FakeTransport();
  const driver = new TestSessionDriver(() => config, () => transport);
  const warmup = driver.ensureWarmSession();
  await new Promise((resolve) => setTimeout(resolve, 0));
  driver.emit(JSON.stringify({ event: { SessionStart: { session_id: "ses_current" } } }));
  await warmup;

  const pending = driver.persistActiveSession();
  await new Promise((resolve) => setTimeout(resolve, 0));
  driver.emit(JSON.stringify({ event: "SessionEnd", parent: "op_shutdown" }));
  await pending;

  assert.equal(driver.getActiveSessionId(), null);
  assert.equal(transport.connected, false);
});

test("stale transport close is ignored after a newer transport starts", async () => {
  const transports: FakeTransport[] = [];
  const driver = new TestSessionDriver(() => config, () => {
    const transport = new FakeTransport();
    transports.push(transport);
    return transport;
  });

  const warmup = driver.ensureWarmSession();
  await new Promise((resolve) => setTimeout(resolve, 0));
  transports[0]?.messageHandler(JSON.stringify({ event: { SessionStart: { session_id: "ses_current" } } }));
  await warmup;

  const shutdown = driver.persistActiveSession();
  await new Promise((resolve) => setTimeout(resolve, 0));
  transports[0]?.messageHandler(JSON.stringify({ event: "SessionEnd", parent: "op_shutdown" }));
  await shutdown;

  const exits: Array<{ status: "completed" | "failed" | "cancelled"; error?: string }> = [];
  driver.run(
    {
      ...request,
      kind: "chat",
      triggerSource: "chat",
      mode: "followup",
      runtimeSessionId: "ses_next"
    },
    {
      onEvent: () => {},
      onExit: (result) => {
        exits.push(result);
      }
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(transports.length >= 2, true);
  transports[0]?.closeHandler({ code: 0 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(exits.length, 0);
});
