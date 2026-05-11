import type { ContextSnapshot, DocumentChangeArtifact } from "./types";

export interface HostAdapter {
  getActiveContext(): Promise<ContextSnapshot | null>;
  getPreferredContext(): Promise<ContextSnapshot | null>;
  capturePreferredContext(): Promise<ContextSnapshot | null>;
  readFile(path: string): Promise<string | null>;
  applyDocumentChange(change: DocumentChangeArtifact): Promise<void>;
  revertDocumentChange(change: DocumentChangeArtifact): Promise<void>;
  revealDocumentChange(change: DocumentChangeArtifact): Promise<void>;
}
