const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");

const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), "utf8"));

const runGit = (args) => {
  try {
    return execFileSync("git", args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
};

const fail = (message) => {
  console.error(`Release validation failed: ${message}`);
  process.exitCode = 1;
};

const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const packageJson = readJson("package.json");
const pluginPackageJson = readJson("packages/ante-obsidian-plugin/package.json");
const manifestJson = readJson("manifest.json");
const versionsJson = readJson("versions.json");

const version = packageJson.version;
const expectedTag = version;
const legacyPrefixedTag = `v${version}`;

if (!semverPattern.test(version)) {
  fail(`package.json version must be SemVer without a leading "v"; received "${version}"`);
}

if (manifestJson.version !== version) {
  fail(`manifest.json version "${manifestJson.version}" must match package.json version "${version}"`);
}

if (pluginPackageJson.version !== version) {
  fail(`packages/ante-obsidian-plugin/package.json version "${pluginPackageJson.version}" must match package.json version "${version}"`);
}

if (versionsJson[version] !== manifestJson.minAppVersion) {
  fail(`versions.json must contain "${version}": "${manifestJson.minAppVersion}"`);
}

for (const readmePath of ["README.md", "README.zh-CN.md"]) {
  const content = fs.readFileSync(path.join(rootDir, readmePath), "utf8");
  if (content.includes(`Release-v${version}-purple`)) {
    fail(`${readmePath} release badge must not use a leading "v"`);
  }
  if (!content.includes(`Release-${version}-purple`)) {
    fail(`${readmePath} release badge must show Release-${version}`);
  }
}

const currentTagCommit = runGit(["rev-parse", "--verify", `refs/tags/${expectedTag}^{}`]);
const legacyTagCommit = runGit(["rev-parse", "--verify", `refs/tags/${legacyPrefixedTag}^{}`]);
if (legacyTagCommit) {
  fail(`current release must use tag "${expectedTag}", not legacy tag "${legacyPrefixedTag}"`);
}

if (currentTagCommit) {
  const headCommit = runGit(["rev-parse", "HEAD"]);
  if (currentTagCommit !== headCommit) {
    fail(`tag "${expectedTag}" exists but does not point at HEAD`);
  }
}

if (process.exitCode) {
  process.exit();
}

console.log(`Release metadata is valid for Obsidian tag ${expectedTag}`);
