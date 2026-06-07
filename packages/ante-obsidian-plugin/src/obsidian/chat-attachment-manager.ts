import { Notice, setIcon } from "obsidian"
import {
  logAttachmentDebug,
  getElectronDialog,
  getElectronWebUtils,
  getAttachmentFileName,
  formatAttachmentLabel,
} from "./chat-view-helpers"

export class ChatAttachmentManager {
  private selectedAttachmentPaths: string[] = []
  private isAttachmentDragActive = false

  constructor(
    private readonly fileInputEl: HTMLInputElement,
    private readonly attachmentListEl: HTMLDivElement,
    private readonly composerContainerEl: HTMLDivElement,
    private readonly attachmentButtonEl: HTMLButtonElement,
    private readonly syncComposerOffset: () => void,
    private readonly syncComposerActionButton: () => void,
    private readonly hasRunningChatTask: () => boolean,
  ) {}

  initialize(): void {
    this.fileInputEl.addEventListener("change", () => {
      logAttachmentDebug("file input change fired", {
        fileCount: this.fileInputEl.files?.length ?? 0,
        inputValue: this.fileInputEl.value,
      })
      this.captureSelectedAttachments()
    })

    this.attachmentButtonEl.addEventListener("click", () => {
      logAttachmentDebug("attachment button clicked")
      void this.openAttachmentPicker()
    })

    this.composerContainerEl.addEventListener("dragover", (event) => {
      if (!isCrossWindowInstance(event, DragEvent)) {
        return
      }
      if (!event.dataTransfer?.files?.length) {
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = "copy"
      if (!this.isAttachmentDragActive) {
        this.isAttachmentDragActive = true
        this.syncAttachmentDropState()
      }
    })

    this.composerContainerEl.addEventListener("dragleave", (event) => {
      if (!isCrossWindowInstance(event, DragEvent)) {
        return
      }
      const relatedTarget = event.relatedTarget
      if (
        isCrossWindowInstance(relatedTarget, Node) &&
        this.composerContainerEl.contains(relatedTarget)
      ) {
        return
      }
      this.isAttachmentDragActive = false
      this.syncAttachmentDropState()
    })

    this.composerContainerEl.addEventListener("drop", (event) => {
      if (!isCrossWindowInstance(event, DragEvent)) {
        return
      }
      event.preventDefault()
      this.isAttachmentDragActive = false
      this.syncAttachmentDropState()
      const files = event.dataTransfer?.files
      logAttachmentDebug("attachment files dropped", {
        fileCount: files?.length ?? 0,
      })
      if (!files?.length) {
        return
      }
      const paths = this.extractFilePaths(files)
      if (paths.length === 0) {
        logAttachmentDebug("no attachment paths extracted from drop")
        return
      }
      this.applySelectedAttachmentPaths(paths)
    })
  }

  getSelectedAttachmentPaths(): string[] {
    return this.selectedAttachmentPaths
  }

  captureSelectedAttachments(): void {
    logAttachmentDebug("capturing selected attachments")
    const nextPaths = this.extractSelectedFilePaths()
    if (nextPaths.length === 0) {
      logAttachmentDebug("no attachment paths extracted")
      return
    }
    this.applySelectedAttachmentPaths(nextPaths)
  }

  async openAttachmentPicker(): Promise<void> {
    const { dialog, source } = getElectronDialog()
    if (!dialog) {
      logAttachmentDebug(
        "native electron dialog unavailable, falling back to input[type=file]",
      )
      this.fileInputEl.click()
      return
    }

    logAttachmentDebug("opening native attachment picker", {
      source,
    })

    try {
      const result = await dialog.showOpenDialog({
        title: "Select files for Ante",
        buttonLabel: "Attach",
        properties: ["openFile", "multiSelections"],
      })
      logAttachmentDebug("native attachment picker resolved", {
        source,
        canceled: result.canceled,
        fileCount: result.filePaths.length,
        filePaths: result.filePaths,
      })
      if (result.canceled || result.filePaths.length === 0) {
        return
      }
      this.applySelectedAttachmentPaths(result.filePaths)
    } catch (error) {
      console.error(
        "[tmd chat attachments]",
        "native attachment picker failed",
        error,
      )
      new Notice(
        error instanceof Error
          ? error.message
          : "Failed to open native file picker",
      )
    }
  }

  applySelectedAttachmentPaths(filePaths: string[]): void {
    const dedupedPaths = filePaths
      .map((filePath) => filePath.trim())
      .filter(Boolean)
    if (dedupedPaths.length === 0) {
      logAttachmentDebug("applySelectedAttachmentPaths received no usable paths")
      return
    }
    this.selectedAttachmentPaths = [
      ...this.selectedAttachmentPaths,
      ...dedupedPaths,
    ].filter((value, index, values) => values.indexOf(value) === index)
    logAttachmentDebug("attachment paths applied", {
      addedCount: dedupedPaths.length,
      totalCount: this.selectedAttachmentPaths.length,
      paths: this.selectedAttachmentPaths,
    })
    this.fileInputEl.value = ""
    this.syncAttachmentList()
    this.syncComposerActionButton()
  }

  extractSelectedFilePaths(): string[] {
    const files = this.fileInputEl.files
    if (!files || files.length === 0) {
      logAttachmentDebug("extractSelectedFilePaths found no files on input")
      return []
    }

    return this.extractFilePaths(files)
  }

  extractFilePaths(files: FileList | File[]): string[] {
    const fileEntries = Array.from(files)
    const { webUtils, source: webUtilsSource } = getElectronWebUtils()

    logAttachmentDebug("extracting file paths", {
      fileCount: fileEntries.length,
      webUtilsSource,
      files: fileEntries.map((file) => {
        const candidate = file as File & {
          path?: string
          webkitRelativePath?: string
        }
        return {
          name: file.name,
          size: file.size,
          type: file.type,
          path: candidate.path ?? null,
          webkitRelativePath: candidate.webkitRelativePath ?? null,
        }
      }),
    })

    const paths: string[] = []
    for (const file of fileEntries) {
      const webUtilsPath = webUtils?.getPathForFile(file)?.trim()
      if (webUtilsPath) {
        paths.push(webUtilsPath)
        continue
      }
      const candidate = (
        file as File & { path?: string; webkitRelativePath?: string }
      ).path?.trim()
      if (candidate) {
        paths.push(candidate)
        continue
      }
      const relativePath = file.webkitRelativePath?.trim()
      if (relativePath) {
        paths.push(relativePath)
      }
    }

    logAttachmentDebug("extracted attachment paths", {
      count: paths.length,
      paths,
    })

    if (paths.length === 0) {
      new Notice(
        "This environment could not read local file paths from the selected files.",
      )
      console.warn(
        "[tmd chat attachments]",
        "selected files did not expose a readable local path",
        fileEntries.map((file) => {
          const candidate = file as File & {
            path?: string
            webkitRelativePath?: string
          }
          return {
            name: file.name,
            size: file.size,
            type: file.type,
            path: candidate.path ?? null,
            webkitRelativePath: candidate.webkitRelativePath ?? null,
          }
        }),
      )
    }

    return paths
  }

  clearSelectedAttachments(): void {
    logAttachmentDebug("clearing selected attachments", {
      previousCount: this.selectedAttachmentPaths.length,
    })
    this.selectedAttachmentPaths = []
    this.fileInputEl.value = ""
    this.syncAttachmentList()
  }

  syncAttachmentList(): void {
    if (!this.attachmentListEl) {
      return
    }
    this.attachmentListEl.empty()
    const useCompactAttachmentList = this.selectedAttachmentPaths.length > 2
    const visibleAttachmentPaths = useCompactAttachmentList
      ? this.selectedAttachmentPaths.slice(0, 2)
      : this.selectedAttachmentPaths
    const hiddenAttachmentPaths = useCompactAttachmentList
      ? this.selectedAttachmentPaths.slice(2)
      : []
    this.attachmentListEl.classList.toggle(
      "tmd-has-attachments",
      this.selectedAttachmentPaths.length > 0,
    )
    this.attachmentListEl.classList.toggle(
      "tmd-is-compact",
      useCompactAttachmentList,
    )
    if (this.selectedAttachmentPaths.length === 0) {
      this.syncComposerOffset()
      return
    }

    for (const filePath of visibleAttachmentPaths) {
      const fileName = getAttachmentFileName(filePath)
      const chipEl = this.attachmentListEl.createDiv({
        cls: "tmd-chat-attachment-chip",
      })
      if (useCompactAttachmentList) {
        const iconEl = chipEl.createSpan({
          cls: "tmd-chat-attachment-icon",
        })
        iconEl.setAttribute("title", fileName)
        setIcon(iconEl, "file")
      } else {
        const labelEl = chipEl.createSpan({
          cls: "tmd-chat-attachment-label",
          text: formatAttachmentLabel(filePath),
        })
        labelEl.setAttribute("title", fileName)
      }
      const removeButtonEl = chipEl.createEl("button", {
        cls: "tmd-chat-attachment-remove",
      })
      removeButtonEl.setAttribute("aria-label", `Remove ${fileName}`)
      removeButtonEl.setAttribute("title", `Remove ${fileName}`)
      setIcon(removeButtonEl, "x")
      removeButtonEl.addEventListener("click", () => {
        logAttachmentDebug("removing attachment path", { filePath })
        this.selectedAttachmentPaths = this.selectedAttachmentPaths.filter(
          (candidate) => candidate !== filePath,
        )
        this.syncAttachmentList()
        this.syncComposerActionButton()
      })
    }

    if (hiddenAttachmentPaths.length > 0) {
      const summaryEl = this.attachmentListEl.createDiv({
        cls: "tmd-chat-attachment-chip tmd-chat-attachment-summary",
        text: `+${hiddenAttachmentPaths.length}`,
      })
      summaryEl.setAttribute(
        "title",
        hiddenAttachmentPaths.map((filePath) => getAttachmentFileName(filePath)).join("\n"),
      )
    }

    this.syncComposerOffset()
  }

  syncAttachmentDropState(): void {
    this.composerContainerEl?.classList.toggle(
      "tmd-is-attachment-dragover",
      this.isAttachmentDragActive,
    )
  }
}

const isCrossWindowInstance = <T>(
  value: unknown,
  type: abstract new (...args: never[]) => T,
): value is T => {
  const candidate = value as { instanceOf?: (target: abstract new (...args: never[]) => T) => boolean } | null
  if (candidate?.instanceOf) {
    return candidate.instanceOf(type)
  }
  return value instanceof type
}
