import {
  ItemView,
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
  TaskRecord,
  TmdState,
} from "../core/types"
import {
  renderMissingAnteState,
  renderSimpleEmptyState,
} from "./empty-state-renderer"
import { renderChatLayout } from "./chat-layout-renderer"
import {
  wireChatComposer,
  wireChatSidebar,
} from "./chat-shell-wiring"
import {
  MESSAGE_WINDOW_SIZE,
  summarizeContext,
  PROVIDER_LABELS,
  THINKING_LABELS,
} from "./chat-view-helpers"
import { ChatViewControls } from "./chat-view-controls"
import { ChatAttachmentManager } from "./chat-attachment-manager"
import { ChatPromptRunner } from "./chat-prompt-runner"
import { ChatMessageRenderer } from "./chat-message-renderer"

export const TMD_CHAT_VIEW_TYPE = "tmd-chat-view"

interface ChatContextElements {
  titleEl: HTMLDivElement
  valueEl: HTMLDivElement
  runtimeEl: HTMLDivElement
  snippetEl: HTMLDivElement | null
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
  private readonly sidebarRowEls = new Map<string, HTMLDivElement>()

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
  private attachmentButtonEl!: HTMLButtonElement
  private providerButtonEl!: HTMLButtonElement
  private modelButtonEl!: HTMLButtonElement
  private thinkingButtonEl!: HTMLButtonElement
  private consoleDrawerEl!: HTMLDivElement
  private consoleToggleBtnEl!: HTMLButtonElement
  private drawerCloseBtnEl!: HTMLButtonElement
  private composerEl!: HTMLTextAreaElement
  private composerContainerEl!: HTMLDivElement
  private attachmentListEl!: HTMLDivElement
  private fileInputEl!: HTMLInputElement
  private composerResizeObserver: ResizeObserver | null = null
  private loadMoreButtonEl: HTMLButtonElement | null = null
  private lastRenderedConversationId: string | null = null
  private shouldAutoScrollToBottom = true
  private isComposing = false
  private isSidebarCollapsed = true

  // Sub-controllers
  public viewControls!: ChatViewControls
  public attachmentManager!: ChatAttachmentManager
  public promptRunner!: ChatPromptRunner
  public messageRenderer!: ChatMessageRenderer

  constructor(
    leaf: WorkspaceLeaf,
    public readonly plugin: TmdPlugin,
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
    void this.plugin.warmAnteModelCatalog().then(() => {
      this.viewControls.syncRuntimeTargetControls(this.latestChatState?.activeConversationId ?? null)
      this.viewControls.populateModelSelect()
    }).catch(() => {
      // Visible send paths still surface Ante startup errors.
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
        const runtimeTarget = this.viewControls.getSelectedRuntimeTarget()
        void this.plugin
          .createChatConversation(this.liveContext)
          .then((conversation) => {
            this.plugin.chatManager.setConversationRuntimeTarget(
              conversation.id,
              runtimeTarget
            )
          })
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
      runtimeEl: layout.contextRuntimeEl,
      snippetEl: null,
    }
    this.contextNodes.titleEl.setText("Current context")

    this.timelineEl = layout.timelineEl
    this.composerContainerEl = layout.composerContainerEl
    this.consoleDrawerEl = layout.consoleDrawerEl
    this.consoleToggleBtnEl = layout.consoleToggleBtnEl
    this.drawerCloseBtnEl = layout.drawerCloseBtnEl

    setIcon(this.consoleToggleBtnEl, "sliders")
    this.consoleToggleBtnEl.setAttribute("aria-label", "Session Console")
    this.consoleToggleBtnEl.setAttribute("title", "Session Console")

    setIcon(this.drawerCloseBtnEl, "x")
    this.drawerCloseBtnEl.setAttribute("aria-label", "Close drawer")
    this.drawerCloseBtnEl.setAttribute("title", "Close drawer")

    this.registerDomEvent(this.consoleToggleBtnEl, "click", (event) => {
      // Prevent outside-click listener from immediately closing the drawer we are opening
      event.stopPropagation()
      this.consoleDrawerEl.classList.toggle("is-open")
    })
    this.registerDomEvent(layout.contextRuntimeEl, "click", (event) => {
      event.stopPropagation()
      this.consoleDrawerEl.classList.toggle("is-open")
    })
    this.registerDomEvent(this.drawerCloseBtnEl, "click", () => {
      this.consoleDrawerEl.classList.remove("is-open")
    })

    // Outside click collapses drawer
    this.registerDomEvent(this.containerEl, "click", (event) => {
      const target = event.target as HTMLElement
      if (this.consoleDrawerEl.classList.contains("is-open")) {
        if (!this.composerContainerEl.contains(target)) {
          this.consoleDrawerEl.classList.remove("is-open")
        }
      }
    })

    // Pressing ESC collapses drawer
    this.registerDomEvent(this.containerEl, "keydown", (event) => {
      if (event.key === "Escape") {
        this.consoleDrawerEl.classList.remove("is-open")
      }
    })

    this.attachmentListEl = layout.attachmentListEl
    this.attachmentButtonEl = layout.attachmentButtonEl
    setIcon(this.attachmentButtonEl, "plus")
    this.attachmentButtonEl.setAttribute("aria-label", "Attach files")
    this.attachmentButtonEl.setAttribute("title", "Attach files")
    this.providerButtonEl = layout.providerButtonEl
    this.modelButtonEl = layout.modelButtonEl
    this.thinkingButtonEl = layout.thinkingButtonEl
    this.composerEl = layout.composerEl
    this.composerEl.placeholder =
      "Ask about the current note, rewrite a selection, or plan the next edit."
    this.registerDomEvent(this.composerEl, "focus", () => {
      this.consoleDrawerEl.classList.remove("is-open")
    })
    this.composerActionButtonEl = layout.composerActionButtonEl
    this.fileInputEl = layout.fileInputEl
    this.fileInputEl.setAttribute("aria-hidden", "true")

    // Instantiate ChatViewControls
    this.viewControls = new ChatViewControls(
      this.app,
      this.plugin,
      this.providerButtonEl,
      this.modelButtonEl,
      this.thinkingButtonEl,
      () => this.liveContext,
      () => this.latestChatState?.activeConversationId ?? null,
    )
    this.viewControls.initializeRuntimeTargetControls()

    // Instantiate ChatAttachmentManager
    this.attachmentManager = new ChatAttachmentManager(
      this.fileInputEl,
      this.attachmentListEl,
      this.composerContainerEl,
      this.attachmentButtonEl,
      () => this.syncComposerOffset(),
      () => this.syncComposerActionButton(this.promptRunner.hasRunningChatTask()),
      () => this.promptRunner.hasRunningChatTask(),
    )
    this.attachmentManager.initialize()

    // Instantiate ChatPromptRunner
    this.promptRunner = new ChatPromptRunner(
      this.plugin,
      () => this.latestChatState,
      () => this.latestTaskState,
      () => this.liveContext,
      (context) => { this.liveContext = context },
      () => this.viewControls.getSelectedRuntimeTarget(),
      (convId, target) => this.viewControls.resolveConversationSendMode(convId, target),
      () => this.attachmentManager.getSelectedAttachmentPaths(),
      () => this.attachmentManager.clearSelectedAttachments(),
      (convId) => this.hasRunningTaskForConversation(convId),
      (hasRunning) => this.syncComposerActionButton(hasRunning),
      (val) => { this.shouldAutoScrollToBottom = val },
      this.composerEl,
    )

    // Instantiate ChatMessageRenderer
    this.messageRenderer = this.addChild(new ChatMessageRenderer(
      this.app,
      this.plugin,
      this.timelineEl,
      () => this.loadingFrame,
      () => this.liveContext,
      () => this.shouldAutoScrollToBottom,
      (val) => { this.shouldAutoScrollToBottom = val },
      () => this.shouldStickToBottom(),
      () => this.scrollToBottom(),
      (convId) => this.hasRunningTaskForConversation(convId),
      (msg) => this.promptRunner.getRefreshPrompt(msg),
      (req) => this.promptRunner.refreshMessage(req),
      () => { void this.render() },
    ))

    wireChatComposer({
      composerEl: this.composerEl,
      composerActionButtonEl: this.composerActionButtonEl,
      getIsComposing: () => this.isComposing,
      setIsComposing: (value) => {
        this.isComposing = value
      },
      onInput: () => {
        this.syncComposerActionButton(this.promptRunner.hasRunningChatTask())
      },
      onSubmit: () => {
        this.promptRunner.runPrompt()
      },
      onStop: () => {
        this.plugin.taskEngine.cancelActiveTask()
      },
    })
    this.attachmentManager.syncAttachmentList()
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
    const completedMessageToFocusId = this.messageRenderer.getCompletedMessageToFocus(messages)
    const visibleMessages = messages.slice(-this.visibleMessageCount)
    const visibleTaskIds = visibleMessages
      .map((message) => message.turn?.taskId)
      .filter((taskId): taskId is string => Boolean(taskId))
    const taskLookup = new Map<string, TaskRecord>()
    for (const task of this.latestTaskState?.tasks ?? []) {
      taskLookup.set(task.id, task)
    }

    const diffsByTask = await this.messageRenderer.prepareDiffs(visibleMessages, taskLookup)

    this.syncConversationSidebar(chatState, activeConversation?.id ?? null)
    this.viewControls.syncRuntimeTargetControls(activeConversation?.id ?? null)
    this.syncContext(this.liveContext)
    const hasRunningTask = this.promptRunner.hasRunningChatTask()
    this.syncComposerActionButton(hasRunningTask)

    if (!activeConversation || messages.length === 0) {
      this.syncLoadMore(null, 0)
      this.syncEmptyState(true)
      this.messageRenderer.pruneMessageEls([])
      this.lastRenderedConversationId = activeConversationId
      return
    }

    this.syncEmptyState(false)
    this.syncLoadMore(
      activeConversation.id,
      messages.length - visibleMessages.length,
    )
    this.messageRenderer.syncMessages(visibleMessages, taskLookup, diffsByTask, this.loadMoreButtonEl)
    this.messageRenderer.syncMessageStatuses(visibleMessages)
    this.messageRenderer.pruneResolvedArtifactCache(visibleTaskIds)
    this.lastRenderedConversationId = activeConversationId
    if (
      completedMessageToFocusId &&
      visibleMessages.some(
        (message) => message.id === completedMessageToFocusId,
      )
    ) {
      this.messageRenderer.scrollMessageToTop(completedMessageToFocusId)
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

    const target = this.viewControls.getSelectedRuntimeTarget()
    const providerLabel = PROVIDER_LABELS[target.provider as any] ?? target.provider
    const thinkingLabel = THINKING_LABELS[target.thinking] ?? target.thinking
    let displayModel = target.model || "default"
    if (displayModel.includes("/") && !displayModel.startsWith("http")) {
      displayModel = displayModel.split("/").pop() ?? displayModel
    }
    const runtimeSummary = `${providerLabel} · ${displayModel} · thinking: ${thinkingLabel}`
    if (this.contextNodes.runtimeEl.dataset.value !== runtimeSummary) {
      this.contextNodes.runtimeEl.dataset.value = runtimeSummary
      this.contextNodes.runtimeEl.setText(runtimeSummary)
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
          "Open Ante Obsidian Settings to install the local Ante CLI before starting chat.",
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
      this.composerEl.value.trim().length === 0 &&
      this.attachmentManager.getSelectedAttachmentPaths().length === 0
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
    this.messageRenderer.refreshLoadingIndicators(this.getActiveConversationMessages())
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
        this.messageRenderer.clearExpandedArtifactIds()
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
