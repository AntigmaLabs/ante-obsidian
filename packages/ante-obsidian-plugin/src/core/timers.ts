import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from "node:timers";

export type TimerHandle = number | ReturnType<typeof setNodeTimeout>;

const getTimerWindow = (): Window | null => {
  if (typeof window === "undefined") {
    return null;
  }
  return window.activeWindow ?? window;
};

export const scheduleTimeout = (callback: () => void, delayMs: number): TimerHandle => {
  const timerWindow = getTimerWindow();
  if (timerWindow) {
    return timerWindow.setTimeout(callback, delayMs);
  }
  return setNodeTimeout(callback, delayMs);
};

export const cancelTimeout = (handle: TimerHandle): void => {
  const timerWindow = getTimerWindow();
  if (timerWindow && typeof handle === "number") {
    timerWindow.clearTimeout(handle);
    return;
  }
  clearNodeTimeout(handle as ReturnType<typeof setNodeTimeout>);
};
