const { spawn } = require("node:child_process");
const { createConnection } = require("node:net");
const { getAnteConfig } = require("./ante-config.cjs");

const anteConfig = getAnteConfig();
const child = spawn(anteConfig.command, anteConfig.args, {
  cwd: anteConfig.cwd,
  stdio: anteConfig.transport === "websocket" ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
let sessionStarted = false;
let done = false;
let socket = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSocketAddress(urlText) {
  const url = new URL(urlText);
  return {
    host: url.hostname,
    port: Number(url.port || (url.protocol === "wss:" ? 443 : 80))
  };
}

async function waitForSocketReady(urlText, deadline) {
  const { host, port } = parseSocketAddress(urlText);
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const socket = createConnection({ host, port });
        const cleanup = () => {
          socket.removeAllListeners();
          socket.destroy();
        };
        socket.once("connect", () => {
          cleanup();
          resolve();
        });
        socket.once("error", (error) => {
          cleanup();
          reject(error);
        });
      });
      return;
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }

  throw lastError || new Error(`Timed out waiting for websocket server ${urlText}`);
}

function generateUlid() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let timestamp = Date.now();
  let result = "";

  for (let index = 0; index < 10; index += 1) {
    result = alphabet[timestamp % 32] + result;
    timestamp = Math.floor(timestamp / 32);
  }

  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  for (let index = 0; index < randomBytes.length; index += 1) {
    result += alphabet[randomBytes[index] % 32];
  }

  return result;
}

function send(op) {
  const payload = `${JSON.stringify({ op, id: `op_${generateUlid()}` })}\n`;
  if (anteConfig.transport === "websocket") {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket smoke transport is not connected");
    }
    socket.send(payload);
    return;
  }
  child.stdin.write(payload);
}

function finish(label) {
  if (done) {
    return;
  }
  done = true;
  console.log("=== RESULT ===");
  console.log(`transport=${anteConfig.transport}`);
  console.log(label);
  console.log("--- STDOUT ---");
  console.log(stdout);
  console.log("--- STDERR ---");
  console.log(stderr);
  child.kill("SIGTERM");
}

const timer = setTimeout(() => {
  finish("timeout");
}, 30000);

child.stdout.on("data", (buf) => {
  const text = buf.toString("utf8");
  stdout += text;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const msg = JSON.parse(line);
      const event = msg.event;
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        continue;
      }

      const entry = Object.entries(event)[0];
      if (!entry) {
        continue;
      }

      const [name] = entry;
      if (name === "SessionStart" && !sessionStarted) {
        sessionStarted = true;
        send({
      UserInput:
            'Return exactly one JSON object and nothing else.\n{"type":"text","text":"smoke ok"}'
        });
      }

      if (name === "TurnEnd") {
        clearTimeout(timer);
        finish("turn-end");
      }
    } catch {
      // Ignore partial or non-JSON lines in the smoke script.
    }
  }
});

child.stderr.on("data", (buf) => {
  stderr += buf.toString("utf8");
});

child.on("error", (err) => {
  clearTimeout(timer);
  finish(`error:${err.message}`);
});

child.on("spawn", () => {
  if (anteConfig.transport === "websocket") {
    const deadline = Date.now() + 5000;
    void (async () => {
      try {
        await waitForSocketReady(anteConfig.wsUrl, deadline);
      } catch (error) {
        clearTimeout(timer);
        finish(`error:${error.message}`);
        return;
      }

      const ws = new WebSocket(anteConfig.wsUrl);
      ws.onopen = () => {
        socket = ws;
        send({
          StartSession: {
            model: anteConfig.model,
            provider: anteConfig.provider,
            streaming: true
          }
        });
      };
      ws.onmessage = (event) => {
        const text = typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8");
        stdout += `${text}\n`;

        for (const line of text.split(/\r?\n/)) {
          if (!line.trim()) {
            continue;
          }
          try {
            const msg = JSON.parse(line);
            const eventPayload = msg.event;
            if (!eventPayload || typeof eventPayload !== "object" || Array.isArray(eventPayload)) {
              continue;
            }
            const entry = Object.entries(eventPayload)[0];
            if (!entry) {
              continue;
            }
            const [name] = entry;
            if (name === "SessionStart" && !sessionStarted) {
              sessionStarted = true;
              send({
                UserInput:
                  'Return exactly one JSON object and nothing else.\n{"type":"text","text":"smoke ok"}'
              });
            }
            if (name === "TurnEnd") {
              clearTimeout(timer);
              finish("turn-end");
            }
          } catch {
            // Ignore partial or non-JSON lines in the smoke script.
          }
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        finish(`error:failed to connect websocket ${anteConfig.wsUrl}`);
      };
      ws.onclose = () => {
        socket = null;
      };
    })();
    return;
  }

  send({
    StartSession: {
      model: anteConfig.model,
      provider: anteConfig.provider,
      streaming: true
    }
  });
});
