const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.join(rootDir, ".release");
const outputPath = path.join(releaseDir, "release-context.json");

const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), "utf8"));

const runGit = (args, options = {}) => {
  try {
    return execFileSync("git", args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", options.allowFailure ? "ignore" : "pipe"]
    }).trim();
  } catch (error) {
    if (options.allowFailure) {
      return "";
    }
    throw error;
  }
};

const parseChangelog = () => {
  const changelogPath = path.join(rootDir, "doc", "CHANGELOG.md");
  if (!fs.existsSync(changelogPath)) {
    return { latest: null, styleSample: "" };
  }

  const content = fs.readFileSync(changelogPath, "utf8");
  const headingPattern = /^##\s+v?(\d+\.\d+\.\d+)(?:\s+-\s+(.+))?$/gm;
  const headings = [...content.matchAll(headingPattern)];
  const latest = headings[0]
    ? {
        version: headings[0][1],
        date: headings[0][2] || null,
        heading: headings[0][0]
      }
    : null;

  const styleSampleEnd = headings[2]?.index ?? Math.min(content.length, 3000);
  const styleSample = content.slice(0, styleSampleEnd).trim();

  return { latest, styleSample };
};

const getTags = () =>
  runGit(["tag", "--sort=-creatordate"], { allowFailure: true })
    .split("\n")
    .map((tag) => tag.trim())
    .filter(Boolean);

const getLatestTag = () =>
  runGit(["describe", "--tags", "--abbrev=0"], { allowFailure: true }) || null;

const getCommits = (baseRef) => {
  const range = baseRef ? `${baseRef}..HEAD` : "HEAD";
  const raw = runGit(
    [
      "log",
      range,
      "--date=short",
      "--format=%x1e%H%x1f%h%x1f%ad%x1f%an%x1f%s%x1f%b"
    ],
    { allowFailure: true }
  );

  return raw
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, shortHash, date, author, subject, body = ""] =
        entry.split("\x1f");
      const files = runGit(
        ["show", "--name-only", "--format=", hash],
        { allowFailure: true }
      )
        .split("\n")
        .map((file) => file.trim())
        .filter(Boolean);

      return {
        hash,
        shortHash,
        date,
        author,
        subject,
        body: body.trim(),
        files
      };
    });
};

const getAssetInfo = (assetPath) => {
  const stat = fs.statSync(assetPath);
  return {
    name: path.basename(assetPath),
    path: path.relative(rootDir, assetPath),
    sizeBytes: stat.size
  };
};

const getReleaseAssets = (pluginId, version) => {
  if (!fs.existsSync(releaseDir)) {
    return { currentZip: null, standalone: [], missingStandalone: [], otherZipAssets: [] };
  }

  const expectedZip = `${pluginId}-${version}.zip`;
  const expectedStandaloneAssets = ["main.js", "manifest.json", "styles.css"];
  const zipAssets = fs
    .readdirSync(releaseDir)
    .filter((name) => name.endsWith(".zip"))
    .map((name) => {
      return getAssetInfo(path.join(releaseDir, name));
    });
  const standalone = expectedStandaloneAssets
    .filter((name) => fs.existsSync(path.join(releaseDir, name)))
    .map((name) => getAssetInfo(path.join(releaseDir, name)));

  return {
    currentZip: zipAssets.find((asset) => asset.name === expectedZip) || null,
    standalone,
    missingStandalone: expectedStandaloneAssets.filter(
      (name) => !fs.existsSync(path.join(releaseDir, name))
    ),
    otherZipAssets: zipAssets.filter((asset) => asset.name !== expectedZip)
  };
};

const packageJson = readJson("package.json");
const manifestJson = readJson("manifest.json");
const versionsJson = readJson("versions.json");
const changelog = parseChangelog();
const tags = getTags();
const latestTag = getLatestTag();
const expectedCurrentTag = `v${packageJson.version}`;
const currentVersionTag =
  [expectedCurrentTag, packageJson.version].find((tag) => tags.includes(tag)) ||
  null;
const currentVersionTagExists = currentVersionTag !== null;
const latestChangelogTag = changelog.latest
  ? [`v${changelog.latest.version}`, changelog.latest.version].find((tag) =>
      tags.includes(tag)
    ) || null
  : null;
const baseRef = currentVersionTag
  ? currentVersionTag
  : latestChangelogTag || latestTag;
const commits = getCommits(baseRef);
const touchedFiles = [...new Set(commits.flatMap((commit) => commit.files))].sort();
const releaseAssets = getReleaseAssets(manifestJson.id, packageJson.version);

const context = {
  generatedAt: new Date().toISOString(),
  repository: {
    root: rootDir,
    branch: runGit(["branch", "--show-current"], { allowFailure: true }) || null,
    head: runGit(["rev-parse", "HEAD"], { allowFailure: true }) || null,
    remoteOrigin:
      runGit(["remote", "get-url", "origin"], { allowFailure: true }) || null,
    statusShort: runGit(["status", "--short"], { allowFailure: true })
  },
  release: {
    version: packageJson.version,
    expectedTag: expectedCurrentTag,
    currentVersionTag,
    currentVersionTagExists,
    latestTag,
    latestChangelogVersion: changelog.latest,
    baseRef,
    asset: releaseAssets.currentZip,
    assets: releaseAssets,
    otherZipAssets: releaseAssets.otherZipAssets
  },
  package: {
    name: packageJson.name,
    version: packageJson.version
  },
  plugin: {
    id: manifestJson.id,
    name: manifestJson.name,
    version: manifestJson.version,
    minAppVersion: manifestJson.minAppVersion,
    description: manifestJson.description
  },
  versionsJson: {
    currentMinAppVersion: versionsJson[packageJson.version] || null
  },
  changelogStyleSample: changelog.styleSample,
  commits,
  touchedFiles
};

fs.mkdirSync(releaseDir, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(context, null, 2)}\n`, "utf8");

console.log(`Wrote release context: ${path.relative(rootDir, outputPath)}`);
