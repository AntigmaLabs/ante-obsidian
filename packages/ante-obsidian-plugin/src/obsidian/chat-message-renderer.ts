import { App, Component, MarkdownRenderer, Notice, setIcon } from "obsidian"
import type TmdPlugin from "./main"
import type {
  ChatMessageRecord,
} from "../core/chat-types"
import type {
  TaskRecord,
  ContextSnapshot,
  RuntimeApprovalDecision,
} from "../core/types"
import {
  clampPreview,
  formatTime,
  loadingLabelForMessage,
  buildProcessStatusLines,
  buildRuntimeLogLines,
  getAttachmentFileName,
  hashText,
  formatAttachmentLabel,
} from "./chat-view-helpers"
import {
  resolveArtifactDiffs,
  resolveArtifactsToDiffs,
  type ResolvedArtifactDiff,
} from "./diff-block"
import {
  buildApprovalSignature,
  renderApprovalCard,
} from "./approval-card-renderer"
import {
  renderRuntimeDetails,
  buildRuntimeDetailsSections,
  shouldAutoExpandRuntimeDetails,
} from "./runtime-details-renderer"
import { renderArtifactDiffList } from "./artifact-diff-renderer"
import { appendErrorReportLink } from "./utils"

export interface ChatMessageElements {
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
  attachmentsEl: HTMLDivElement | null
  attachmentsValue: string | null
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

export class ChatMessageRenderer extends Component {
  private readonly expandedArtifactIds = new Set<string>()
  private readonly autoExpandedArtifactGroups = new Set<string>()
  private readonly resolvedArtifactsCache = new Map<
    string,
    { signature: string; diffs: ResolvedArtifactDiff[] }
  >()
  private readonly pendingArtifactResolutions = new Map<string, string>()
  private readonly messageEls = new Map<string, ChatMessageElements>()
  private readonly messageOrder = new Set<string>()
  private readonly messageStatusById = new Map<
    string,
    ChatMessageRecord["status"]
  >()

  constructor(
    public readonly app: App,
    private readonly plugin: TmdPlugin,
    private readonly timelineEl: HTMLDivElement,
    private readonly getLoadingFrame: () => number,
    private readonly getLiveContext: () => ContextSnapshot | null,
    private readonly getShouldAutoScrollToBottom: () => boolean,
    private readonly setShouldAutoScrollToBottom: (val: boolean) => void,
    private readonly shouldStickToBottom: () => boolean,
    private readonly scrollToBottom: () => void,
    private readonly hasRunningTaskForConversation: (conversationId: string) => boolean,
    private readonly getRefreshPrompt: (message: ChatMessageRecord) => any,
    private readonly refreshMessage: (prompt: any) => Promise<void>,
    private readonly triggerRender: () => void,
  ) {
    super()
  }

  clearExpandedArtifactIds(): void {
    this.expandedArtifactIds.clear()
    this.autoExpandedArtifactGroups.clear()
  }

  getMessageEls(): Map<string, ChatMessageElements> {
    return this.messageEls
  }

  async prepareDiffs(
    visibleMessages: ChatMessageRecord[],
    taskLookup: Map<string, TaskRecord>,
  ): Promise<Map<string, ResolvedArtifactDiff[]>> {
    const diffsByTask = new Map<string, ResolvedArtifactDiff[]>()
    for (const message of visibleMessages) {
      const taskId = message.turn?.taskId
      if (!taskId) {
        continue
      }
      const task = taskLookup.get(taskId)
      const artifacts = task?.artifacts.length
        ? task.artifacts
        : (message.runtime?.artifacts ?? []).filter(
            (artifact) => artifact.applyState !== "discarded",
          )
      if (artifacts.length === 0) {
        continue
      }
      const signature = this.buildArtifactResolutionSignature(
        artifacts,
        taskId,
      )
      const cached = this.resolvedArtifactsCache.get(taskId)
      if (cached?.signature === signature) {
        diffsByTask.set(taskId, cached.diffs)
        continue
      }
      if (this.pendingArtifactResolutions.get(taskId) === signature) {
        continue
      }
      this.pendingArtifactResolutions.set(taskId, signature)
      void (async () => {
        try {
          const diffs = task
            ? await resolveArtifactDiffs(task)
            : await resolveArtifactsToDiffs(artifacts)
          if (this.pendingArtifactResolutions.get(taskId) !== signature) {
            return
          }
          this.resolvedArtifactsCache.set(taskId, { signature, diffs })
        } catch (error) {
          console.error("[tmd] Failed to prepare artifact diffs", error)
        } finally {
          if (this.pendingArtifactResolutions.get(taskId) === signature) {
            this.pendingArtifactResolutions.delete(taskId)
            this.triggerRender()
          }
        }
      })()
    }
    return diffsByTask
  }

  syncMessages(
    messages: ChatMessageRecord[],
    taskLookup: Map<string, TaskRecord>,
    diffsByTask: Map<string, ResolvedArtifactDiff[]>,
    loadMoreButtonEl: HTMLButtonElement | null,
  ): void {
    let previousEl: HTMLElement | null = loadMoreButtonEl
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

  syncMessage(
    message: ChatMessageRecord,
    task: TaskRecord | undefined,
    diffsByTask: Map<string, ResolvedArtifactDiff[]>,
  ): HTMLDivElement {
    let elements = this.messageEls.get(message.id)
    if (!elements) {
      const rootEl = createDiv({
        cls: `tmd-chat-message ${message.role === "user" ? "tmd-is-user" : "tmd-is-assistant"}${
          message.role === "assistant" && !message.turn ? " tmd-is-note" : ""
        }`,
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
        attachmentsEl: null,
        attachmentsValue: null,
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
    const attachmentPaths = message.attachmentPaths ?? []
    if (previewText) {
      this.syncMessageText(elements, message, previewText)
    } else {
      this.removeText(elements)
    }

    if (message.status === "streaming" && !message.runtime?.approval) {
      this.syncLoading(
        elements,
        loadingLabelForMessage(message, this.getLoadingFrame()),
      )
    } else {
      this.removeLoading(elements)
    }
    this.syncMessageAttachments(elements, attachmentPaths)

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
    const hasPendingArtifacts =
      (task?.artifacts.length ?? 0) > 0 ||
      ((message.runtime?.artifacts ?? []).filter(
        (artifact) => artifact.applyState !== "discarded",
      ).length > 0)
    if (artifactDiffs.length > 0) {
      this.syncArtifacts(elements, task ?? null, artifactDiffs)
    } else if (hasPendingArtifacts) {
      this.syncArtifactsLoading(elements, task?.id ?? message.turn?.taskId ?? "persisted")
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

    this.enforceBubbleLayoutOrder(elements)

    return elements.rootEl
  }

  private enforceBubbleLayoutOrder(elements: ChatMessageElements): void {
    const order = [
      elements.metaEl,
      elements.attachmentsEl,
      elements.textEl,
      elements.runtimeDetailsHostEl,
      elements.processEl,
      elements.loadingEl,
      elements.artifactsHostEl,
      elements.approvalHostEl,
      elements.errorEl,
    ]
    for (const el of order) {
      if (el && el.parentElement === elements.bubbleEl) {
        elements.bubbleEl.appendChild(el)
      }
    }
  }


  pruneMessageEls(visibleIds: string[]): void {
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

  syncMessageStatuses(messages: ChatMessageRecord[]): void {
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

  getCompletedMessageToFocus(
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
      message.context?.filePath ?? this.getLiveContext()?.filePath ?? ""
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
        if (this.getShouldAutoScrollToBottom() || this.shouldStickToBottom()) {
          this.scrollToBottom()
          this.setShouldAutoScrollToBottom(false)
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
        if (this.getShouldAutoScrollToBottom() || this.shouldStickToBottom()) {
          this.scrollToBottom()
          this.setShouldAutoScrollToBottom(false)
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

  private syncMessageAttachments(
    elements: ChatMessageElements,
    attachmentPaths: string[],
  ): void {
    if (attachmentPaths.length === 0) {
      this.removeMessageAttachments(elements)
      return
    }

    const signature = attachmentPaths.join("\n")
    if (elements.attachmentsEl && elements.attachmentsValue === signature) {
      return
    }

    const attachmentsEl =
      elements.attachmentsEl ??
      elements.bubbleEl.createDiv({ cls: "tmd-chat-message-attachments" })
    attachmentsEl.empty()

    for (const filePath of attachmentPaths) {
      const itemEl = attachmentsEl.createDiv({
        cls: "tmd-chat-message-attachment",
      })
      itemEl.setAttribute("title", getAttachmentFileName(filePath))
      setIcon(itemEl, "file")
    }

    elements.attachmentsEl = attachmentsEl
    elements.attachmentsValue = signature
  }

  private removeMessageAttachments(elements: ChatMessageElements): void {
    elements.attachmentsEl?.remove()
    elements.attachmentsEl = null
    elements.attachmentsValue = null
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

  private syncArtifactsLoading(
    elements: ChatMessageElements,
    taskId: string,
  ): void {
    const signature = `${taskId}:loading`
    if (elements.artifactsHostEl && elements.artifactsValue === signature) {
      return
    }
    const host =
      elements.artifactsHostEl ??
      elements.bubbleEl.createDiv({ cls: "tmd-chat-artifacts-host" })
    host.empty()
    const card = host.createDiv({ cls: "tmd-diff-card tmd-diff-loading-card" })
    const summary = card.createDiv({ cls: "tmd-diff-summary" })
    const title = summary.createDiv({ cls: "tmd-diff-summary-title" })
    title.createSpan({
      cls: "tmd-diff-summary-count",
      text: "Preparing changes",
    })
    const body = card.createDiv({ cls: "tmd-diff-loading-body" })
    body.createDiv({ cls: "tmd-diff-loading-line is-wide" })
    body.createDiv({ cls: "tmd-diff-loading-line" })
    body.createDiv({ cls: "tmd-diff-loading-line is-short" })
    elements.artifactsHostEl = host
    elements.artifactsValue = signature
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
        this.triggerRender()
      },
    });
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
    let errorEl = elements.errorEl
    if (!errorEl) {
      errorEl = elements.bubbleEl.createDiv({ cls: "tmd-error" })
      elements.errorEl = errorEl
    }

    let textSpan = errorEl.querySelector(".tmd-error-text") as HTMLElement
    if (!textSpan) {
      textSpan = errorEl.createSpan({ cls: "tmd-error-text" })
    }
    this.setText(textSpan, error, "errorValue", elements)

    appendErrorReportLink(errorEl, error, this.plugin)
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

  refreshLoadingIndicators(messages: ChatMessageRecord[]): void {
    for (const message of messages) {
      if (message.status !== "streaming") {
        continue
      }
      const elements = this.messageEls.get(message.id)
      if (!elements) {
        continue
      }
      if (message.runtime?.approval) {
        this.removeLoading(elements)
        continue
      }
      this.syncLoading(
        elements,
        loadingLabelForMessage(message, this.getLoadingFrame()),
      )
    }
  }

  scrollMessageToTop(messageId: string): void {
    const messageEl = this.messageEls.get(messageId)?.rootEl
    if (!messageEl) {
      return
    }
    this.timelineEl.scrollTop = Math.max(0, messageEl.offsetTop)
  }

  pruneResolvedArtifactCache(activeTaskIds: string[]): void {
    const active = new Set(activeTaskIds)
    for (const taskId of [...this.resolvedArtifactsCache.keys()]) {
      if (!active.has(taskId)) {
        this.resolvedArtifactsCache.delete(taskId)
      }
    }
    for (const taskId of [...this.pendingArtifactResolutions.keys()]) {
      if (!active.has(taskId)) {
        this.pendingArtifactResolutions.delete(taskId)
      }
    }
  }
}
