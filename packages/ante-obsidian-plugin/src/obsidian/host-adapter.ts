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
import { readFile as readFsFile } from "node:fs/promises";
import type { HostAdapter } from "../core/host-adapter";
import type { ContextSnapshot, DocumentChangeArtifact } from "../core/types";
import { getArtifactTargetPath } from "../core/artifacts";

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
    const file = this.getFile(path);
    if (!(file instanceof TFile)) {
      return null;
    }
    return this.app.vault.cachedRead(file);
  }

  async applyDocumentChange(change: DocumentChangeArtifact): Promise<void> {
    const targetPath = getArtifactTargetPath(change);
    const nextText = change.stagedPath ? await readFsFile(change.stagedPath, "utf8") : change.afterText;
    if (change.operation === "create-file") {
      const relativePath = this.requireVaultPath(targetPath);
      const existing = this.app.vault.getAbstractFileByPath(relativePath);
      if (existing) {
        throw new Error(`File already exists: ${targetPath}`);
      }
      await this.ensureFolderForPath(relativePath);
      await this.app.vault.create(relativePath, nextText);
      new Notice(`Created ${targetPath}`);
      return;
    }

    const file = this.requireFile(targetPath);
    await this.app.vault.modify(file, nextText);
    new Notice(`Updated ${targetPath}`);
  }

  async revertDocumentChange(change: DocumentChangeArtifact): Promise<void> {
    const targetPath = getArtifactTargetPath(change);
    if (change.operation === "create-file") {
      const file = this.getFile(targetPath);
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
    const file = this.getFile(targetPath);
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

  private getFile(path: string): TFile | null {
    const relativePath = this.toVaultRelativePath(path);
    if (relativePath) {
      const direct = this.app.vault.getAbstractFileByPath(relativePath);
      if (direct instanceof TFile) {
        return direct;
      }
    }

    const normalizedInput = this.normalizeLookupPath(path);
    if (!normalizedInput) {
      return null;
    }

    const vaultPath = this.getVaultPath();
    const normalizedVaultPath = vaultPath ? this.normalizeLookupPath(vaultPath) : null;

    for (const file of this.app.vault.getFiles()) {
      const relativeCandidate = this.normalizeLookupPath(file.path);
      if (relativeCandidate === normalizedInput) {
        return file;
      }

      if (normalizedInput.endsWith(`/${relativeCandidate}`) || normalizedInput === relativeCandidate) {
        return file;
      }

      if (normalizedVaultPath) {
        const absoluteCandidate = this.normalizeLookupPath(`${normalizedVaultPath}/${file.path}`);
        if (absoluteCandidate === normalizedInput) {
          return file;
        }
      }
    }

    return null;
  }

  private requireFile(path: string): TFile {
    const file = this.getFile(path);
    if (!file) {
      throw new Error(`File not found: ${path}`);
    }
    return file;
  }

  private requireVaultPath(path: string): string {
    const relativePath = this.toVaultRelativePath(path);
    if (!relativePath) {
      throw new Error(`Path is outside the current vault: ${path}`);
    }
    return relativePath;
  }

  private toVaultRelativePath(path: string): string | null {
    const normalizedPath = this.normalizeLookupPath(path);
    if (!normalizedPath) {
      return null;
    }
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const vaultPath = this.getVaultPath();
    if (!vaultPath) {
      return null;
    }

    const normalizedVaultPath = this.normalizeLookupPath(vaultPath);
    if (normalizedPath === normalizedVaultPath) {
      return "";
    }
    if (!normalizedPath.startsWith(`${normalizedVaultPath}/`)) {
      return null;
    }

    return normalizedPath.slice(normalizedVaultPath.length + 1);
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

  private normalizeLookupPath(path: string): string {
    return normalizePath(path.trim()).normalize("NFC");
  }
}
