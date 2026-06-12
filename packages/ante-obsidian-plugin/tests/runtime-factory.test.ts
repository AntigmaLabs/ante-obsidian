import test from "node:test";
import assert from "node:assert/strict";
import { __test__ } from "../src/runtime/create-ante-runtime";
import { normalizeWsListenAddress } from "../src/runtime/transport/ante-websocket-transport";

test("parseArgs rejects non-string-array JSON", () => {
  assert.throws(() => __test__.parseArgs('{"bad":true}'), /string array/i);
});

test("ensureServeArgs injects serve and stdio once", () => {
  assert.deepEqual(__test__.ensureServeArgs([]), ["serve", "--stdio"]);
  assert.deepEqual(__test__.ensureServeArgs(["serve", "--stdio"]), ["serve", "--stdio"]);
});

test("serve args remove legacy yolo flag", () => {
  assert.deepEqual(__test__.ensureServeArgs(["--yolo"]), ["serve", "--stdio"]);
  assert.deepEqual(__test__.ensureServeArgs(["serve", "--stdio", "--yolo"]), ["serve", "--stdio"]);
});

test("stripTransportArgs removes stdio, websocket transport flags, and legacy yolo", () => {
  assert.deepEqual(
    __test__.stripTransportArgs(["serve", "--stdio", "--offline-model", "model.gguf"]),
    ["serve", "--offline-model", "model.gguf"],
  );
  assert.deepEqual(__test__.stripTransportArgs(["serve", "--ws", "127.0.0.1:8765", "--yolo"]), [
    "serve",
  ]);
});

test("ensureWebSocketArgs removes prior transport flags and appends ws address", () => {
  assert.deepEqual(
    __test__.ensureWebSocketArgs(
      ["serve", "--stdio", "--offline-model", "model.gguf"],
      "127.0.0.1:8765",
    ),
    ["serve", "--offline-model", "model.gguf", "--ws", "127.0.0.1:8765"],
  );
  assert.deepEqual(__test__.ensureWebSocketArgs(["--yolo"], "127.0.0.1:9000"), [
    "serve",
    "--ws",
    "127.0.0.1:9000",
  ]);
});

test("normalizeWsListenAddress strips ws scheme for ante serve --ws", () => {
  assert.equal(normalizeWsListenAddress("127.0.0.1:8765"), "127.0.0.1:8765");
  assert.equal(normalizeWsListenAddress("ws://127.0.0.1:8765"), "127.0.0.1:8765");
  assert.equal(normalizeWsListenAddress("wss://example.com:443"), "example.com:443");
});
