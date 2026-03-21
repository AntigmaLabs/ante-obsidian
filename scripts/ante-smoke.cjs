const { spawn } = require("node:child_process");
const { getAnteConfig } = require("./ante-config.cjs");

const anteConfig = getAnteConfig();

const child = spawn(anteConfig.command, anteConfig.args, {
  cwd: anteConfig.cwd,
  stdio: ["pipe", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
let sessionStarted = false;
let done = false;

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
  child.stdin.write(`${JSON.stringify({ op, id: `op_${generateUlid()}` })}\n`);
}

function finish(label) {
  if (done) {
    return;
  }
  done = true;
  console.log("=== RESULT ===");
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
  send({
    StartSession: {
      model: anteConfig.model,
      provider: anteConfig.provider,
      streaming: true
    }
  });
});
