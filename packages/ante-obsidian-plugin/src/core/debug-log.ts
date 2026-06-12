let debugLoggingEnabled = false;

export const setDebugLogging = (enabled: boolean): void => {
  debugLoggingEnabled = enabled;
};

export const isDebugLoggingEnabled = (): boolean => debugLoggingEnabled;

export const logDebug = (...args: unknown[]): void => {
  if (debugLoggingEnabled) {
    console.debug("[ante]", ...args);
  }
};
