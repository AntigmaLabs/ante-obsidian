import test from "node:test";
import assert from "node:assert/strict";
import { buildProcessStatusLines } from "../src/obsidian/chat-view-helpers";

test("buildProcessStatusLines omits transport stream prefixes", () => {
  const lines = buildProcessStatusLines({
    phase: "running",
    label: "Read",
    steps: [
      {
        id: "read",
        label: "Read",
        activeLabel: "Running Read",
        status: "in_progress"
      }
    ]
  });

  assert.deepEqual(lines, ["Running Read", "▪ Running Read"]);
});
