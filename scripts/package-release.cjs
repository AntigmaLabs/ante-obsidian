const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf8")
);
const manifestJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, "manifest.json"), "utf8")
);

const version = packageJson.version;
const pluginId = manifestJson.id;
const requiredFiles = ["manifest.json", "main.js", "styles.css"];
const releaseDir = path.join(rootDir, ".release");
const stagingDir = path.join(releaseDir, pluginId);
const zipName = `${pluginId}-${version}.zip`;
const zipPath = path.join(releaseDir, zipName);
const standaloneAssetPaths = requiredFiles.map((file) =>
  path.join(releaseDir, file)
);

if (manifestJson.version !== version) {
  throw new Error(
    `Version mismatch: package.json=${version}, manifest.json=${manifestJson.version}`
  );
}

for (const file of requiredFiles) {
  const filePath = path.join(rootDir, file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required release file: ${file}`);
  }
}

fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });

for (const file of requiredFiles) {
  fs.copyFileSync(path.join(rootDir, file), path.join(stagingDir, file));
  fs.copyFileSync(path.join(rootDir, file), path.join(releaseDir, file));
}

fs.rmSync(zipPath, { force: true });

try {
  execFileSync("zip", ["-r", zipPath, pluginId], {
    cwd: releaseDir,
    stdio: "inherit"
  });
} catch (error) {
  throw new Error(
    "Failed to create release zip. Ensure the `zip` command is available."
  );
}

console.log(`Created release package: ${zipPath}`);
for (const assetPath of standaloneAssetPaths) {
  console.log(`Created release asset: ${assetPath}`);
}
