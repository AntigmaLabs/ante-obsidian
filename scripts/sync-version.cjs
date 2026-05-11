const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const repoRoot = join(__dirname, "..");
const packageJsonPath = join(repoRoot, "package.json");
const pluginPackageJsonPath = join(repoRoot, "packages", "ante-obsidian-plugin", "package.json");
const manifestJsonPath = join(repoRoot, "manifest.json");
const versionsJsonPath = join(repoRoot, "versions.json");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const packageJson = readJson(packageJsonPath);
const pluginPackageJson = readJson(pluginPackageJsonPath);
const manifestJson = readJson(manifestJsonPath);
const versionsJson = readJson(versionsJsonPath);

const version = packageJson.version;
const minAppVersion = manifestJson.minAppVersion;

if (typeof version !== "string" || !version.trim()) {
  throw new Error("package.json version must be a non-empty string");
}

if (typeof minAppVersion !== "string" || !minAppVersion.trim()) {
  throw new Error("manifest.json minAppVersion must be a non-empty string");
}

manifestJson.version = version;
pluginPackageJson.version = version;

const nextVersionsJson = {
  ...versionsJson,
  [version]: minAppVersion
};

writeJson(manifestJsonPath, manifestJson);
writeJson(pluginPackageJsonPath, pluginPackageJson);
writeJson(versionsJsonPath, nextVersionsJson);

console.log(`Synced version ${version} to manifest.json, versions.json, and ante-obsidian-plugin package.json`);
