export interface AnteTransport {
  connect(): Promise<void>;
  disconnect(): void;
  send(message: string): void;
  isConnected(): boolean;
  setMessageHandler(handler: (message: string) => void): void;
  setErrorHandler(handler: (error: Error) => void): void;
  setCloseHandler(handler: (info?: { code?: number; reason?: string }) => void): void;
  setDiagnosticHandler(handler: (event: { stream: "stdout" | "stderr"; text: string }) => void): void;
}
