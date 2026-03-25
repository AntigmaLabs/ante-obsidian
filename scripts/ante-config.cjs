const { join } = require("node:path");

const repoRoot = join(__dirname, "..");

const transport = process.env.ANTE_TRANSPORT === "websocket" ? "websocket" : "stdio";
const wsAddress = process.env.ANTE_WS_ADDRESS || "127.0.0.1:8765";

const toWebSocketUrl = (address) => (/^wss?:\/\//i.test(address) ? address : `ws://${address}`);

const normalizeWsListenAddress = (address) => {
  const trimmed = address.trim();
  if (!trimmed) {
    throw new Error("ANTE_WS_ADDRESS is required for websocket transport");
  }
  if (/^wss?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    const port = Number(url.port || (url.protocol === "wss:" ? 443 : 80));
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`Invalid websocket port in ${trimmed}`);
    }
    return `${url.hostname}:${port}`;
  }
  return trimmed;
};

const stripTransportArgs = (args) => {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === "--stdio") {
      continue;
    }
    if (current === "--ws") {
      index += 1;
      continue;
    }
    result.push(current);
  }
  return result;
};

const baseArgs = stripTransportArgs(["serve", "--stdio", "--yolo"]);
const wsListenAddress = normalizeWsListenAddress(wsAddress);

const getAnteConfig = () => ({
  command: process.env.ANTE_BIN || "ante",
  cwd: process.env.ANTE_CWD || repoRoot,
  model: process.env.ANTE_MODEL || "gpt-5.4",
  provider: process.env.ANTE_PROVIDER || "openai-subscription",
  transport,
  wsAddress: wsListenAddress,
  wsUrl: toWebSocketUrl(wsAddress),
  args: transport === "websocket" ? [...baseArgs, "--ws", wsListenAddress] : [...baseArgs, "--stdio"]
});

module.exports = {
  getAnteConfig,
  repoRoot
};
