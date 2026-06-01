import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeVaultRelativePath,
  toVaultRelativePath
} from "../src/obsidian/vault-path";

test("toVaultRelativePath resolves iCloud Obsidian absolute paths inside the vault", () => {
  const vaultPath =
    "/Users/esp-mac3/Library/Mobile Documents/iCloud~md~obsidian/Documents";

  assert.equal(
    toVaultRelativePath(`${vaultPath}/智能音箱方案.md`, vaultPath),
    "智能音箱方案.md"
  );
});

test("toVaultRelativePath preserves nested vault-relative paths", () => {
  assert.equal(
    toVaultRelativePath("folder//nested\\Note.md", "/vault"),
    "folder/nested/Note.md"
  );
});

test("toVaultRelativePath rejects absolute paths outside the current vault", () => {
  assert.equal(
    toVaultRelativePath("/Users/esp-mac3/Desktop/智能音箱方案.md", "/vault"),
    null
  );
});

test("normalizeVaultRelativePath strips leading separators for Obsidian lookup", () => {
  assert.equal(
    normalizeVaultRelativePath("/folder//nested/Note.md/"),
    "folder/nested/Note.md"
  );
});
