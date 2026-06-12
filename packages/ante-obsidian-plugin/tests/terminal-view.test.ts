import test from "node:test";
import assert from "node:assert/strict";
import { terminalStatus, terminalStatusClass } from "../src/core/terminal-status";
import type { TaskRecord } from "../src/core/types";

const baseTask: TaskRecord = {
  id: "task-1",
  kind: "terminal",
  preset: {
    id: "default",
    label: "@ante",
    goal: "Discuss the current Markdown content before editing anything.",
    systemInstructions: "",
  },
  triggerSource: "terminal",
  inlineInstruction: "prompt",
  context: null,
  status: "completed",
  logs: [],
  stdoutText: "",
  artifacts: [],
  startedAt: "2026-03-29T00:00:00.000Z",
};

test("terminal cancelled tasks use stopped status semantics", () => {
  const cancelledTask: TaskRecord = {
    ...baseTask,
    status: "cancelled",
  };

  assert.equal(terminalStatus(cancelledTask), "stopped");
  assert.equal(terminalStatusClass(cancelledTask), "tmd-is-muted");
});
