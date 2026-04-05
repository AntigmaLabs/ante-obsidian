import test from "node:test";
import assert from "node:assert/strict";
import { __test__ } from "../src/obsidian/plugin-version";

test("normalizePluginVersion strips v prefix", () => {
  assert.equal(__test__.normalizePluginVersion("v0.5.1"), "0.5.1");
  assert.equal(__test__.normalizePluginVersion(" 0.5.1 "), "0.5.1");
});

test("comparePluginVersions handles numeric semver ordering", () => {
  assert.equal(__test__.comparePluginVersions("0.5.0", "0.5.1"), -1);
  assert.equal(__test__.comparePluginVersions("0.6.0", "0.5.9"), 1);
  assert.equal(__test__.comparePluginVersions("1.0.0", "1.0.0"), 0);
});

test("comparePluginVersions treats prerelease as older than release", () => {
  assert.equal(__test__.comparePluginVersions("0.5.0-beta.1", "0.5.0"), -1);
  assert.equal(__test__.comparePluginVersions("0.5.0", "0.5.0-beta.1"), 1);
});

test("shouldOfferPluginUpdate only returns true for newer remote versions", () => {
  assert.equal(__test__.shouldOfferPluginUpdate("0.5.0", "0.5.1"), true);
  assert.equal(__test__.shouldOfferPluginUpdate("0.5.0", "v0.5.0"), false);
  assert.equal(__test__.shouldOfferPluginUpdate("0.5.1", null), false);
});
