import test from "node:test";
import assert from "node:assert/strict";
import { __test__ } from "../src/runtime/create-ante-runtime";
import { normalizeWsListenAddress } from "../src/runtime/transport/ante-websocket-transport";

test("parseArgs rejects non-string-array JSON", () => {
  assert.throws(() => __test__.parseArgs('{"bad":true}'), /string array/i);
});

test("ensureServeArgs injects serve and stdio once", () => {
  assert.deepEqual(__test__.ensureServeArgs(["--yolo"]), ["serve", "--yolo", "--stdio"]);
  assert.deepEqual(__test__.ensureServeArgs(["serve", "--stdio", "--yolo"]), ["serve", "--stdio", "--yolo"]);
});

test("stripTransportArgs removes stdio and websocket transport flags", () => {
  assert.deepEqual(__test__.stripTransportArgs(["serve", "--stdio", "--yolo"]), ["serve", "--yolo"]);
  assert.deepEqual(__test__.stripTransportArgs(["serve", "--ws", "127.0.0.1:8765", "--yolo"]), ["serve", "--yolo"]);
});

test("ensureWebSocketArgs removes prior transport flags and appends ws address", () => {
  assert.deepEqual(__test__.ensureWebSocketArgs(["serve", "--stdio", "--yolo"], "127.0.0.1:8765"), [
    "serve",
    "--yolo",
    "--ws",
    "127.0.0.1:8765"
  ]);
  assert.deepEqual(__test__.ensureWebSocketArgs(["--yolo"], "127.0.0.1:9000"), [
    "serve",
    "--yolo",
    "--ws",
    "127.0.0.1:9000"
  ]);
});

test("normalizeWsListenAddress strips ws scheme for ante serve --ws", () => {
  assert.equal(normalizeWsListenAddress("127.0.0.1:8765"), "127.0.0.1:8765");
  assert.equal(normalizeWsListenAddress("ws://127.0.0.1:8765"), "127.0.0.1:8765");
  assert.equal(normalizeWsListenAddress("wss://example.com:443"), "example.com:443");
});
