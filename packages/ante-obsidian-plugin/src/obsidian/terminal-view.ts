import { ItemView, Notice, WorkspaceLeaf } from "obsidian"
import type TmdPlugin from "./main"
import type {
  ContextSnapshot,
  RuntimeApprovalDecision,
  TaskRecord,
  TmdState,
} from "../core/types"
import {
  navigatePromptHistory as computePromptHistoryNavigation,
} from "../core/terminal-input"
import { terminalStatus, terminalStatusClass } from "../core/terminal-status"
import {
  resolveArtifactDiffs,
  type ResolvedArtifactDiff,
} from "./diff-block"
import {
  buildApprovalSignature,
  renderApprovalCard,
} from "./approval-card-renderer"
import { renderMissingAnteState } from "./empty-state-renderer"
import { renderArtifactDiffList } from "./artifact-diff-renderer"
import { renderTerminalLayout } from "./terminal-layout-renderer"
import { wireTerminalPrompt } from "./terminal-shell-wiring"
import {
  buildAllRows,
  extractRuntimeSummary,
  summarizeTerminalMeta,
  analyzeOutput,
} from "./terminal-state-analyzer"
import { syncRows } from "./terminal-row-renderer"

export const TMD_TERMINAL_VIEW_TYPE = "tmd-terminal-view"

export class TmdTerminalView extends ItemView {
  private unsubscribe: (() => void) | null = null
  private loadingTimer: number | null = null
  private loadingFrame = 0
  private latestState: TmdState | null = null
  private liveContext: ContextSnapshot | null = null
  private runtimeHelpEl: HTMLDivElement | null = null
  private frameEl!: HTMLDivElement
  private statusEl!: HTMLDivElement
  private metaLineEl!: HTMLDivElement
  private screenEl!: HTMLDivElement
  private streamEl!: HTMLDivElement
  private promptEl!: HTMLDivElement
  private editorEl!: HTMLDivElement
  private approvalEl: HTMLDivElement | null = null
  private approvalSignature = ""
  private inlineArtifactsEl!: HTMLDivElement
  private promptHistory: string[] = []
  private historyIndex: number = -1
  private draftPrompt = ""
  private isComposing = false
  private readonly rowEls = new Map<string, HTMLDivElement>()
  private readonly inlineExpandedArtifactIds = new Set<string>()
  private didInitialFocus = false
  private lastEditable = false
  private inlineResolvedArtifacts: ResolvedArtifactDiff[] = []
  private inlineArtifactSignature = ""
  private inlineResolvedTaskId: string | null = null
  private inlineResolveVersion = 0
  private initialFocusFrame: number | null = null

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: TmdPlugin,
  ) {
    super(leaf)
  }

  getViewType(): string {
    return TMD_TERMINAL_VIEW_TYPE
  }

  getDisplayText(): string {
    return "Ante workspace"
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("tmd-view", "tmd-terminal-view")
    this.buildShell()
    this.initialFocusFrame = window.requestAnimationFrame(() => {
      this.initialFocusFrame = null
      this.editorEl.focus()
      this.moveCaretToEnd()
      this.didInitialFocus = true
    })
    this.liveContext = await this.plugin.hostAdapter.capturePreferredContext()
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        void this.refreshLiveContext()
      }),
    )
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        void this.refreshLiveContext()
      }),
    )
    this.unsubscribe = this.plugin.taskEngine.subscribe((state) => {
      this.latestState = state
      this.syncLoadingTimer(state)
      this.render(state)
    })
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.loadingTimer) {
      window.clearInterval(this.loadingTimer)
      this.loadingTimer = null
    }
    if (this.initialFocusFrame != null) {
      window.cancelAnimationFrame(this.initialFocusFrame)
      this.initialFocusFrame = null
    }
  }

  private buildShell(): void {
    const layout = renderTerminalLayout(this.contentEl)
    this.runtimeHelpEl = layout.runtimeHelpEl
    this.frameEl = layout.frameEl
    this.statusEl = layout.statusEl
    this.metaLineEl = layout.metaLineEl
    this.screenEl = layout.screenEl
    this.streamEl = layout.streamEl
    this.promptEl = layout.promptEl
    this.editorEl = layout.editorEl
    wireTerminalPrompt({
      editorEl: this.editorEl,
      stopButtonEl: layout.stopButtonEl,
      getEditorText: () => this.getEditorText(),
      getIsComposing: () => this.isComposing,
      setIsComposing: (value) => {
        this.isComposing = value
      },
      getHasRunningTask: () =>
        (this.latestState ?? this.plugin.taskEngine.getState()).tasks.some(
          (task) => task.status === "running",
        ),
      onDraftChange: (text) => {
        if (this.historyIndex === -1) {
          this.draftPrompt = text
        }
      },
      onStop: () => {
        this.plugin.taskEngine.cancelActiveTask()
      },
      onSubmit: () => {
        this.runPrompt()
      },
      onNavigateHistory: (direction) => {
        this.navigatePromptHistory(direction)
      },
    })
    this.inlineArtifactsEl = layout.inlineArtifactsEl
  }

  private render(state: TmdState): void {
    const tasks = state.tasks.filter(
      (task) => task.triggerSource === "terminal",
    )
    const latestTask = tasks[0]
    const context =
      this.liveContext ??
      latestTask?.context ??
      state.tasks.find((task) => task.context?.filePath)?.context ??
      null
    const runtimeSummary = extractRuntimeSummary(latestTask)
    const isEditable = !state.tasks.some((task) => task.status === "running")
    const shouldStickToBottom = this.shouldStickToBottom()

    this.statusEl.className = `tmd-terminal-status ${terminalStatusClass(latestTask)}`
    this.statusEl.setText(terminalStatus(latestTask))
    this.metaLineEl.setText(summarizeTerminalMeta(context, runtimeSummary))
    this.syncRuntimeHelp()

    syncRows(
      this.streamEl,
      this.rowEls,
      buildAllRows(
        state,
        this.loadingFrame,
        this.plugin.shouldShowFullProcessLogs(),
      ),
    )
    this.syncPrompt(context, tasks, isEditable)
    this.syncInlineArtifacts(latestTask)
    this.syncApproval(latestTask)

    if (shouldStickToBottom && !this.hasSelectionInScreen()) {
      this.scrollToBottom()
    }
    if (
      (isEditable && !this.lastEditable) ||
      (isEditable && !this.didInitialFocus)
    ) {
      this.editorEl.focus()
      this.didInitialFocus = true
    }
    this.lastEditable = isEditable
  }

  private syncPrompt(
    context: ContextSnapshot | null,
    tasks: TaskRecord[],
    isEditable: boolean,
  ): void {
    this.promptEl.classList.toggle("tmd-is-editable", isEditable)
    this.editorEl.contentEditable = isEditable ? "true" : "false"
    this.editorEl.dataset.placeholder = context?.filePath
      ? `Use ${context.filePath} as Markdown context to plan, write, edit, or run tasks`
      : "Use the current Markdown context to plan, write, edit, or run tasks"
    if (!isEditable) {
      return
    }
    if (tasks.length === 0) {
      this.editorEl.classList.toggle(
        "tmd-is-empty",
        this.getEditorText().length === 0,
      )
    }
  }

  private getEditorText(): string {
    return this.editorEl.innerText.replace(/\n/g, " ").trim()
  }

  private setEditorText(text: string): void {
    this.editorEl.setText(text)
    this.editorEl.classList.toggle("tmd-is-empty", text.trim().length === 0)
    this.moveCaretToEnd()
  }

  private moveCaretToEnd(): void {
    const selection = window.getSelection()
    if (!selection) {
      return
    }
    const range = window.activeDocument.createRange()
    range.selectNodeContents(this.editorEl)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  private navigatePromptHistory(direction: "up" | "down"): void {
    const next = computePromptHistoryNavigation(
      this.promptHistory,
      this.historyIndex,
      this.draftPrompt,
      this.getEditorText(),
      direction,
    )
    this.historyIndex = next.historyIndex
    this.draftPrompt = next.draftPrompt
    if (next.nextText !== this.getEditorText()) {
      this.setEditorText(next.nextText)
    }
  }

  private syncApproval(task: TaskRecord | undefined): void {
    const approval =
      task?.status === "running" ? task.pendingApproval : undefined
    const isFileEditOnlyApproval =
      approval != null &&
      task != null &&
      task.artifacts.length > 0 &&
      approval.tools.length > 0 &&
      approval.tools.every((tool) => {
        const normalized = tool.name.trim().toLowerCase()
        return normalized === "write" || normalized === "edit"
      })
    if (isFileEditOnlyApproval) {
      this.approvalEl?.remove()
      this.approvalEl = null
      this.approvalSignature = ""
      return
    }
    if (!approval || !task) {
      this.approvalEl?.remove()
      this.approvalEl = null
      this.approvalSignature = ""
      return
    }

    const signature = buildApprovalSignature(approval, task.id)
    if (this.approvalEl && this.approvalSignature === signature) {
      return
    }

    this.approvalEl?.remove()

    this.approvalEl = renderApprovalCard(this.frameEl, approval, (decision) => {
      this.respondToApproval(task.id, decision)
    })
    this.approvalSignature = signature
  }

  private runPrompt(): void {
    const promptText = this.getEditorText()
    if (!promptText) {
      return
    }
    if (!this.plugin.ensureAnteInstalled("Ante Terminal")) {
      this.syncRuntimeHelp()
      return
    }
    this.promptHistory = [
      ...this.promptHistory.filter((entry) => entry !== promptText),
      promptText,
    ].slice(-50)
    this.historyIndex = -1
    this.draftPrompt = ""

    const tasks = (
      this.latestState ?? this.plugin.taskEngine.getState()
    ).tasks.filter((task) => task.triggerSource === "terminal")
    void this.plugin.hostAdapter
      .capturePreferredContext()
      .then((contextSnapshot) => {
        this.liveContext = contextSnapshot
        return contextSnapshot
      })
      .then((contextSnapshot) =>
        this.plugin.taskEngine.startTerminalTask(
          promptText,
          Boolean(
            tasks.find((task) => task.runtimeSession?.sessionId)
              ?.runtimeSession,
          ),
          contextSnapshot,
        ),
      )
      .then(() => {
        this.editorEl.empty()
        this.editorEl.classList.add("tmd-is-empty")
        this.draftPrompt = ""
      })
      .catch((error) => {
        new Notice(
          error instanceof Error
            ? error.message
            : "Failed to start Ante terminal task",
        )
      })
  }

  private syncInlineArtifacts(task: TaskRecord | undefined): void {
    if (!task || task.artifacts.length === 0) {
      this.inlineArtifactsEl.empty()
      this.inlineResolvedArtifacts = []
      this.inlineArtifactSignature = ""
      this.inlineResolvedTaskId = task?.id ?? null
      this.inlineExpandedArtifactIds.clear()
      return
    }

    const signature = [
      task.id,
      ...task.artifacts.map(
        (artifact) =>
          `${artifact.id}:${artifact.applyState}:${artifact.applyError ?? ""}`,
      ),
    ].join("|")

    if (this.inlineResolvedTaskId !== task.id) {
      this.inlineExpandedArtifactIds.clear()
    }

    if (
      this.inlineArtifactSignature === signature &&
      this.inlineResolvedTaskId === task.id &&
      this.inlineResolvedArtifacts.length > 0
    ) {
      this.renderInlineArtifacts(task, this.inlineResolvedArtifacts)
      return
    }

    this.inlineArtifactsEl.empty()
    const waiting = this.inlineArtifactsEl.createDiv({
      cls: "tmd-terminal-inline-placeholder",
    })
    waiting.setText("Preparing diff preview...")

    const resolveVersion = ++this.inlineResolveVersion
    void resolveArtifactDiffs(task).then((resolvedArtifacts) => {
      if (resolveVersion !== this.inlineResolveVersion) {
        return
      }
      this.inlineResolvedArtifacts = resolvedArtifacts
      this.inlineArtifactSignature = signature
      this.inlineResolvedTaskId = task.id
      this.renderInlineArtifacts(task, resolvedArtifacts)
    })
  }

  private renderInlineArtifacts(
    task: TaskRecord,
    resolvedArtifacts: ResolvedArtifactDiff[],
  ): void {
    this.inlineArtifactsEl.empty()
    renderArtifactDiffList(this.inlineArtifactsEl, {
      plugin: this.plugin,
      task,
      resolvedArtifacts,
      expandedArtifactIds: this.inlineExpandedArtifactIds,
      onApplyAll: () => this.plugin.taskEngine.applyAllArtifacts(task.id),
      onApplyAllError: "Failed to apply all changes",
      onToggleExpanded: (artifactId) => {
        if (this.inlineExpandedArtifactIds.has(artifactId)) {
          this.inlineExpandedArtifactIds.delete(artifactId)
        } else {
          this.inlineExpandedArtifactIds.add(artifactId)
        }
        this.renderInlineArtifacts(task, this.inlineResolvedArtifacts)
      },
    })
  }

  private syncLoadingTimer(state: TmdState): void {
    const terminalTasks = state.tasks.filter(
      (task) => task.triggerSource === "terminal",
    )
    const shouldAnimate = terminalTasks
      .filter((task) => task.status === "running")
      .some(
        (task) =>
          !analyzeOutput(task, this.plugin.shouldShowFullProcessLogs()).text &&
          !task.pendingApproval,
      )

    if (shouldAnimate && this.loadingTimer == null) {
      this.loadingTimer = window.setInterval(() => {
        this.loadingFrame += 1
        if (this.latestState) {
          this.render(this.latestState)
        }
      }, 500)
      return
    }

    if (!shouldAnimate && this.loadingTimer != null) {
      window.clearInterval(this.loadingTimer)
      this.loadingTimer = null
      this.loadingFrame = 0
    }
  }

  private shouldStickToBottom(): boolean {
    const threshold = 24
    return (
      this.screenEl.scrollTop + this.screenEl.clientHeight >=
      this.screenEl.scrollHeight - threshold
    )
  }

  private hasSelectionInScreen(): boolean {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return false
    }
    const anchorNode = selection.anchorNode
    const focusNode = selection.focusNode
    return Boolean(
      (anchorNode && this.screenEl.contains(anchorNode)) ||
      (focusNode && this.screenEl.contains(focusNode)),
    )
  }

  private scrollToBottom(): void {
    this.screenEl.scrollTop = this.screenEl.scrollHeight
  }

  private async refreshLiveContext(): Promise<void> {
    this.liveContext = await this.plugin.hostAdapter.capturePreferredContext()
    if (this.latestState) {
      this.render(this.latestState)
      return
    }
    this.metaLineEl.setText(summarizeTerminalMeta(this.liveContext, null))
    this.editorEl.dataset.placeholder = this.liveContext?.filePath
      ? `Use ${this.liveContext.filePath} as Markdown context to plan, write, edit, or run tasks`
      : "Use the current Markdown context to plan, write, edit, or run tasks"
  }

  private syncRuntimeHelp(): void {
    const helpEl = this.runtimeHelpEl
    if (!helpEl) {
      return
    }
    if (this.plugin.isAnteInstalled()) {
      helpEl.empty()
      helpEl.hide()
      return
    }

    helpEl.empty()
    helpEl.show()
    renderMissingAnteState(helpEl, {
      title: "Ante CLI is missing",
      description:
        "Open Ante Obsidian Settings to install Ante, then refresh CLI detection here.",
      onOpenSettings: () => this.plugin.openPluginSettings(),
      onRefresh: () =>
        this.plugin.refreshAnteEnvironment().then(() => {
          this.syncRuntimeHelp()
        }),
    })
  }

  private respondToApproval(
    taskId: string,
    decision: RuntimeApprovalDecision,
  ): void {
    try {
      this.plugin.taskEngine.respondToTaskApproval(taskId, decision)
    } catch (error) {
      new Notice(
        error instanceof Error ? error.message : "Failed to send Ante approval",
      )
    }
  }
}
