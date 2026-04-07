import {
  Component,
  ItemView,
  MarkdownRenderer,
  Notice,
  WorkspaceLeaf,
  setIcon,
} from "obsidian"
import type TmdPlugin from "./main"
import type {
  ChatConversationRecord,
  ChatMessageRecord,
  ChatStateSnapshot,
} from "../core/chat-types"
import type {
  ContextSnapshot,
  LogEntry,
  RuntimeApprovalDecision,
  RuntimeProcessLane,
  RuntimeTelemetryState,
  TaskRecord,
  TmdState,
} from "../core/types"
import {
  resolveArtifactDiffs,
  resolveArtifactsToDiffs,
  type ResolvedArtifactDiff,
} from "./diff-block"
import { formatLoadingLabel } from "../core/loading-label"
import {
  buildApprovalSignature,
  renderApprovalCard,
} from "./approval-card-renderer"
import {
  renderRuntimeDetails,
  buildRuntimeDetailsSections,
  shouldAutoExpandRuntimeDetails,
} from "./runtime-details-renderer"
import {
  renderMissingAnteState,
  renderSimpleEmptyState,
} from "./empty-state-renderer"
import { renderArtifactDiffList } from "./artifact-diff-renderer"
import { renderChatLayout } from "./chat-layout-renderer"
import {
  wireChatComposer,
  wireChatSidebar,
} from "./chat-shell-wiring"

export const TMD_CHAT_VIEW_TYPE = "tmd-chat-view"

const MAX_CHAT_PREVIEW_CHARS = 12000
const MAX_CHAT_PREVIEW_LINES = 160
const MESSAGE_WINDOW_SIZE = 80
const hashText = (value: string): string => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const clampPreview = (value: string): string => {
  const normalized = value.replace(/\r/g, "")
  if (!normalized) {
    return ""
  }

  const lines = normalized.split("\n")
  const tailLines =
    lines.length > MAX_CHAT_PREVIEW_LINES
      ? lines.slice(-MAX_CHAT_PREVIEW_LINES)
      : lines
  let preview = tailLines.join("\n")

  if (preview.length > MAX_CHAT_PREVIEW_CHARS) {
    preview = preview.slice(-MAX_CHAT_PREVIEW_CHARS)
  }

  if (preview !== normalized) {
    const omittedChars = Math.max(0, normalized.length - preview.length)
    const omittedLines = Math.max(0, lines.length - tailLines.length)
    preview = `... truncated preview (${omittedLines} lines, ${omittedChars} chars omitted) ...\n${preview}`
  }

  return preview.trim()
}

const summarizeContext = (context: ContextSnapshot | null): string => {
  if (!context?.filePath) {
    return "No note context"
  }

  const selection = context.selection?.text?.trim()
  if (selection) {
    return `${context.filePath} · selection ${selection.length} chars`
  }

  const documentText = context.documentText?.trim() ?? ""
  return `${context.filePath} · note ${documentText.length} chars`
}

const formatTime = (timestamp: string): string =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })

const loadingLabelForMessage = (
  message: ChatMessageRecord,
  loadingFrame: number,
): string => {
  if (!message.turn?.runtimeSessionId) {
    return "preparing session"
  }
  return formatLoadingLabel(message.id, loadingFrame)
}

const buildProcessStatusLines = (
  process: RuntimeProcessLane | undefined,
): string[] => {
  if (!process) {
    return []
  }

  const lines: string[] = []
  const activeStep =
    process.steps.find((step) => step.status === "in_progress") ??
    process.steps.find((step) => step.status === "pending")

  lines.push(
    `out ${activeStep?.activeLabel ?? activeStep?.label ?? process.label}`,
  )

  for (const step of process.steps) {
    lines.push(
      `out ${step.status === "completed" ? "■" : step.status === "in_progress" ? "▪" : "□"} ${
        step.status === "in_progress"
          ? (step.activeLabel ?? step.label)
          : step.label
      }`,
    )
  }

  if (
    process.steps.length === 0 &&
    process.label !== lines[0]?.replace(/^out /, "")
  ) {
    lines.push(`out ${process.phase} · ${process.label}`)
  }

  return lines
}

const MAX_CHAT_PROCESS_LOG_LINES = 24

const buildRuntimeLogLines = (
  logs: LogEntry[],
  showFullProcessLogs: boolean,
): string[] => {
  if (!showFullProcessLogs || logs.length === 0) {
    return []
  }

  const visibleLogs = logs
    .filter(
      (log) =>
        log.stream === "stderr" ||
        (log.stream === "system" && /^Ante\b/.test(log.text)),
    )
    .slice(-MAX_CHAT_PROCESS_LOG_LINES)

  return visibleLogs.map(
    (log) => `${log.stream === "stderr" ? "err" : "sys"} ${log.text}`,
  )
}

interface ChatContextElements {
  titleEl: HTMLDivElement
  valueEl: HTMLDivElement
  snippetEl: HTMLDivElement | null
}

interface ChatMessageElements {
  rootEl: HTMLDivElement
  stackEl: HTMLDivElement
  bubbleEl: HTMLDivElement
  metaEl: HTMLDivElement
  roleEl: HTMLDivElement
  footerEl: HTMLDivElement
  stampEl: HTMLDivElement
  textEl: HTMLElement | null
  textValue: string | null
  textMode: "plain" | "markdown" | null
  textRenderToken: number
  textComponent: Component | null
  loadingEl: HTMLDivElement | null
  loadingValue: string | null
  processEl: HTMLDivElement | null
  processValue: string | null
  artifactsHostEl: HTMLDivElement | null
  artifactsValue: string | null
  approvalHostEl: HTMLDivElement | null
  approvalValue: string | null
  runtimeDetailsHostEl: HTMLDivElement | null
  runtimeDetailsValue: string | null
  errorEl: HTMLDivElement | null
  errorValue: string | null
}

export class TmdChatView extends ItemView {
  private unsubscribeTaskState: (() => void) | null = null
  private unsubscribeChatState: (() => void) | null = null
  private loadingTimer: number | null = null
  private loadingFrame = 0
  private latestTaskState: TmdState | null = null
  private latestChatState: ChatStateSnapshot | null = null
  private liveContext: ContextSnapshot | null = null
  private visibleMessageCount = MESSAGE_WINDOW_SIZE
  private readonly expandedArtifactIds = new Set<string>()
  private readonly autoExpandedArtifactGroups = new Set<string>()
  private readonly resolvedArtifactsCache = new Map<
    string,
    { signature: string; diffs: ResolvedArtifactDiff[] }
  >()
  private readonly sidebarRowEls = new Map<string, HTMLDivElement>()
  private readonly messageEls = new Map<string, ChatMessageElements>()
  private readonly messageOrder = new Set<string>()
  private readonly messageStatusById = new Map<
    string,
    ChatMessageRecord["status"]
  >()
  private sidebarEl!: HTMLDivElement
  private sidebarHeaderEl!: HTMLDivElement
  private sidebarToggleEl!: HTMLButtonElement
  private newChatButtonEl!: HTMLButtonElement
  private headerActionsEl!: HTMLDivElement
  private contextEl!: HTMLDivElement
  private contextNodes: ChatContextElements | null = null
  private shellEl!: HTMLDivElement
  private conversationListEl!: HTMLDivElement
  private timelineEl!: HTMLDivElement
  private emptyStateEl: HTMLDivElement | null = null
  private composerActionButtonEl!: HTMLButtonElement
  private composerEl!: HTMLTextAreaElement
  private composerContainerEl!: HTMLDivElement
  private composerResizeObserver: ResizeObserver | null = null
  private loadMoreButtonEl: HTMLButtonElement | null = null
  private lastRenderedConversationId: string | null = null
  private shouldAutoScrollToBottom = true
  private isComposing = false
  private isSidebarCollapsed = true

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: TmdPlugin,
  ) {
    super(leaf)
  }

  getViewType(): string {
    return TMD_CHAT_VIEW_TYPE
  }

  getDisplayText(): string {
    return "Chat with Ante"
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("tmd-view", "tmd-chat-view")
    this.buildShell()
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
    this.unsubscribeTaskState = this.plugin.taskEngine.subscribe((state) => {
      this.latestTaskState = state
      this.syncLoadingTimer()
      void this.render()
    })
    this.unsubscribeChatState = this.plugin.chatManager.subscribe((state) => {
      const previousActiveId = this.latestChatState?.activeConversationId
      this.latestChatState = state
      if (previousActiveId !== state.activeConversationId) {
        this.visibleMessageCount = MESSAGE_WINDOW_SIZE
      }
      this.syncLoadingTimer()
      void this.render()
    })
  }

  async onClose(): Promise<void> {
    await this.plugin.persistIdleAnteSession().catch(() => {})
    this.unsubscribeTaskState?.()
    this.unsubscribeTaskState = null
    this.unsubscribeChatState?.()
    this.unsubscribeChatState = null
    this.composerResizeObserver?.disconnect()
    this.composerResizeObserver = null
    if (this.loadingTimer != null) {
      window.clearInterval(this.loadingTimer)
      this.loadingTimer = null
      this.loadingFrame = 0
    }
  }

  private buildShell(): void {
    const layout = renderChatLayout(this.contentEl)
    this.shellEl = layout.shellEl
    this.sidebarEl = layout.sidebarEl
    this.sidebarHeaderEl = layout.sidebarHeaderEl
    this.sidebarToggleEl = layout.sidebarToggleEl
    setIcon(this.sidebarToggleEl, "menu")

    this.newChatButtonEl = layout.newChatButtonEl
    setIcon(layout.newChatIconEl, "square-pen")
    this.newChatButtonEl.prepend(layout.newChatIconEl)
    wireChatSidebar({
      sidebarToggleEl: this.sidebarToggleEl,
      newChatButtonEl: this.newChatButtonEl,
      onToggleSidebar: () => {
        this.isSidebarCollapsed = !this.isSidebarCollapsed
        this.syncSidebarCollapsedState()
      },
      onCreateChat: () => {
        void this.plugin
          .createChatConversation(this.liveContext)
          .catch((error) => {
            new Notice(error instanceof Error ? error.message : String(error))
          })
      },
    })
    this.conversationListEl = layout.conversationListEl

    this.headerActionsEl = layout.headerActionsEl
    this.contextEl = layout.contextEl
    this.contextNodes = {
      titleEl: layout.contextTitleEl,
      valueEl: layout.contextValueEl,
      snippetEl: null,
    }
    this.contextNodes.titleEl.setText("Current context")

    this.timelineEl = layout.timelineEl
    this.composerContainerEl = layout.composerContainerEl
    this.composerEl = layout.composerEl
    this.composerEl.placeholder =
      "Ask about the current note, rewrite a selection, or plan the next edit."
    this.composerActionButtonEl = layout.composerActionButtonEl
    wireChatComposer({
      composerEl: this.composerEl,
      composerActionButtonEl: this.composerActionButtonEl,
      getIsComposing: () => this.isComposing,
      setIsComposing: (value) => {
        this.isComposing = value
      },
      onInput: () => {
        this.syncComposerActionButton(this.hasRunningChatTask())
      },
      onSubmit: () => {
        this.runPrompt()
      },
      onStop: () => {
        this.plugin.taskEngine.cancelActiveTask()
      },
    })
    this.syncComposerActionButton(false)
    this.composerResizeObserver?.disconnect()
    this.composerResizeObserver = new ResizeObserver(() => {
      this.syncComposerOffset()
    })
    this.composerResizeObserver.observe(this.composerContainerEl)
    this.syncComposerOffset()
    this.syncSidebarCollapsedState()
  }

  private syncSidebarCollapsedState(): void {
    this.shellEl.classList.toggle(
      "tmd-chat-sidebar-collapsed",
      this.isSidebarCollapsed,
    )
    this.sidebarEl.classList.toggle("tmd-is-collapsed", this.isSidebarCollapsed)
    if (!this.headerActionsEl || !this.sidebarHeaderEl) {
      return
    }
    if (this.isSidebarCollapsed) {
      if (this.headerActionsEl.firstChild !== this.sidebarToggleEl) {
        this.headerActionsEl.prepend(this.sidebarToggleEl)
      }
      if (this.headerActionsEl.lastChild !== this.newChatButtonEl) {
        this.headerActionsEl.append(this.newChatButtonEl)
      }
    } else if (this.sidebarHeaderEl.firstChild !== this.sidebarToggleEl) {
      this.sidebarHeaderEl.insertBefore(
        this.sidebarToggleEl,
        this.sidebarHeaderEl.firstChild,
      )
      if (this.sidebarHeaderEl.lastChild !== this.newChatButtonEl) {
        this.sidebarHeaderEl.append(this.newChatButtonEl)
      }
    }
    this.syncComposerOffset()
    this.sidebarToggleEl.setAttribute(
      "aria-label",
      this.isSidebarCollapsed ? "Expand chat list" : "Collapse chat list",
    )
    this.sidebarToggleEl.setAttribute(
      "title",
      this.isSidebarCollapsed ? "Expand chat list" : "Collapse chat list",
    )
    this.sidebarToggleEl.setAttribute(
      "aria-expanded",
      String(!this.isSidebarCollapsed),
    )
  }

  private async refreshLiveContext(): Promise<void> {
    this.liveContext = await this.plugin.hostAdapter.capturePreferredContext()
    this.syncComposerOffset()
    void this.render()
  }

  private syncComposerOffset(): void {
    if (!this.shellEl || !this.composerContainerEl) {
      return
    }
    const height = Math.ceil(this.composerContainerEl.getBoundingClientRect().height)
    this.shellEl.style.setProperty("--tmd-chat-composer-offset", `${height}px`)
  }

  private async render(): Promise<void> {
    const chatState = this.latestChatState
    if (!chatState) {
      return
    }
    const activeConversation = this.getActiveConversation(chatState)
    const activeConversationId = activeConversation?.id ?? null
    const shouldStickToBottom = this.shouldStickToBottom()
    const shouldForceScrollToBottom =
      this.shouldAutoScrollToBottom ||
      (activeConversationId !== null &&
        activeConversationId !== this.lastRenderedConversationId)
    const messages = activeConversation
      ? (chatState.messagesByConversation[activeConversation.id] ?? [])
      : []
    const completedMessageToFocusId = this.getCompletedMessageToFocus(messages)
    const visibleMessages = messages.slice(-this.visibleMessageCount)
    const visibleTaskIds = visibleMessages
      .map((message) => message.turn?.taskId)
      .filter((taskId): taskId is string => Boolean(taskId))
    const taskLookup = new Map<string, TaskRecord>()
    for (const task of this.latestTaskState?.tasks ?? []) {
      taskLookup.set(task.id, task)
    }

    const diffsByTask = new Map<string, ResolvedArtifactDiff[]>()
    await Promise.all(
      visibleMessages.map(async (message) => {
        const taskId = message.turn?.taskId
        if (!taskId) {
          return
        }
        const task = taskLookup.get(taskId)
        const artifacts = task?.artifacts.length
          ? task.artifacts
          : (message.runtime?.artifacts ?? []).filter(
              (artifact) => artifact.applyState !== "discarded",
            )
        if (artifacts.length === 0) {
          return
        }
        const signature = this.buildArtifactResolutionSignature(
          artifacts,
          taskId,
        )
        const cached = this.resolvedArtifactsCache.get(taskId)
        if (cached?.signature === signature) {
          diffsByTask.set(taskId, cached.diffs)
          return
        }
        const diffs = task
          ? await resolveArtifactDiffs(task)
          : await resolveArtifactsToDiffs(artifacts)
        this.resolvedArtifactsCache.set(taskId, { signature, diffs })
        diffsByTask.set(taskId, diffs)
      }),
    )

    this.syncConversationSidebar(chatState, activeConversation?.id ?? null)
    this.syncContext(this.liveContext)
    const hasRunningTask = this.hasRunningChatTask()
    this.syncComposerActionButton(hasRunningTask)

    if (!activeConversation || messages.length === 0) {
      this.syncLoadMore(null, 0)
      this.syncEmptyState(true)
      this.pruneMessageEls([])
      this.lastRenderedConversationId = activeConversationId
      return
    }

    this.syncEmptyState(false)
    this.syncLoadMore(
      activeConversation.id,
      messages.length - visibleMessages.length,
    )
    this.syncMessages(visibleMessages, taskLookup, diffsByTask)
    this.syncMessageStatuses(visibleMessages)
    this.pruneResolvedArtifactCache(visibleTaskIds)
    this.lastRenderedConversationId = activeConversationId
    if (
      completedMessageToFocusId &&
      visibleMessages.some(
        (message) => message.id === completedMessageToFocusId,
      )
    ) {
      this.scrollMessageToTop(completedMessageToFocusId)
      this.shouldAutoScrollToBottom = false
      return
    }
    if (shouldForceScrollToBottom || shouldStickToBottom) {
      this.scrollToBottom()
      this.shouldAutoScrollToBottom = false
    }
  }

  private syncConversationSidebar(
    chatState: ChatStateSnapshot,
    activeConversationId: string | null,
  ): void {
    const nextIds = new Set(
      chatState.conversations.map((conversation) => conversation.id),
    )
    for (const [conversationId, rowEl] of [...this.sidebarRowEls.entries()]) {
      if (nextIds.has(conversationId)) {
        continue
      }
      rowEl.remove()
      this.sidebarRowEls.delete(conversationId)
    }

    let previousEl: HTMLElement | null = null
    for (const conversation of chatState.conversations) {
      let rowEl = this.sidebarRowEls.get(conversation.id)
      if (!rowEl) {
        rowEl = this.conversationListEl.createDiv({
          cls: "tmd-chat-conversation",
        })
        rowEl.tabIndex = 0
        rowEl.setAttribute("role", "button")
        rowEl.addEventListener("click", () => {
          void this.plugin
            .activateChatConversation(conversation.id)
            .catch((error) => {
              new Notice(error instanceof Error ? error.message : String(error))
            })
        })
        rowEl.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return
          }
          event.preventDefault()
          void this.plugin
            .activateChatConversation(conversation.id)
            .catch((error) => {
              new Notice(error instanceof Error ? error.message : String(error))
            })
        })
        rowEl.addEventListener("contextmenu", (event) => {
          event.preventDefault()
          this.handleConversationContextMenu(conversation)
        })
        this.sidebarRowEls.set(conversation.id, rowEl)
      }
      rowEl.classList.toggle(
        "tmd-is-active",
        conversation.id === activeConversationId,
      )
      rowEl.empty()
      const titleRow = rowEl.createDiv({ cls: "tmd-chat-conversation-row" })
      titleRow.createDiv({
        cls: "tmd-chat-conversation-title",
        text: conversation.title,
      })
      const deleteButton = titleRow.createEl("button", {
        cls: "tmd-chat-conversation-delete",
      })
      setIcon(deleteButton, "trash-2")
      deleteButton.setAttribute(
        "aria-label",
        `Delete chat ${conversation.title}`,
      )
      deleteButton.setAttribute("title", `Delete chat ${conversation.title}`)
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation()
        if (this.hasRunningTaskForConversation(conversation.id)) {
          new Notice(
            "Stop the active chat task before deleting this conversation",
          )
          return
        }
        if (window.confirm(`Delete chat "${conversation.title}"?`)) {
          void this.plugin
            .deleteChatConversation(conversation.id)
            .catch((error) => {
              new Notice(error instanceof Error ? error.message : String(error))
            })
        }
      })

      const anchor: ChildNode | null = previousEl
        ? previousEl.nextSibling
        : this.conversationListEl.firstChild
      if (rowEl !== anchor) {
        this.conversationListEl.insertBefore(rowEl, anchor)
      }
      previousEl = rowEl
    }
  }

  private handleConversationContextMenu(
    conversation: ChatConversationRecord,
  ): void {
    const nextTitle = window.prompt("Rename chat", conversation.title)
    if (nextTitle && nextTitle.trim()) {
      this.plugin.chatManager.renameConversation(conversation.id, nextTitle)
    }
  }

  private syncContext(context: ContextSnapshot | null): void {
    if (!this.contextNodes) {
      return
    }
    const summary = summarizeContext(context)
    if (this.contextNodes.valueEl.dataset.value !== summary) {
      this.contextNodes.valueEl.dataset.value = summary
      this.contextNodes.valueEl.setText(summary)
    }

    const snippet = context?.selection?.text?.trim().slice(0, 2000) ?? ""
    const existingSnippetEl = this.contextNodes.snippetEl
    if (!snippet) {
      existingSnippetEl?.remove()
      this.contextNodes.snippetEl = null
      return
    }

    const snippetEl =
      existingSnippetEl ??
      this.contextEl.createDiv({ cls: "tmd-chat-context-snippet" })
    if (snippetEl.dataset.value !== snippet) {
      snippetEl.dataset.value = snippet
      snippetEl.setText(snippet)
    }
    this.contextNodes.snippetEl = snippetEl
  }

  private syncLoadMore(
    conversationId: string | null,
    hiddenCount: number,
  ): void {
    if (!conversationId || hiddenCount <= 0) {
      this.loadMoreButtonEl?.remove()
      this.loadMoreButtonEl = null
      return
    }
    const button =
      this.loadMoreButtonEl ??
      this.timelineEl.createEl("button", { cls: "tmd-chat-load-more" })
    button.setText(
      `Load ${Math.min(hiddenCount, MESSAGE_WINDOW_SIZE)} earlier messages`,
    )
    button.onclick = () => {
      this.shouldAutoScrollToBottom = false
      this.visibleMessageCount += MESSAGE_WINDOW_SIZE
      void this.render()
    }
    if (this.timelineEl.firstChild !== button) {
      this.timelineEl.insertBefore(button, this.timelineEl.firstChild)
    }
    this.loadMoreButtonEl = button
  }

  private syncEmptyState(isEmpty: boolean): void {
    if (!isEmpty) {
      this.emptyStateEl?.remove()
      this.emptyStateEl = null
      return
    }
    if (this.emptyStateEl) {
      return
    }
    if (!this.plugin.isAnteInstalled()) {
      const empty = renderMissingAnteState(this.timelineEl, {
        className: "tmd-chat-empty",
        title: "Ante is not installed yet.",
        description:
          "Open Ante md Settings to install the local Ante CLI before starting chat.",
        onOpenSettings: () => this.plugin.openPluginSettings(),
        onRefresh: () => this.plugin.refreshAnteEnvironment().then(() => this.render()),
      })
      this.emptyStateEl = empty
      return
    }
    const empty = renderSimpleEmptyState(this.timelineEl, {
      className: "tmd-chat-empty",
      title: "No messages yet.",
      description: "Use the current note as context and start chatting with Ante.",
    })
    this.emptyStateEl = empty
  }

  private syncMessages(
    messages: ChatMessageRecord[],
    taskLookup: Map<string, TaskRecord>,
    diffsByTask: Map<string, ResolvedArtifactDiff[]>,
  ): void {
    let previousEl: HTMLElement | null = this.loadMoreButtonEl
    const visibleIds: string[] = []
    for (const message of messages) {
      visibleIds.push(message.id)
      const messageEl = this.syncMessage(
        message,
        taskLookup.get(message.turn?.taskId ?? ""),
        diffsByTask,
      )
      const anchor: ChildNode | null = previousEl
        ? previousEl.nextSibling
        : this.timelineEl.firstChild
      if (messageEl !== anchor) {
        this.timelineEl.insertBefore(messageEl, anchor)
      }
      previousEl = messageEl
    }
    this.pruneMessageEls(visibleIds)
  }

  private syncMessage(
    message: ChatMessageRecord,
    task: TaskRecord | undefined,
    diffsByTask: Map<string, ResolvedArtifactDiff[]>,
  ): HTMLDivElement {
    let elements = this.messageEls.get(message.id)
    if (!elements) {
      const rootEl = createDiv({
        cls: `tmd-chat-message ${message.role === "user" ? "tmd-is-user" : "tmd-is-assistant"}`,
      })
      const stackEl = rootEl.createDiv({ cls: "tmd-chat-stack" })
      const bubbleEl = stackEl.createDiv({ cls: "tmd-chat-bubble" })
      const metaEl = bubbleEl.createDiv({ cls: "tmd-chat-meta" })
      const roleEl = metaEl.createDiv({ cls: "tmd-chat-role" })
      const footerEl = stackEl.createDiv({ cls: "tmd-chat-footer" })
      const stampEl = footerEl.createDiv({ cls: "tmd-chat-stamp" })
      elements = {
        rootEl,
        stackEl,
        bubbleEl,
        metaEl,
        roleEl,
        footerEl,
        stampEl,
        textEl: null,
        textValue: null,
        textMode: null,
        textRenderToken: 0,
        textComponent: null,
        loadingEl: null,
        loadingValue: null,
        processEl: null,
        processValue: null,
        artifactsHostEl: null,
        artifactsValue: null,
        approvalHostEl: null,
        approvalValue: null,
        runtimeDetailsHostEl: null,
        runtimeDetailsValue: null,
        errorEl: null,
        errorValue: null,
      }
      this.messageEls.set(message.id, elements)
    }

    elements.rootEl.classList.toggle("tmd-is-user", message.role === "user")
    elements.rootEl.classList.toggle(
      "tmd-is-assistant",
      message.role === "assistant",
    )
    if (elements.roleEl.parentElement) {
      elements.roleEl.detach()
    }
    this.syncMessageFooter(elements, message)

    const previewText = clampPreview(message.text)
    if (previewText) {
      this.syncMessageText(elements, message, previewText)
      this.removeLoading(elements)
    } else if (message.status === "streaming") {
      this.removeText(elements)
      this.syncLoading(
        elements,
        loadingLabelForMessage(message, this.loadingFrame),
      )
    } else {
      this.removeText(elements)
      this.removeLoading(elements)
    }

    const processLines =
      message.status === "streaming"
        ? [
            ...buildProcessStatusLines(message.runtime?.processLane),
            ...buildRuntimeLogLines(
              task?.logs ?? [],
              this.plugin.shouldShowFullProcessLogs(),
            ),
          ]
        : []
    this.syncProcessLines(elements, processLines)
    this.syncRuntimeDetails(elements, message)

    const resolvedArtifacts = task ? (diffsByTask.get(task.id) ?? []) : []
    const fallbackResolvedArtifacts =
      !task && message.turn?.taskId
        ? (diffsByTask.get(message.turn.taskId) ?? [])
        : []
    const artifactDiffs =
      resolvedArtifacts.length > 0
        ? resolvedArtifacts
        : fallbackResolvedArtifacts
    if (artifactDiffs.length > 0) {
      this.syncArtifacts(elements, task ?? null, artifactDiffs)
    } else {
      this.removeArtifacts(elements)
    }

    if (message.runtime?.approval && task) {
      this.syncApproval(elements, task, message.runtime.approval)
    } else {
      this.removeApproval(elements)
    }

    if (message.runtime?.error) {
      this.syncError(elements, message.runtime.error)
    } else {
      this.removeError(elements)
    }

    return elements.rootEl
  }

  private pruneMessageEls(visibleIds: string[]): void {
    const visible = new Set(visibleIds)
    for (const [messageId, elements] of [...this.messageEls.entries()]) {
      if (visible.has(messageId)) {
        continue
      }
      this.disposeMessageTextComponent(elements)
      elements.rootEl.remove()
      this.messageEls.delete(messageId)
      this.messageStatusById.delete(messageId)
    }
    this.messageOrder.clear()
    for (const messageId of visibleIds) {
      this.messageOrder.add(messageId)
    }
  }

  private syncMessageStatuses(messages: ChatMessageRecord[]): void {
    const visibleIds = new Set(messages.map((message) => message.id))
    for (const [messageId] of [...this.messageStatusById.entries()]) {
      if (!visibleIds.has(messageId)) {
        this.messageStatusById.delete(messageId)
      }
    }
    for (const message of messages) {
      this.messageStatusById.set(message.id, message.status)
    }
  }

  private getCompletedMessageToFocus(
    messages: ChatMessageRecord[],
  ): string | null {
    const latestAssistantMessage = [...messages]
      .reverse()
      .find((message) => message.role === "assistant")
    if (!latestAssistantMessage) {
      return null
    }
    const previousStatus = this.messageStatusById.get(latestAssistantMessage.id)
    if (previousStatus !== "streaming") {
      return null
    }
    if (latestAssistantMessage.status === "streaming") {
      return null
    }
    return latestAssistantMessage.id
  }

  private syncMessageText(
    elements: ChatMessageElements,
    message: ChatMessageRecord,
    text: string,
  ): void {
    if (message.role === "assistant" && message.status !== "streaming") {
      this.syncMarkdownMessageText(elements, message, text)
      return
    }

    const textEl = this.ensureMessageTextEl(elements, "plain")
    this.setText(textEl, text, "textValue", elements)
  }

  private syncMarkdownMessageText(
    elements: ChatMessageElements,
    message: ChatMessageRecord,
    text: string,
  ): void {
    const textEl = this.ensureMessageTextEl(elements, "markdown")
    if (elements.textValue === text) {
      return
    }

    elements.textValue = text
    const renderToken = elements.textRenderToken + 1
    elements.textRenderToken = renderToken
    textEl.empty()
    textEl.removeClass("tmd-chat-pre")
    textEl.addClass("markdown-rendered")

    const sourcePath =
      message.context?.filePath ?? this.liveContext?.filePath ?? ""
    const renderComponent = elements.textComponent ?? this

    void MarkdownRenderer.render(
      this.app,
      text,
      textEl,
      sourcePath,
      renderComponent,
    )
      .then(() => {
        if (
          elements.textRenderToken !== renderToken ||
          elements.textEl !== textEl ||
          elements.textMode !== "markdown"
        ) {
          return
        }
        if (this.shouldAutoScrollToBottom || this.shouldStickToBottom()) {
          this.scrollToBottom()
          this.shouldAutoScrollToBottom = false
        }
      })
      .catch(() => {
        if (
          elements.textRenderToken !== renderToken ||
          elements.textEl !== textEl ||
          elements.textMode !== "markdown"
        ) {
          return
        }
        this.fallbackToPlainText(textEl, text)
        if (this.shouldAutoScrollToBottom || this.shouldStickToBottom()) {
          this.scrollToBottom()
          this.shouldAutoScrollToBottom = false
        }
      })
  }

  private ensureMessageTextEl(
    elements: ChatMessageElements,
    mode: "plain" | "markdown",
  ): HTMLElement {
    if (elements.textEl && elements.textMode === mode) {
      return elements.textEl
    }

    this.disposeMessageTextComponent(elements)
    elements.textEl?.remove()

    const textEl =
      mode === "markdown"
        ? elements.bubbleEl.createDiv({
            cls: "tmd-chat-text markdown-rendered",
          })
        : elements.bubbleEl.createEl("pre", {
            cls: "tmd-chat-text tmd-chat-pre",
          })

    elements.textEl = textEl
    elements.textMode = mode
    elements.textValue = null
    elements.textRenderToken += 1

    if (mode === "markdown") {
      elements.textComponent = this.addChild(new Component())
    }

    return textEl
  }

  private disposeMessageTextComponent(elements: ChatMessageElements): void {
    if (!elements.textComponent) {
      return
    }
    this.removeChild(elements.textComponent)
    elements.textComponent = null
  }

  private fallbackToPlainText(container: HTMLElement, text: string): void {
    container.empty()
    container.removeClass("markdown-rendered")
    container.addClass("tmd-chat-pre")
    container.setText(text)
  }

  private removeText(elements: ChatMessageElements): void {
    this.disposeMessageTextComponent(elements)
    elements.textEl?.remove()
    elements.textEl = null
    elements.textValue = null
    elements.textMode = null
    elements.textRenderToken += 1
  }

  private syncLoading(elements: ChatMessageElements, text: string): void {
    const loadingEl =
      elements.loadingEl ??
      elements.bubbleEl.createDiv({ cls: "tmd-chat-loading" })
    this.setText(loadingEl, text, "loadingValue", elements)
    elements.loadingEl = loadingEl
  }

  private removeLoading(elements: ChatMessageElements): void {
    elements.loadingEl?.remove()
    elements.loadingEl = null
    elements.loadingValue = null
  }

  private syncProcessLines(
    elements: ChatMessageElements,
    lines: string[],
  ): void {
    if (lines.length === 0) {
      this.removeProcess(elements)
      return
    }
    const signature = lines.join("\n")
    if (elements.processEl && elements.processValue === signature) {
      return
    }

    const processEl =
      elements.processEl ??
      elements.bubbleEl.createDiv({ cls: "tmd-chat-process" })
    processEl.empty()
    for (const line of lines) {
      processEl.createDiv({ cls: "tmd-chat-process-line", text: line })
    }
    elements.processEl = processEl
    elements.processValue = signature
  }

  private removeProcess(elements: ChatMessageElements): void {
    elements.processEl?.remove()
    elements.processEl = null
    elements.processValue = null
  }

  private syncArtifacts(
    elements: ChatMessageElements,
    task: TaskRecord | null,
    resolvedArtifacts: ResolvedArtifactDiff[],
  ): void {
    this.ensureDefaultExpandedArtifact(task, resolvedArtifacts)
    const signature = this.buildArtifactsSignature(
      task?.id ?? "persisted",
      resolvedArtifacts,
    )
    if (elements.artifactsHostEl && elements.artifactsValue === signature) {
      return
    }
    const host =
      elements.artifactsHostEl ??
      elements.bubbleEl.createDiv({ cls: "tmd-chat-artifacts-host" })
    host.empty()
    this.renderArtifacts(host, task, resolvedArtifacts)
    elements.artifactsHostEl = host
    elements.artifactsValue = signature
  }

  private removeArtifacts(elements: ChatMessageElements): void {
    elements.artifactsHostEl?.remove()
    elements.artifactsHostEl = null
    elements.artifactsValue = null
  }

  private ensureDefaultExpandedArtifact(
    task: TaskRecord | null,
    resolvedArtifacts: ResolvedArtifactDiff[],
  ): void {
    if (resolvedArtifacts.length === 0) {
      return
    }

    const groupKey = `${task?.id ?? "persisted"}:${resolvedArtifacts.map(({ artifact }) => artifact.id).join(",")}`
    if (this.autoExpandedArtifactGroups.has(groupKey)) {
      return
    }

    const hasExpandedArtifact = resolvedArtifacts.some(({ artifact }) =>
      this.expandedArtifactIds.has(artifact.id),
    )
    if (!hasExpandedArtifact) {
      this.expandedArtifactIds.add(resolvedArtifacts[0]!.artifact.id)
    }
    this.autoExpandedArtifactGroups.add(groupKey)
  }

  private renderArtifacts(
    container: HTMLElement,
    task: TaskRecord | null,
    resolvedArtifacts: ResolvedArtifactDiff[],
  ): void {
    renderArtifactDiffList(container, {
      plugin: this.plugin,
      task,
      resolvedArtifacts,
      expandedArtifactIds: this.expandedArtifactIds,
      onApplyAll: task
        ? () => this.plugin.taskEngine.applyAllArtifacts(task.id)
        : undefined,
      onToggleExpanded: (artifactId) => {
        if (this.expandedArtifactIds.has(artifactId)) {
          this.expandedArtifactIds.delete(artifactId)
        } else {
          this.expandedArtifactIds.add(artifactId)
        }
        void this.render()
      },
    })
  }

  private syncApproval(
    elements: ChatMessageElements,
    task: TaskRecord,
    approval: NonNullable<ChatMessageRecord["runtime"]>["approval"],
  ): void {
    const signature = buildApprovalSignature(approval, task.id)
    if (elements.approvalHostEl && elements.approvalValue === signature) {
      return
    }

    const host =
      elements.approvalHostEl ??
      elements.bubbleEl.createDiv({ cls: "tmd-chat-approval-host" })
    host.empty()
    if (approval) {
      renderApprovalCard(host, approval, (decision) => {
        this.respondToApproval(task.id, decision)
      })
    }
    elements.approvalHostEl = host
    elements.approvalValue = signature
  }

  private removeApproval(elements: ChatMessageElements): void {
    elements.approvalHostEl?.remove()
    elements.approvalHostEl = null
    elements.approvalValue = null
  }

  private syncRuntimeDetails(
    elements: ChatMessageElements,
    message: ChatMessageRecord,
  ): void {
    if (
      !this.plugin.shouldShowChatRuntimeDetails() ||
      message.status !== "streaming"
    ) {
      this.removeRuntimeDetails(elements)
      return
    }

    const telemetry = message.runtime?.telemetry
    const sections = buildRuntimeDetailsSections(telemetry, {
      clampPreview,
      formatTime,
    })
    if (sections.length === 0) {
      this.removeRuntimeDetails(elements)
      return
    }

    const shouldOpen = shouldAutoExpandRuntimeDetails(
      message.status === "streaming",
      telemetry,
    )
    const signature = `${sections.join("\n\n")}`
    if (
      elements.runtimeDetailsHostEl &&
      elements.runtimeDetailsValue === signature
    ) {
      return
    }

    const host =
      elements.runtimeDetailsHostEl ??
      elements.bubbleEl.createDiv({ cls: "tmd-chat-runtime-details-host" })
    host.empty()
    renderRuntimeDetails(host, sections, shouldOpen)
    elements.runtimeDetailsHostEl = host
    elements.runtimeDetailsValue = signature
  }

  private removeRuntimeDetails(elements: ChatMessageElements): void {
    elements.runtimeDetailsHostEl?.remove()
    elements.runtimeDetailsHostEl = null
    elements.runtimeDetailsValue = null
  }

  private syncError(elements: ChatMessageElements, error: string): void {
    const errorEl =
      elements.errorEl ?? elements.bubbleEl.createDiv({ cls: "tmd-error" })
    this.setText(errorEl, error, "errorValue", elements)
    elements.errorEl = errorEl
  }

  private removeError(elements: ChatMessageElements): void {
    elements.errorEl?.remove()
    elements.errorEl = null
    elements.errorValue = null
  }

  private setText(
    el: HTMLElement,
    text: string,
    field?: "textValue" | "loadingValue" | "errorValue",
    elements?: ChatMessageElements,
  ): void {
    if (field && elements && elements[field] === text) {
      return
    }
    if (!field && el.dataset.value === text) {
      return
    }
    if (field && elements) {
      elements[field] = text
    } else {
      el.dataset.value = text
    }
    el.setText(text)
  }

  private buildArtifactResolutionSignature(
    artifacts: ResolvedArtifactDiff["artifact"][],
    taskId: string,
  ): string {
    return [
      taskId,
      ...artifacts.map((artifact) =>
        [
          artifact.id,
          artifact.applyState,
          artifact.applyError ?? "",
          hashText(artifact.beforeText),
          hashText(artifact.afterText),
        ].join(":"),
      ),
    ].join("|")
  }

  private buildArtifactsSignature(
    taskId: string,
    resolvedArtifacts: ResolvedArtifactDiff[],
  ): string {
    return [
      taskId,
      ...resolvedArtifacts.map(({ artifact, hunks, stats }) =>
        [
          artifact.id,
          artifact.applyState,
          artifact.applyError ?? "",
          this.expandedArtifactIds.has(artifact.id) ? "expanded" : "collapsed",
          stats.additions,
          stats.removals,
          hunks.length,
        ].join(":"),
      ),
    ].join("|")
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

  private syncMessageFooter(
    elements: ChatMessageElements,
    message: ChatMessageRecord,
  ): void {
    const footerEl = elements.footerEl
    footerEl.empty()

    footerEl.createDiv({
      cls: "tmd-chat-stamp",
      text: formatTime(message.updatedAt || message.createdAt),
    })

    const actionsEl = footerEl.createDiv({ cls: "tmd-chat-message-actions" })
    const copyButton = actionsEl.createEl("button", {
      cls: "tmd-chat-message-action",
      attr: {
        "aria-label": "Copy message",
        title: "Copy message",
        type: "button",
      },
    })
    setIcon(copyButton, "copy")
    copyButton.disabled = !message.text.trim()
    copyButton.addEventListener("click", () => {
      void this.copyMessageText(message.text)
    })

    const refreshPrompt = this.getRefreshPrompt(message)
    if (refreshPrompt) {
      const refreshButton = actionsEl.createEl("button", {
        cls: "tmd-chat-message-action",
        attr: {
          "aria-label": "Refresh message",
          title: "Refresh message",
          type: "button",
        },
      })
      setIcon(refreshButton, "rotate-ccw")
      refreshButton.disabled =
        this.hasRunningTaskForConversation(refreshPrompt.conversationId)
      refreshButton.addEventListener("click", () => {
        void this.refreshMessage(refreshPrompt).catch((error) => {
          new Notice(
            error instanceof Error
              ? error.message
              : "Failed to refresh message",
          )
        })
      })
    }
  }

  private async copyMessageText(text: string): Promise<void> {
    if (!text.trim()) {
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      new Notice("Copied message")
    } catch (error) {
      new Notice(
        error instanceof Error ? error.message : "Failed to copy message",
      )
    }
  }

  private getRefreshPrompt(
    message: ChatMessageRecord,
  ):
    | {
        conversationId: string
        sourceRole: "user" | "assistant"
        prompt: string
        context: ContextSnapshot | null
        runtimeSessionId: string | null
      }
    | null {
    const messages =
      this.latestChatState?.messagesByConversation[message.conversationId] ?? []
    if (messages.length === 0) {
      return null
    }

    if (message.role === "user" && message.text.trim()) {
      return {
        conversationId: message.conversationId,
        sourceRole: "user",
        prompt: message.text,
        context: message.context ?? null,
        runtimeSessionId:
          this.plugin.chatManager.getConversationRuntimeSessionId(
            message.conversationId,
          ),
      }
    }

    const messageIndex = messages.findIndex(({ id }) => id === message.id)
    if (messageIndex <= 0) {
      return null
    }
    for (let index = messageIndex - 1; index >= 0; index -= 1) {
      const candidate = messages[index]
      if (candidate?.role === "user" && candidate.text.trim()) {
        return {
          conversationId: message.conversationId,
          sourceRole: "assistant",
          prompt: candidate.text,
          context: candidate.context ?? null,
          runtimeSessionId:
            this.plugin.chatManager.getConversationRuntimeSessionId(
              message.conversationId,
            ),
        }
      }
    }
    return null
  }

  private async refreshMessage(request: {
    conversationId: string
    sourceRole: "user" | "assistant"
    prompt: string
    context: ContextSnapshot | null
    runtimeSessionId: string | null
  }): Promise<void> {
    if (!this.plugin.ensureAnteInstalled("Chat with Ante")) {
      return
    }
    if (this.hasRunningTaskForConversation(request.conversationId)) {
      new Notice("Stop the active chat task before refreshing a message")
      return
    }

    this.shouldAutoScrollToBottom = true
    const taskId = crypto.randomUUID()
    let userMessageId = ""
    let createdConversation = false

    if (request.sourceRole === "user") {
      const pendingSend = this.plugin.chatManager.appendUserPrompt(
        request.prompt,
        request.context,
      )
      userMessageId = pendingSend.userMessageId
      createdConversation = pendingSend.createdConversation
    }

    this.plugin.chatManager.createAssistantTurn(request.conversationId, taskId)
    try {
      await this.plugin.taskEngine.queueChatTask(
        taskId,
        request.prompt,
        Boolean(request.runtimeSessionId),
        request.context,
        request.runtimeSessionId,
      )
    } catch (error) {
      const removedTaskIds = this.plugin.chatManager.rollbackPendingSend(
        request.conversationId,
        userMessageId,
        taskId,
        createdConversation,
      )
      this.plugin.taskEngine.clearTasks(removedTaskIds)
      throw error
    }
  }

  private runPrompt(): void {
    const prompt = this.composerEl.value.trim()
    if (!prompt) {
      return
    }
    if (!this.plugin.ensureAnteInstalled("Chat with Ante")) {
      return
    }
    this.shouldAutoScrollToBottom = true

    const activeConversation = this.getActiveConversation(this.latestChatState)
    const followUpSessionId = activeConversation
      ? this.plugin.chatManager.getConversationRuntimeSessionId(
          activeConversation.id,
        )
      : null

    void this.plugin.hostAdapter
      .capturePreferredContext()
      .then(async (contextSnapshot) => {
        this.liveContext = contextSnapshot
        const taskId = crypto.randomUUID()
        const pendingSend = this.plugin.chatManager.appendUserPrompt(
          prompt,
          contextSnapshot,
        )
        this.plugin.chatManager.createAssistantTurn(
          pendingSend.conversation.id,
          taskId,
        )
        try {
          await this.plugin.taskEngine.queueChatTask(
            taskId,
            prompt,
            Boolean(followUpSessionId),
            contextSnapshot,
            followUpSessionId,
          )
        } catch (error) {
          const removedTaskIds = this.plugin.chatManager.rollbackPendingSend(
            pendingSend.conversation.id,
            pendingSend.userMessageId,
            taskId,
            pendingSend.createdConversation,
          )
          this.plugin.taskEngine.clearTasks(removedTaskIds)
          throw error
        }
      })
      .then(() => {
        this.composerEl.value = ""
        this.syncComposerActionButton(this.hasRunningChatTask())
      })
      .catch((error) => {
        new Notice(
          error instanceof Error ? error.message : "Failed to start Ante chat",
        )
      })
  }

  private hasRunningChatTask(): boolean {
    return (this.latestTaskState?.tasks ?? []).some(
      (task) => task.triggerSource === "chat" && task.status === "running",
    )
  }

  private syncComposerActionButton(hasRunningTask: boolean): void {
    if (!this.composerActionButtonEl) {
      return
    }
    if (hasRunningTask) {
      this.composerActionButtonEl.dataset.action = "stop"
      setIcon(this.composerActionButtonEl, "square")
      this.composerActionButtonEl.setAttribute("aria-label", "Stop")
      this.composerActionButtonEl.setAttribute("title", "Stop")
      this.composerActionButtonEl.disabled = false
      return
    }
    this.composerActionButtonEl.dataset.action = "send"
    setIcon(this.composerActionButtonEl, "arrow-up")
    this.composerActionButtonEl.setAttribute("aria-label", "Send")
    this.composerActionButtonEl.setAttribute("title", "Send")
    this.composerActionButtonEl.disabled =
      this.composerEl.value.trim().length === 0
  }

  private syncLoadingTimer(): void {
    const activeMessages = this.getActiveConversationMessages().filter(
      (message) => message.status === "streaming",
    )
    const shouldAnimate = activeMessages.some(
      (message) => !message.text.trim() && !message.runtime?.approval,
    )

    if (shouldAnimate && this.loadingTimer == null) {
      this.loadingTimer = window.setInterval(() => {
        this.loadingFrame = (this.loadingFrame + 1) % 4
        this.refreshLoadingIndicators()
      }, 500)
      return
    }

    if (!shouldAnimate && this.loadingTimer != null) {
      window.clearInterval(this.loadingTimer)
      this.loadingTimer = null
      this.loadingFrame = 0
    }
  }

  private refreshLoadingIndicators(): void {
    for (const message of this.getActiveConversationMessages()) {
      if (message.status !== "streaming") {
        continue
      }
      const elements = this.messageEls.get(message.id)
      if (!elements) {
        continue
      }
      if (message.text.trim() || message.runtime?.approval) {
        this.removeLoading(elements)
        continue
      }
      this.syncLoading(
        elements,
        loadingLabelForMessage(message, this.loadingFrame),
      )
    }
  }

  private resetActiveConversation(): void {
    const activeConversation = this.getActiveConversation(this.latestChatState)
    if (!activeConversation) {
      return
    }
    if (this.hasRunningTaskForConversation(activeConversation.id)) {
      new Notice("Stop the active chat task before resetting the conversation")
      return
    }
    void this.plugin
      .deleteChatConversation(activeConversation.id)
      .then(() => {
        this.expandedArtifactIds.clear()
      })
      .catch((error) => {
        new Notice(error instanceof Error ? error.message : String(error))
      })
  }

  private shouldStickToBottom(): boolean {
    const threshold = 24
    return (
      this.timelineEl.scrollTop + this.timelineEl.clientHeight >=
      this.timelineEl.scrollHeight - threshold
    )
  }

  private scrollToBottom(): void {
    this.timelineEl.scrollTop = this.timelineEl.scrollHeight
  }

  private scrollMessageToTop(messageId: string): void {
    const messageEl = this.messageEls.get(messageId)?.rootEl
    if (!messageEl) {
      return
    }
    this.timelineEl.scrollTop = Math.max(0, messageEl.offsetTop)
  }

  private pruneResolvedArtifactCache(activeTaskIds: string[]): void {
    const active = new Set(activeTaskIds)
    for (const taskId of [...this.resolvedArtifactsCache.keys()]) {
      if (!active.has(taskId)) {
        this.resolvedArtifactsCache.delete(taskId)
      }
    }
  }

  private getActiveConversation(
    chatState: ChatStateSnapshot | null,
  ): ChatConversationRecord | null {
    if (!chatState) {
      return null
    }
    return (
      chatState.conversations.find(
        (conversation) => conversation.id === chatState.activeConversationId,
      ) ??
      chatState.conversations[0] ??
      null
    )
  }

  private getActiveConversationMessages(): ChatMessageRecord[] {
    const state = this.latestChatState
    const conversation = this.getActiveConversation(state)
    if (!state || !conversation) {
      return []
    }
    return state.messagesByConversation[conversation.id] ?? []
  }

  private hasRunningTaskForConversation(conversationId: string): boolean {
    const taskState = this.latestTaskState ?? this.plugin.taskEngine.getState()
    const chatState = this.latestChatState
    if (!chatState) {
      return false
    }

    const taskIds = new Set(
      (chatState.messagesByConversation[conversationId] ?? [])
        .map((message) => message.turn?.taskId)
        .filter((taskId): taskId is string => Boolean(taskId)),
    )

    if (taskIds.size === 0) {
      return false
    }

    return taskState.tasks.some(
      (task) =>
        task.triggerSource === "chat" &&
        task.status === "running" &&
        taskIds.has(task.id),
    )
  }
}
