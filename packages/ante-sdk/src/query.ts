import { createAnteClient, type AnteClient } from "./session/client";
import type { Options, PermissionMode, Query, SDKMessage, SDKUserMessage } from "./types";

type QueueItem = IteratorResult<SDKMessage, void>;

class AsyncMessageQueue {
  private readonly items: QueueItem[] = [];
  private readonly waiters: Array<(item: QueueItem) => void> = [];
  private closed = false;

  push(message: SDKMessage): void {
    this.enqueue({ value: message, done: false });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.enqueue({ value: undefined, done: true });
  }

  async next(): Promise<QueueItem> {
    const item = this.items.shift();
    if (item) {
      return item;
    }
    if (this.closed) {
      return { value: undefined, done: true };
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private enqueue(item: QueueItem): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return;
    }
    this.items.push(item);
  }
}

class AnteQuery implements Query {
  private readonly queue = new AsyncMessageQueue();
  private readonly client: AnteClient;
  private permissionMode: PermissionMode;
  private model?: string;

  constructor(
    prompt: string | AsyncIterable<SDKUserMessage>,
    options: Options = {},
    clientFactory: (options: Options) => AnteClient = createAnteClient
  ) {
    this.permissionMode = options.permissionMode ?? "default";
    this.model = options.model;
    this.client = clientFactory(options);
    this.client.setMessageHandler((message) => this.queue.push(message));
    this.client.setDoneHandler(() => this.queue.close());
    void this.start(prompt, options);
  }

  [Symbol.asyncIterator](): AsyncGenerator<SDKMessage, void> {
    return this;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.close();
  }

  async next(): Promise<IteratorResult<SDKMessage, void>> {
    return this.queue.next();
  }

  async return(): Promise<IteratorResult<SDKMessage, void>> {
    this.close();
    return { value: undefined, done: true };
  }

  async throw(error?: unknown): Promise<IteratorResult<SDKMessage, void>> {
    this.close();
    throw error;
  }

  async interrupt(): Promise<void> {
    this.client.interrupt();
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.permissionMode = mode;
  }

  async setModel(model?: string): Promise<void> {
    this.model = model;
  }

  async streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void> {
    for await (const message of stream) {
      this.client.sendUserInput(message.message);
    }
  }

  close(): void {
    this.client.close();
    this.queue.close();
  }

  private async start(prompt: string | AsyncIterable<SDKUserMessage>, options: Options): Promise<void> {
    try {
      await this.client.connect();
      if (options.resume?.trim()) {
        await this.client.resumeSession(options.resume.trim());
      } else {
        await this.client.startSession();
      }

      if (typeof prompt === "string") {
        this.client.sendUserInput(prompt);
        return;
      }

      await this.streamInput(prompt);
    } catch (error) {
      this.queue.push({
        type: "result",
        subtype: "error",
        error: error instanceof Error ? error.message : String(error)
      });
      this.queue.close();
    }
  }
}

export function query({
  prompt,
  options
}: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query {
  return new AnteQuery(prompt, options);
}

export const __test__ = {
  AnteQuery
};
