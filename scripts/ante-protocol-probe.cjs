const { spawn } = require("node:child_process");
const { createConnection } = require("node:net");
const { getAnteConfig } = require("./ante-config.cjs");

const anteConfig = getAnteConfig();

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

const sessionConfig = {
  model: anteConfig.model,
  provider: anteConfig.provider,
  streaming: true
};

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

const candidates = [
  {
    name: "only id",
    payload: () => ({ id: generateUlid() })
  },
  {
    name: "only op external-tagged",
    payload: () => ({ op: { StartSession: sessionConfig } })
  },
  {
    name: "id + external-tagged op",
    payload: () => ({ id: generateUlid(), op: { StartSession: sessionConfig } })
  },
  {
    name: "op-prefixed id + external-tagged op",
    payload: () => ({ id: `op_${generateUlid()}`, op: { StartSession: sessionConfig } })
  },
  {
    name: "id + tuple op",
    payload: () => ({ id: generateUlid(), op: ["StartSession", sessionConfig] })
  },
  {
    name: "id + internal-tagged op",
    payload: () => ({ id: generateUlid(), op: { type: "StartSession", ...sessionConfig } })
  },
  {
    name: "top-level StartSession",
    payload: () => ({ id: generateUlid(), StartSession: sessionConfig })
  },
  {
    name: "top-level type",
    payload: () => ({ id: generateUlid(), type: "StartSession", ...sessionConfig })
  },
  {
    name: "array id + external-tagged op",
    payload: () => [generateUlid(), { StartSession: sessionConfig }]
  },
  {
    name: "array id + tuple op",
    payload: () => [generateUlid(), "StartSession", sessionConfig]
  },
  {
    name: "array external-tagged op only",
    payload: () => [{ StartSession: sessionConfig }]
  }
];

async function probe(candidate) {
  return new Promise((resolve) => {
    const child = spawn(anteConfig.command, anteConfig.args, {
      cwd: anteConfig.cwd,
      stdio: anteConfig.transport === "websocket" ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;
    let socket = null;

    const finish = (result) => {
      if (resolved) {
        return;
      }
      resolved = true;
      try {
        socket?.close();
      } catch {
        // ignore shutdown cleanup failures
      }
      child.kill("SIGTERM");
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ name: candidate.name, outcome: "timeout", stdout, stderr });
    }, 5000);

    const handleText = (text) => {
      stdout += text;
      if (stdout.includes("SessionStart")) {
        clearTimeout(timer);
        finish({ name: candidate.name, outcome: "accepted", stdout, stderr });
        return;
      }
      if (stdout.includes("\"Error\"")) {
        clearTimeout(timer);
        finish({ name: candidate.name, outcome: "error", stdout, stderr });
      }
    };

    child.stdout.on("data", (buf) => {
      handleText(buf.toString("utf8"));
    });

    child.stderr.on("data", (buf) => {
      stderr += buf.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ name: candidate.name, outcome: `spawn-error:${error.message}`, stdout, stderr });
    });

    child.on("spawn", () => {
      const payload = `${JSON.stringify(candidate.payload())}\n`;
      if (anteConfig.transport !== "websocket") {
        child.stdin.write(payload);
        return;
      }

      const deadline = Date.now() + 5000;
      void (async () => {
        try {
          await waitForSocketReady(anteConfig.wsUrl, deadline);
        } catch (error) {
          clearTimeout(timer);
          finish({ name: candidate.name, outcome: `ws-connect-error:${error.message}`, stdout, stderr });
          return;
        }

        const ws = new WebSocket(anteConfig.wsUrl);
        ws.onopen = () => {
          socket = ws;
          ws.send(payload);
        };
        ws.onmessage = (event) => {
          handleText(typeof event.data === "string" ? `${event.data}\n` : `${Buffer.from(event.data).toString("utf8")}\n`);
        };
        ws.onerror = () => {
          clearTimeout(timer);
          finish({ name: candidate.name, outcome: `ws-connect-error:${anteConfig.wsUrl}`, stdout, stderr });
        };
        ws.onclose = () => {
          if (socket === ws) {
            socket = null;
          }
        };
      })();
    });
  });
}

(async () => {
  console.log(`transport=${anteConfig.transport}`);
  for (const candidate of candidates) {
    const result = await probe(candidate);
    console.log(`=== ${result.name} ===`);
    console.log(result.outcome);
    if (result.stdout) {
      console.log(result.stdout.trim());
    }
    if (result.stderr) {
      console.log(result.stderr.trim());
    }
  }
})();
