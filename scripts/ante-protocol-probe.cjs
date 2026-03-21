const { spawn } = require("node:child_process");
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
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;

    const finish = (result) => {
      if (resolved) {
        return;
      }
      resolved = true;
      child.kill("SIGTERM");
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ name: candidate.name, outcome: "timeout", stdout, stderr });
    }, 5000);

    child.stdout.on("data", (buf) => {
      stdout += buf.toString("utf8");
      if (stdout.includes("SessionStart")) {
        clearTimeout(timer);
        finish({ name: candidate.name, outcome: "accepted", stdout, stderr });
        return;
      }
      if (stdout.includes("\"Error\"")) {
        clearTimeout(timer);
        finish({ name: candidate.name, outcome: "error", stdout, stderr });
      }
    });

    child.stderr.on("data", (buf) => {
      stderr += buf.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ name: candidate.name, outcome: `spawn-error:${error.message}`, stdout, stderr });
    });

    child.on("spawn", () => {
      child.stdin.write(`${JSON.stringify(candidate.payload())}\n`);
    });
  });
}

(async () => {
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
