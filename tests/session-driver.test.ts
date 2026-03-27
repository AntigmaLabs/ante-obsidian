import test from "node:test";
import assert from "node:assert/strict";
import { AnteSessionDriver, type AnteRuntimeConfig } from "../src/runtime/ante-session-driver";
import type { RuntimeObserver } from "../src/runtime/ante-runtime";
import type { TaskRequest } from "../src/core/types";
import type { AnteTransport } from "../src/runtime/transport/ante-transport";

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

  send(_message: string): void {}

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
}

const config: AnteRuntimeConfig = {
  connectionMode: "stdio",
  command: "ante",
  argsJson: JSON.stringify(["serve", "--stdio"]),
  cwd: "",
  wsAddress: "",
  model: "gpt-5.4",
  provider: "openai-subscription",
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
