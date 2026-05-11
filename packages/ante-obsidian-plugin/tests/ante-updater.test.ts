import test from "node:test";
import assert from "node:assert/strict";
import { __test__ } from "../src/obsidian/ante-version";

test("normalizeAnteVersion strips binary name and v prefix", () => {
  assert.equal(__test__.normalizeAnteVersion("ante 0.preview.7"), "0.preview.7");
  assert.equal(__test__.normalizeAnteVersion("v0.preview.9"), "0.preview.9");
  assert.equal(__test__.normalizeAnteVersion(" ante   v1.2.3 "), "1.2.3");
});

test("parseAnteVersionOutput returns null for empty output", () => {
  assert.equal(__test__.parseAnteVersionOutput(""), null);
  assert.equal(__test__.parseAnteVersionOutput("   "), null);
});

test("shouldOfferAnteUpdate stays false for equivalent versions", () => {
  assert.equal(__test__.shouldOfferAnteUpdate("0.preview.9", "v0.preview.9"), false);
  assert.equal(__test__.shouldOfferAnteUpdate("ante 0.preview.9", "v0.preview.9"), false);
});

test("shouldOfferAnteUpdate returns true whenever normalized text differs", () => {
  assert.equal(__test__.shouldOfferAnteUpdate("0.preview.7", "v0.preview.9"), true);
  assert.equal(__test__.shouldOfferAnteUpdate("0.preview.10", "0.10.0"), true);
  assert.equal(__test__.shouldOfferAnteUpdate(null, "0.preview.9"), false);
});
