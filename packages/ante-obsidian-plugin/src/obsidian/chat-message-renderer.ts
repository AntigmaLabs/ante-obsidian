import { App, Component, MarkdownRenderer, Notice, setIcon } from "obsidian";
import type TmdPlugin from "./main";
import type { ChatMessageRecord } from "../core/chat-types";
import type { TaskRecord, ContextSnapshot, RuntimeApprovalDecision } from "../core/types";
import {
  clampPreview,
  formatTime,
  loadingLabelForMessage,
  buildProcessStatusLines,
  buildRuntimeLogLines,
  getAttachmentFileName,
  hashText,
} from "./chat-view-helpers";
import {
  resolveArtifactDiffs,
  resolveArtifactsToDiffs,
  type ResolvedArtifactDiff,
} from "./diff-block";
import { buildApprovalSignature, renderApprovalCard } from "./approval-card-renderer";
import {
  renderRuntimeDetails,
  buildRuntimeDetailsSections,
  shouldAutoExpandRuntimeDetails,
} from "./runtime-details-renderer";
import { renderArtifactDiffList } from "./artifact-diff-renderer";
import { appendErrorReportLink } from "./utils";

type RefreshPrompt = {
  conversationId: string;
  sourceRole: "user" | "assistant";
  prompt: string;
  context: ContextSnapshot | null;
  runtimeSessionId: string | null;
};

/** View-side callbacks the renderer needs; implemented by ChatView. */
export interface ChatMessageRendererHost {
  getLoadingFrame: () => number;
  getLiveContext: () => ContextSnapshot | null;
  getShouldAutoScrollToBottom: () => boolean;
  setShouldAutoScrollToBottom: (val: boolean) => void;
  shouldStickToBottom: () => boolean;
  scrollToBottom: () => void;
  hasRunningTaskForConversation: (conversationId: string) => boolean;
  getRefreshPrompt: (message: ChatMessageRecord) => RefreshPrompt | null;
  refreshMessage: (prompt: RefreshPrompt) => Promise<void>;
  triggerRender: () => void;
}

/** A lazily-created child element paired with the signature of its last render. */
export interface RenderSlot {
  el: HTMLElement | null;
  value: string | null;
}

const emptySlot = (): RenderSlot => ({ el: null, value: null });

const clearSlot = (slot: RenderSlot): void => {
  slot.el?.remove();
  slot.el = null;
  slot.value = null;
};

export interface ChatMessageElements {
  rootEl: HTMLDivElement;
  stackEl: HTMLDivElement;
  bubbleEl: HTMLDivElement;
  metaEl: HTMLDivElement;
  roleEl: HTMLDivElement;
  footerEl: HTMLDivElement;
  stampEl: HTMLDivElement;
  textEl: HTMLElement | null;
  textValue: string | null;
  textMode: "plain" | "markdown" | null;
  textRenderToken: number;
  textComponent: Component | null;
  attachments: RenderSlot;
  loading: RenderSlot;
  process: RenderSlot;
  artifacts: RenderSlot;
  approval: RenderSlot;
  runtimeDetails: RenderSlot;
  error: RenderSlot;
}

export class ChatMessageRenderer extends Component {
  private readonly expandedArtifactIds = new Set<string>();
  private readonly autoExpandedArtifactGroups = new Set<string>();
  private readonly resolvedArtifactsCache = new Map<
    string,
    { signature: string; diffs: ResolvedArtifactDiff[] }
  >();
  private readonly pendingArtifactResolutions = new Map<string, string>();
  private readonly messageEls = new Map<string, ChatMessageElements>();
  private readonly messageOrder = new Set<string>();
  private readonly messageStatusById = new Map<string, ChatMessageRecord["status"]>();

  constructor(
    public readonly app: App,
    private readonly plugin: TmdPlugin,
    private readonly timelineEl: HTMLDivElement,
    private readonly host: ChatMessageRendererHost,
  ) {
    super();
  }

  clearExpandedArtifactIds(): void {
    this.expandedArtifactIds.clear();
    this.autoExpandedArtifactGroups.clear();
  }

  async prepareDiffs(
    visibleMessages: ChatMessageRecord[],
    taskLookup: Map<string, TaskRecord>,
  ): Promise<Map<string, ResolvedArtifactDiff[]>> {
    const diffsByTask = new Map<string, ResolvedArtifactDiff[]>();
    for (const message of visibleMessages) {
      const taskId = message.turn?.taskId;
      if (!taskId) {
        continue;
      }
      const task = taskLookup.get(taskId);
      const artifacts = task?.artifacts.length
        ? task.artifacts
        : (message.runtime?.artifacts ?? []).filter(
            (artifact) => artifact.applyState !== "discarded",
          );
      if (artifacts.length === 0) {
        continue;
      }
      const signature = this.buildArtifactResolutionSignature(artifacts, taskId);
      const cached = this.resolvedArtifactsCache.get(taskId);
      if (cached?.signature === signature) {
        diffsByTask.set(taskId, cached.diffs);
        continue;
      }
      if (this.pendingArtifactResolutions.get(taskId) === signature) {
        continue;
      }
      this.pendingArtifactResolutions.set(taskId, signature);
      void (async () => {
        try {
          const diffs = task
            ? await resolveArtifactDiffs(task)
            : await resolveArtifactsToDiffs(artifacts);
          if (this.pendingArtifactResolutions.get(taskId) !== signature) {
            return;
          }
          this.resolvedArtifactsCache.set(taskId, { signature, diffs });
        } catch (error) {
          console.error("[tmd] Failed to prepare artifact diffs", error);
        } finally {
          if (this.pendingArtifactResolutions.get(taskId) === signature) {
            this.pendingArtifactResolutions.delete(taskId);
            this.host.triggerRender();
          }
        }
      })();
    }
    return diffsByTask;
  }

  syncMessages(
    messages: ChatMessageRecord[],
    taskLookup: Map<string, TaskRecord>,
    diffsByTask: Map<string, ResolvedArtifactDiff[]>,
    loadMoreButtonEl: HTMLButtonElement | null,
  ): void {
    let previousEl: HTMLElement | null = loadMoreButtonEl;
    const visibleIds: string[] = [];
    for (const message of messages) {
      visibleIds.push(message.id);
      const messageEl = this.syncMessage(
        message,
        taskLookup.get(message.turn?.taskId ?? ""),
        diffsByTask,
      );
      const anchor: ChildNode | null = previousEl
        ? previousEl.nextSibling
        : this.timelineEl.firstChild;
      if (messageEl !== anchor) {
        this.timelineEl.insertBefore(messageEl, anchor);
      }
      previousEl = messageEl;
    }
    this.pruneMessageEls(visibleIds);
  }

  syncMessage(
    message: ChatMessageRecord,
    task: TaskRecord | undefined,
    diffsByTask: Map<string, ResolvedArtifactDiff[]>,
  ): HTMLDivElement {
    let elements = this.messageEls.get(message.id);
    if (!elements) {
      const rootEl = createDiv({
        cls: `tmd-chat-message ${message.role === "user" ? "tmd-is-user" : "tmd-is-assistant"}${
          message.role === "assistant" && !message.turn ? " tmd-is-note" : ""
        }`,
      });
      const stackEl = rootEl.createDiv({ cls: "tmd-chat-stack" });
      const bubbleEl = stackEl.createDiv({ cls: "tmd-chat-bubble" });
      const metaEl = bubbleEl.createDiv({ cls: "tmd-chat-meta" });
      const roleEl = metaEl.createDiv({ cls: "tmd-chat-role" });
      const footerEl = stackEl.createDiv({ cls: "tmd-chat-footer" });
      const stampEl = footerEl.createDiv({ cls: "tmd-chat-stamp" });
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
        attachments: emptySlot(),
        loading: emptySlot(),
        process: emptySlot(),
        artifacts: emptySlot(),
        approval: emptySlot(),
        runtimeDetails: emptySlot(),
        error: emptySlot(),
      };
      this.messageEls.set(message.id, elements);
    }

    elements.rootEl.classList.toggle("tmd-is-user", message.role === "user");
    elements.rootEl.classList.toggle("tmd-is-assistant", message.role === "assistant");
    if (elements.roleEl.parentElement) {
      elements.roleEl.detach();
    }
    this.syncMessageFooter(elements, message);

    const previewText = clampPreview(message.text);
    const attachmentPaths = message.attachmentPaths ?? [];
    if (previewText) {
      this.syncMessageText(elements, message, previewText);
    } else {
      this.removeText(elements);
    }

    if (message.status === "streaming" && !message.runtime?.approval) {
      this.syncLoading(elements, loadingLabelForMessage(message, this.host.getLoadingFrame()));
    } else {
      clearSlot(elements.loading);
    }
    this.syncMessageAttachments(elements, attachmentPaths);

    const processLines =
      message.status === "streaming"
        ? [
            ...buildProcessStatusLines(message.runtime?.processLane),
            ...buildRuntimeLogLines(task?.logs ?? [], this.plugin.shouldShowFullProcessLogs()),
          ]
        : [];
    this.syncProcessLines(elements, processLines);
    this.syncRuntimeDetails(elements, message);

    const resolvedArtifacts = task ? (diffsByTask.get(task.id) ?? []) : [];
    const fallbackResolvedArtifacts =
      !task && message.turn?.taskId ? (diffsByTask.get(message.turn.taskId) ?? []) : [];
    const artifactDiffs =
      resolvedArtifacts.length > 0 ? resolvedArtifacts : fallbackResolvedArtifacts;
    const hasPendingArtifacts =
      (task?.artifacts.length ?? 0) > 0 ||
      (message.runtime?.artifacts ?? []).filter((artifact) => artifact.applyState !== "discarded")
        .length > 0;
    if (artifactDiffs.length > 0) {
      this.syncArtifacts(elements, task ?? null, artifactDiffs);
    } else if (hasPendingArtifacts) {
      this.syncArtifactsLoading(elements, task?.id ?? message.turn?.taskId ?? "persisted");
    } else {
      clearSlot(elements.artifacts);
    }

    if (message.runtime?.approval && task) {
      this.syncApproval(elements, task, message.runtime.approval);
    } else {
      clearSlot(elements.approval);
    }

    if (message.runtime?.error) {
      this.syncError(elements, message.runtime.error);
    } else {
      clearSlot(elements.error);
    }

    this.enforceBubbleLayoutOrder(elements);

    return elements.rootEl;
  }

  private enforceBubbleLayoutOrder(elements: ChatMessageElements): void {
    const order = [
      elements.metaEl,
      elements.attachments.el,
      elements.textEl,
      elements.runtimeDetails.el,
      elements.process.el,
      elements.loading.el,
      elements.artifacts.el,
      elements.approval.el,
      elements.error.el,
    ];
    for (const el of order) {
      if (el && el.parentElement === elements.bubbleEl) {
        elements.bubbleEl.appendChild(el);
      }
    }
  }

  pruneMessageEls(visibleIds: string[]): void {
    const visible = new Set(visibleIds);
    for (const [messageId, elements] of [...this.messageEls.entries()]) {
      if (visible.has(messageId)) {
        continue;
      }
      this.disposeMessageTextComponent(elements);
      elements.rootEl.remove();
      this.messageEls.delete(messageId);
      this.messageStatusById.delete(messageId);
    }
    this.messageOrder.clear();
    for (const messageId of visibleIds) {
      this.messageOrder.add(messageId);
    }
  }

  syncMessageStatuses(messages: ChatMessageRecord[]): void {
    const visibleIds = new Set(messages.map((message) => message.id));
    for (const [messageId] of [...this.messageStatusById.entries()]) {
      if (!visibleIds.has(messageId)) {
        this.messageStatusById.delete(messageId);
      }
    }
    for (const message of messages) {
      this.messageStatusById.set(message.id, message.status);
    }
  }

  getCompletedMessageToFocus(messages: ChatMessageRecord[]): string | null {
    const latestAssistantMessage = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (!latestAssistantMessage) {
      return null;
    }
    const previousStatus = this.messageStatusById.get(latestAssistantMessage.id);
    if (previousStatus !== "streaming") {
      return null;
    }
    if (latestAssistantMessage.status === "streaming") {
      return null;
    }
    return latestAssistantMessage.id;
  }

  private syncMessageText(
    elements: ChatMessageElements,
    message: ChatMessageRecord,
    text: string,
  ): void {
    if (message.role === "assistant" && message.status !== "streaming") {
      this.syncMarkdownMessageText(elements, message, text);
      return;
    }

    const textEl = this.ensureMessageTextEl(elements, "plain");
    if (elements.textValue !== text) {
      elements.textValue = text;
      textEl.setText(text);
    }
  }

  private syncMarkdownMessageText(
    elements: ChatMessageElements,
    message: ChatMessageRecord,
    text: string,
  ): void {
    const textEl = this.ensureMessageTextEl(elements, "markdown");
    if (elements.textValue === text) {
      return;
    }

    elements.textValue = text;
    const renderToken = elements.textRenderToken + 1;
    elements.textRenderToken = renderToken;
    textEl.empty();
    textEl.removeClass("tmd-chat-pre");
    textEl.addClass("markdown-rendered");

    const sourcePath = message.context?.filePath ?? this.host.getLiveContext()?.filePath ?? "";
    const renderComponent = elements.textComponent ?? this;

    void MarkdownRenderer.render(this.app, text, textEl, sourcePath, renderComponent)
      .then(() => {
        if (
          elements.textRenderToken !== renderToken ||
          elements.textEl !== textEl ||
          elements.textMode !== "markdown"
        ) {
          return;
        }
        if (this.host.getShouldAutoScrollToBottom() || this.host.shouldStickToBottom()) {
          this.host.scrollToBottom();
          this.host.setShouldAutoScrollToBottom(false);
        }
      })
      .catch(() => {
        if (
          elements.textRenderToken !== renderToken ||
          elements.textEl !== textEl ||
          elements.textMode !== "markdown"
        ) {
          return;
        }
        this.fallbackToPlainText(textEl, text);
        if (this.host.getShouldAutoScrollToBottom() || this.host.shouldStickToBottom()) {
          this.host.scrollToBottom();
          this.host.setShouldAutoScrollToBottom(false);
        }
      });
  }

  private ensureMessageTextEl(
    elements: ChatMessageElements,
    mode: "plain" | "markdown",
  ): HTMLElement {
    if (elements.textEl && elements.textMode === mode) {
      return elements.textEl;
    }

    this.disposeMessageTextComponent(elements);
    elements.textEl?.remove();

    const textEl =
      mode === "markdown"
        ? elements.bubbleEl.createDiv({
            cls: "tmd-chat-text markdown-rendered",
          })
        : elements.bubbleEl.createEl("pre", {
            cls: "tmd-chat-text tmd-chat-pre",
          });

    elements.textEl = textEl;
    elements.textMode = mode;
    elements.textValue = null;
    elements.textRenderToken += 1;

    if (mode === "markdown") {
      elements.textComponent = this.addChild(new Component());
    }

    return textEl;
  }

  private disposeMessageTextComponent(elements: ChatMessageElements): void {
    if (!elements.textComponent) {
      return;
    }
    this.removeChild(elements.textComponent);
    elements.textComponent = null;
  }

  private fallbackToPlainText(container: HTMLElement, text: string): void {
    container.empty();
    container.removeClass("markdown-rendered");
    container.addClass("tmd-chat-pre");
    container.setText(text);
  }

  private removeText(elements: ChatMessageElements): void {
    this.disposeMessageTextComponent(elements);
    elements.textEl?.remove();
    elements.textEl = null;
    elements.textValue = null;
    elements.textMode = null;
    elements.textRenderToken += 1;
  }

  /** Re-renders a slot only when its signature changed, creating the host element on demand. */
  private syncSlot(
    elements: ChatMessageElements,
    slot: RenderSlot,
    cls: string,
    signature: string,
    render: (el: HTMLElement) => void,
  ): void {
    if (slot.el && slot.value === signature) {
      return;
    }
    const el = slot.el ?? elements.bubbleEl.createDiv({ cls });
    el.empty();
    render(el);
    slot.el = el;
    slot.value = signature;
  }

  private syncMessageAttachments(elements: ChatMessageElements, attachmentPaths: string[]): void {
    if (attachmentPaths.length === 0) {
      clearSlot(elements.attachments);
      return;
    }

    const signature = attachmentPaths.join("\n");
    this.syncSlot(
      elements,
      elements.attachments,
      "tmd-chat-message-attachments",
      signature,
      (el) => {
        for (const filePath of attachmentPaths) {
          const itemEl = el.createDiv({
            cls: "tmd-chat-message-attachment",
          });
          itemEl.setAttribute("title", getAttachmentFileName(filePath));
          setIcon(itemEl, "file");
        }
      },
    );
  }

  private syncLoading(elements: ChatMessageElements, text: string): void {
    this.syncSlot(elements, elements.loading, "tmd-chat-loading", text, (el) => {
      el.setText(text);
    });
  }

  private syncProcessLines(elements: ChatMessageElements, lines: string[]): void {
    if (lines.length === 0) {
      clearSlot(elements.process);
      return;
    }
    const signature = lines.join("\n");
    this.syncSlot(elements, elements.process, "tmd-chat-process", signature, (el) => {
      for (const line of lines) {
        el.createDiv({ cls: "tmd-chat-process-line", text: line });
      }
    });
  }

  private syncArtifacts(
    elements: ChatMessageElements,
    task: TaskRecord | null,
    resolvedArtifacts: ResolvedArtifactDiff[],
  ): void {
    this.ensureDefaultExpandedArtifact(task, resolvedArtifacts);
    const signature = this.buildArtifactsSignature(task?.id ?? "persisted", resolvedArtifacts);
    this.syncSlot(elements, elements.artifacts, "tmd-chat-artifacts-host", signature, (el) => {
      this.renderArtifacts(el, task, resolvedArtifacts);
    });
  }

  private syncArtifactsLoading(elements: ChatMessageElements, taskId: string): void {
    this.syncSlot(
      elements,
      elements.artifacts,
      "tmd-chat-artifacts-host",
      `${taskId}:loading`,
      (el) => {
        const card = el.createDiv({ cls: "tmd-diff-card tmd-diff-loading-card" });
        const summary = card.createDiv({ cls: "tmd-diff-summary" });
        const title = summary.createDiv({ cls: "tmd-diff-summary-title" });
        title.createSpan({
          cls: "tmd-diff-summary-count",
          text: "Preparing changes",
        });
        const body = card.createDiv({ cls: "tmd-diff-loading-body" });
        body.createDiv({ cls: "tmd-diff-loading-line is-wide" });
        body.createDiv({ cls: "tmd-diff-loading-line" });
        body.createDiv({ cls: "tmd-diff-loading-line is-short" });
      },
    );
  }

  private ensureDefaultExpandedArtifact(
    task: TaskRecord | null,
    resolvedArtifacts: ResolvedArtifactDiff[],
  ): void {
    if (resolvedArtifacts.length === 0) {
      return;
    }

    const groupKey = `${task?.id ?? "persisted"}:${resolvedArtifacts.map(({ artifact }) => artifact.id).join(",")}`;
    if (this.autoExpandedArtifactGroups.has(groupKey)) {
      return;
    }

    const hasExpandedArtifact = resolvedArtifacts.some(({ artifact }) =>
      this.expandedArtifactIds.has(artifact.id),
    );
    if (!hasExpandedArtifact) {
      this.expandedArtifactIds.add(resolvedArtifacts[0].artifact.id);
    }
    this.autoExpandedArtifactGroups.add(groupKey);
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
      onApplyAll: task ? () => this.plugin.taskEngine.applyAllArtifacts(task.id) : undefined,
      onToggleExpanded: (artifactId) => {
        if (this.expandedArtifactIds.has(artifactId)) {
          this.expandedArtifactIds.delete(artifactId);
        } else {
          this.expandedArtifactIds.add(artifactId);
        }
        this.host.triggerRender();
      },
    });
  }

  private syncApproval(
    elements: ChatMessageElements,
    task: TaskRecord,
    approval: NonNullable<ChatMessageRecord["runtime"]>["approval"],
  ): void {
    const signature = buildApprovalSignature(approval, task.id);
    this.syncSlot(elements, elements.approval, "tmd-chat-approval-host", signature, (el) => {
      if (approval) {
        renderApprovalCard(el, approval, (decision) => {
          this.respondToApproval(task.id, decision);
        });
      }
    });
  }

  private syncRuntimeDetails(elements: ChatMessageElements, message: ChatMessageRecord): void {
    if (!this.plugin.shouldShowChatRuntimeDetails() || message.status !== "streaming") {
      clearSlot(elements.runtimeDetails);
      return;
    }

    const telemetry = message.runtime?.telemetry;
    const sections = buildRuntimeDetailsSections(telemetry, {
      clampPreview,
      formatTime,
    });
    if (sections.length === 0) {
      clearSlot(elements.runtimeDetails);
      return;
    }

    const shouldOpen = shouldAutoExpandRuntimeDetails(message.status === "streaming", telemetry);
    const signature = sections.join("\n\n");
    this.syncSlot(
      elements,
      elements.runtimeDetails,
      "tmd-chat-runtime-details-host",
      signature,
      (el) => {
        renderRuntimeDetails(el, sections, shouldOpen);
      },
    );
  }

  private syncError(elements: ChatMessageElements, error: string): void {
    this.syncSlot(elements, elements.error, "tmd-error", error, (el) => {
      el.createSpan({ cls: "tmd-error-text", text: error });
      appendErrorReportLink(el, error, this.plugin);
    });
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
    ].join("|");
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
    ].join("|");
  }

  private respondToApproval(taskId: string, decision: RuntimeApprovalDecision): void {
    try {
      this.plugin.taskEngine.respondToTaskApproval(taskId, decision);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to send Ante approval");
    }
  }

  private syncMessageFooter(elements: ChatMessageElements, message: ChatMessageRecord): void {
    const footerEl = elements.footerEl;
    footerEl.empty();

    footerEl.createDiv({
      cls: "tmd-chat-stamp",
      text: formatTime(message.updatedAt || message.createdAt),
    });

    const actionsEl = footerEl.createDiv({ cls: "tmd-chat-message-actions" });
    const copyButton = actionsEl.createEl("button", {
      cls: "tmd-chat-message-action",
      attr: {
        "aria-label": "Copy message",
        title: "Copy message",
        type: "button",
      },
    });
    setIcon(copyButton, "copy");
    copyButton.disabled = !message.text.trim();
    copyButton.addEventListener("click", () => {
      void this.copyMessageText(message.text);
    });

    const refreshPrompt = this.host.getRefreshPrompt(message);
    if (refreshPrompt) {
      const refreshButton = actionsEl.createEl("button", {
        cls: "tmd-chat-message-action",
        attr: {
          "aria-label": "Refresh message",
          title: "Refresh message",
          type: "button",
        },
      });
      setIcon(refreshButton, "rotate-ccw");
      refreshButton.disabled = this.host.hasRunningTaskForConversation(
        refreshPrompt.conversationId,
      );
      refreshButton.addEventListener("click", () => {
        void this.host.refreshMessage(refreshPrompt).catch((error) => {
          new Notice(error instanceof Error ? error.message : "Failed to refresh message");
        });
      });
    }
  }

  private async copyMessageText(text: string): Promise<void> {
    if (!text.trim()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      new Notice("Copied message");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to copy message");
    }
  }

  refreshLoadingIndicators(messages: ChatMessageRecord[]): void {
    for (const message of messages) {
      if (message.status !== "streaming") {
        continue;
      }
      const elements = this.messageEls.get(message.id);
      if (!elements) {
        continue;
      }
      if (message.runtime?.approval) {
        clearSlot(elements.loading);
        continue;
      }
      this.syncLoading(elements, loadingLabelForMessage(message, this.host.getLoadingFrame()));
    }
  }

  scrollMessageToTop(messageId: string): void {
    const messageEl = this.messageEls.get(messageId)?.rootEl;
    if (!messageEl) {
      return;
    }
    this.timelineEl.scrollTop = Math.max(0, messageEl.offsetTop);
  }

  pruneResolvedArtifactCache(activeTaskIds: string[]): void {
    const active = new Set(activeTaskIds);
    for (const taskId of [...this.resolvedArtifactsCache.keys()]) {
      if (!active.has(taskId)) {
        this.resolvedArtifactsCache.delete(taskId);
      }
    }
    for (const taskId of [...this.pendingArtifactResolutions.keys()]) {
      if (!active.has(taskId)) {
        this.pendingArtifactResolutions.delete(taskId);
      }
    }
  }
}
