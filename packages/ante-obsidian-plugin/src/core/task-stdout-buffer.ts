import { cancelTimeout, scheduleTimeout, type TimerHandle } from "./timers";

const MAX_STDOUT_BUFFER_CHARS = 16000;
const STDOUT_FLUSH_INTERVAL_MS = 100;

export class TaskStdoutBuffer {
  private readonly pendingStdout = new Map<
    string,
    { chunks: string[]; timer: TimerHandle | null }
  >();

  constructor(
    private readonly shouldPreserveFullStdout: () => boolean,
    private readonly onFlush: (taskId: string, incomingChunksCombined: string) => void,
  ) {}

  queue(taskId: string, text: string): void {
    const pending = this.pendingStdout.get(taskId) ?? { chunks: [], timer: null };
    pending.chunks.push(text);
    if (pending.timer == null) {
      pending.timer = scheduleTimeout(() => {
        this.flush(taskId);
      }, STDOUT_FLUSH_INTERVAL_MS);
    }
    this.pendingStdout.set(taskId, pending);
  }

  flush(taskId: string): void {
    const pending = this.pendingStdout.get(taskId);
    if (!pending || pending.chunks.length === 0) {
      if (pending?.timer != null) {
        cancelTimeout(pending.timer);
        this.pendingStdout.delete(taskId);
      }
      return;
    }

    if (pending.timer != null) {
      cancelTimeout(pending.timer);
    }

    this.pendingStdout.delete(taskId);
    this.onFlush(taskId, pending.chunks.join(""));
  }

  clear(taskId: string): void {
    const pending = this.pendingStdout.get(taskId);
    if (pending?.timer != null) {
      cancelTimeout(pending.timer);
    }
    this.pendingStdout.delete(taskId);
  }

  appendStdoutPreview(existing: string, incoming: string): string {
    if (!incoming) {
      return existing;
    }

    const combined = existing + incoming;
    if (this.shouldPreserveFullStdout()) {
      return combined;
    }
    if (combined.length <= MAX_STDOUT_BUFFER_CHARS) {
      return combined;
    }

    return combined.slice(-MAX_STDOUT_BUFFER_CHARS);
  }
}
