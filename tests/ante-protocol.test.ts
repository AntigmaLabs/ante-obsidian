import test from "node:test";
import assert from "node:assert/strict";
import { serializeOperation } from "../src/runtime/ante-protocol";

test("serializeOperation supports Shutdown operations", () => {
  const payload = JSON.parse(serializeOperation("Shutdown", "op_shutdown"));
  assert.equal(payload.id, "op_shutdown");
  assert.equal(payload.op, "Shutdown");
});
