const { join } = require("node:path");

const repoRoot = join(__dirname, "..");

const getAnteConfig = () => ({
  command: process.env.ANTE_BIN || "ante",
  cwd: process.env.ANTE_CWD || repoRoot,
  model: process.env.ANTE_MODEL || "gpt-5.4",
  provider: process.env.ANTE_PROVIDER || "openai-subscription",
  args: ["serve", "--stdio", "--yolo"]
});

module.exports = {
  getAnteConfig,
  repoRoot
};
