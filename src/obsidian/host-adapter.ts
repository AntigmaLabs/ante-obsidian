import {
  App,
  Editor,
  FileSystemAdapter,
  MarkdownView,
  Notice,
  TFile,
  TFolder,
  normalizePath
} from "obsidian";
import type { ContextSnapshot, DocumentChangeArtifact } from "../core/types";
import { getArtifactTargetPath } from "../core/artifacts";

export interface HostAdapter {
  getActiveContext(): Promise<ContextSnapshot | null>;
  getPreferredContext(): Promise<ContextSnapshot | null>;
  capturePreferredContext(): Promise<ContextSnapshot | null>;
  readFile(path: string): Promise<string | null>;
  applyDocumentChange(change: DocumentChangeArtifact): Promise<void>;
  revertDocumentChange(change: DocumentChangeArtifact): Promise<void>;
  revealDocumentChange(change: DocumentChangeArtifact): Promise<void>;
}

export class ObsidianHostAdapter implements HostAdapter {
  private lastKnownContext: ContextSnapshot | null = null;

  constructor(private readonly app: App) {}

  async getActiveContext(): Promise<ContextSnapshot | null> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) {
      return this.getOpenMarkdownContext();
    }
    return this.buildContextFromView(view);
  }

  async getPreferredContext(): Promise<ContextSnapshot | null> {
    const active = await this.getActiveContext();
    if (active) {
      return active;
    }

    return this.lastKnownContext;
  }

  async capturePreferredContext(): Promise<ContextSnapshot | null> {
    const context = await this.getPreferredContext();
    if (context) {
      this.lastKnownContext = context;
    }
    return context;
  }

  async readFile(path: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) {
      return null;
    }
    return this.app.vault.cachedRead(file);
  }

  async applyDocumentChange(change: DocumentChangeArtifact): Promise<void> {
    const targetPath = getArtifactTargetPath(change);
    if (change.operation === "create-file") {
      const existing = this.app.vault.getAbstractFileByPath(normalizePath(targetPath));
      if (existing) {
        throw new Error(`File already exists: ${targetPath}`);
      }
      await this.ensureFolderForPath(targetPath);
      await this.app.vault.create(normalizePath(targetPath), change.afterText);
      new Notice(`Created ${targetPath}`);
      return;
    }

    const file = this.requireFile(targetPath);
    await this.app.vault.modify(file, change.afterText);
    new Notice(`Updated ${targetPath}`);
  }

  async revertDocumentChange(change: DocumentChangeArtifact): Promise<void> {
    const targetPath = getArtifactTargetPath(change);
    if (change.operation === "create-file") {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(targetPath));
      if (file instanceof TFile) {
        await this.app.vault.delete(file);
        new Notice(`Removed ${targetPath}`);
      }
      return;
    }

    const file = this.requireFile(targetPath);
    await this.app.vault.modify(file, change.beforeText);
    new Notice(`Reverted ${targetPath}`);
  }

  async revealDocumentChange(change: DocumentChangeArtifact): Promise<void> {
    const targetPath = getArtifactTargetPath(change);
    const file = this.app.vault.getAbstractFileByPath(normalizePath(targetPath));
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
    }
  }

  requireActiveEditor(): Editor {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) {
      throw new Error("Open a Markdown note before running Ante");
    }
    return view.editor;
  }

  private getOpenMarkdownContext(): ContextSnapshot | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file) {
        return this.buildContextFromView(view);
      }
    }
    return this.lastKnownContext;
  }

  private buildContextFromView(view: MarkdownView): ContextSnapshot {
    if (!view.file) {
      throw new Error("Markdown view has no file");
    }
    const startedAt = performance.now();
    const editor = view.editor;
    const selectionText = editor.getSelection();
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const context: ContextSnapshot = {
      vaultPath: this.getVaultPath(),
      filePath: view.file.path,
      noteTitle: view.file.basename,
      documentText: editor.getValue(),
      selection: {
        text: selectionText,
        from,
        to
      }
    };

    this.lastKnownContext = context;
    return context;
  }

  private getVaultPath(): string | null {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
  }

  private requireFile(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) {
      throw new Error(`File not found: ${path}`);
    }
    return file;
  }

  private async ensureFolderForPath(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const parts = normalized.split("/");
    parts.pop();

    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (!existing) {
        await this.app.vault.createFolder(current);
      } else if (!(existing instanceof TFolder)) {
        throw new Error(`A file already exists at ${current}`);
      }
    }
  }
}
