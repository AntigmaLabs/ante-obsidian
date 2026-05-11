# @antigma/ante-sdk

TypeScript SDK for launching Ante, managing sessions, and streaming protocol messages.

## Install

```bash
npm install @antigma/ante-sdk
```

## Query API

The main entrypoint follows the Claude Code SDK style: `query({ prompt, options })` returns an async generator with control methods.

```ts
import { query } from "@antigma/ante-sdk";

const q = query({
  prompt: "Summarize this repository.",
  options: {
    cwd: process.cwd(),
    pathToAnteExecutable: "ante",
    provider: "openai-subscription",
    model: "gpt-5.4",
    permissionMode: "default"
  }
});

for await (const message of q) {
  if (message.type === "stream_event" && message.event.type === "text_delta") {
    process.stdout.write(message.event.text);
  }
}
```

## Low-Level Client

For UI integrations that need direct session control:

```ts
import { createAnteClient } from "@antigma/ante-sdk";

const client = createAnteClient({
  cwd: process.cwd(),
  pathToAnteExecutable: "ante",
  provider: "openai-subscription",
  model: "gpt-5.4"
});

client.setMessageHandler((message) => {
  console.log(message);
});

await client.connect();
client.startSession();
client.sendUserInput("Hello from Ante SDK");
```

## Publish

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run -w @antigma/ante-sdk
npm publish -w @antigma/ante-sdk
```
