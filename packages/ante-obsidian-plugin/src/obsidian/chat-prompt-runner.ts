import { Notice } from "obsidian";
import type TmdPlugin from "./main";
import type { ChatMessageRecord, ChatStateSnapshot } from "../core/chat-types";
import type { ContextSnapshot, TmdState } from "../core/types";
import type { AnteThinkingPreference } from "../core/ante-thinking";
import { buildPromptWithAttachmentPaths, THINKING_LABELS } from "./chat-view-helpers";

export class ChatPromptRunner {
  constructor(
    private readonly plugin: TmdPlugin,
    private readonly getLatestChatState: () => ChatStateSnapshot | null,
    private readonly getLatestTaskState: () => TmdState | null,
    private readonly getLiveContext: () => ContextSnapshot | null,
    private readonly setLiveContext: (context: ContextSnapshot | null) => void,
    private readonly getSelectedRuntimeTarget: () => {
      provider: string;
      model: string;
      thinking: AnteThinkingPreference;
    },
    private readonly resolveConversationSendMode: (
      conversationId: string,
      target: { provider: string; model: string; thinking: AnteThinkingPreference },
    ) => {
      runtimeSessionId: string | null;
      requiresSessionRestart: boolean;
      switchedProvider: boolean;
      switchedModel: boolean;
      switchedThinking: boolean;
    },
    private readonly getSelectedAttachmentPaths: () => string[],
    private readonly clearSelectedAttachments: () => void,
    private readonly hasRunningTaskForConversation: (conversationId: string) => boolean,
    private readonly syncComposerActionButton: (hasRunningTask: boolean) => void,
    private readonly setShouldAutoScrollToBottom: (val: boolean) => void,
    private readonly composerEl: HTMLTextAreaElement,
  ) {}

  hasRunningChatTask(): boolean {
    return (this.getLatestTaskState()?.tasks ?? []).some(
      (task) => task.triggerSource === "chat" && task.status === "running",
    );
  }

  getRefreshPrompt(message: ChatMessageRecord): {
    conversationId: string;
    sourceRole: "user" | "assistant";
    prompt: string;
    context: ContextSnapshot | null;
    runtimeSessionId: string | null;
  } | null {
    const messages =
      this.getLatestChatState()?.messagesByConversation[message.conversationId] ?? [];
    if (messages.length === 0) {
      return null;
    }

    if (message.role === "user" && message.text.trim()) {
      return {
        conversationId: message.conversationId,
        sourceRole: "user",
        prompt: message.submissionText?.trim() || message.text,
        context: message.context ?? null,
        runtimeSessionId: this.plugin.chatManager.getConversationRuntimeSessionId(
          message.conversationId,
        ),
      };
    }

    const messageIndex = messages.findIndex(({ id }) => id === message.id);
    if (messageIndex <= 0) {
      return null;
    }
    for (let index = messageIndex - 1; index >= 0; index -= 1) {
      const candidate = messages[index];
      if (candidate?.role === "user" && candidate.text.trim()) {
        return {
          conversationId: message.conversationId,
          sourceRole: "assistant",
          prompt: candidate.submissionText?.trim() || candidate.text,
          context: candidate.context ?? null,
          runtimeSessionId: this.plugin.chatManager.getConversationRuntimeSessionId(
            message.conversationId,
          ),
        };
      }
    }
    return null;
  }

  async refreshMessage(request: {
    conversationId: string;
    sourceRole: "user" | "assistant";
    prompt: string;
    context: ContextSnapshot | null;
    runtimeSessionId: string | null;
  }): Promise<void> {
    if (!this.plugin.ensureAnteInstalled("Chat with Ante")) {
      return;
    }
    if (this.hasRunningTaskForConversation(request.conversationId)) {
      new Notice("Stop the active chat task before refreshing a message");
      return;
    }

    this.setShouldAutoScrollToBottom(true);
    const taskId = crypto.randomUUID();
    let userMessageId = "";
    let createdConversation = false;

    if (request.sourceRole === "user") {
      const pendingSend = this.plugin.chatManager.appendUserPrompt(request.prompt, request.context);
      userMessageId = pendingSend.userMessageId;
      createdConversation = pendingSend.createdConversation;
    }

    const runtimeTarget = this.getSelectedRuntimeTarget();
    const sendMode = this.resolveConversationSendMode(request.conversationId, runtimeTarget);
    this.plugin.chatManager.createAssistantTurn(request.conversationId, taskId);
    if (sendMode.requiresSessionRestart) {
      await this.plugin.persistIdleAnteSession();
    }
    const restartNoticeText = sendMode.switchedProvider
      ? `Provider changed to ${runtimeTarget.provider}. Starting a new session for this turn.`
      : sendMode.switchedModel
        ? `Model changed to ${runtimeTarget.model}. Starting a new session for this turn.`
        : sendMode.switchedThinking
          ? `Think level changed to ${THINKING_LABELS[runtimeTarget.thinking]}. Starting a new session for this turn.`
          : null;
    const restartNoticeId = restartNoticeText
      ? this.plugin.chatManager.appendAssistantNotice(request.conversationId, restartNoticeText)
      : null;
    try {
      await this.plugin.taskEngine.queueChatTask(
        taskId,
        request.prompt,
        Boolean(sendMode.runtimeSessionId),
        request.context,
        sendMode.runtimeSessionId,
        runtimeTarget,
      );
      this.plugin.chatManager.setConversationRuntimeTarget(request.conversationId, runtimeTarget);
    } catch (error) {
      const removedTaskIds = this.plugin.chatManager.rollbackPendingSend(
        request.conversationId,
        userMessageId,
        taskId,
        createdConversation,
        restartNoticeId ? [restartNoticeId] : [],
      );
      this.plugin.taskEngine.clearTasks(removedTaskIds);
      throw error;
    }
  }

  runPrompt(): void {
    const prompt = this.composerEl.value.trim();
    const attachmentPaths = [...this.getSelectedAttachmentPaths()];
    if (!prompt && attachmentPaths.length === 0) {
      return;
    }
    if (!this.plugin.ensureAnteInstalled("Chat with Ante")) {
      return;
    }
    const composedPrompt = buildPromptWithAttachmentPaths(prompt, attachmentPaths);
    const visiblePrompt = prompt;
    this.setShouldAutoScrollToBottom(true);

    const runtimeTarget = this.getSelectedRuntimeTarget();

    void this.plugin.hostAdapter
      .capturePreferredContext()
      .then(async (contextSnapshot) => {
        this.setLiveContext(contextSnapshot);
        const taskId = crypto.randomUUID();
        const pendingSend = this.plugin.chatManager.appendUserPrompt(
          visiblePrompt,
          contextSnapshot,
          composedPrompt,
          attachmentPaths,
        );
        const sendMode = this.resolveConversationSendMode(
          pendingSend.conversation.id,
          runtimeTarget,
        );
        if (sendMode.requiresSessionRestart) {
          await this.plugin.persistIdleAnteSession();
        }
        const restartNoticeText = sendMode.switchedProvider
          ? `Provider changed to ${runtimeTarget.provider}. Starting a new session for this turn.`
          : sendMode.switchedModel
            ? `Model changed to ${runtimeTarget.model}. Starting a new session for this turn.`
            : sendMode.switchedThinking
              ? `Think level changed to ${THINKING_LABELS[runtimeTarget.thinking]}. Starting a new session for this turn.`
              : null;
        const restartNoticeId = restartNoticeText
          ? this.plugin.chatManager.appendAssistantNotice(
              pendingSend.conversation.id,
              restartNoticeText,
            )
          : null;
        this.plugin.chatManager.createAssistantTurn(pendingSend.conversation.id, taskId);
        try {
          await this.plugin.taskEngine.queueChatTask(
            taskId,
            composedPrompt,
            Boolean(sendMode.runtimeSessionId),
            contextSnapshot,
            sendMode.runtimeSessionId,
            runtimeTarget,
          );
          this.plugin.chatManager.setConversationRuntimeTarget(
            pendingSend.conversation.id,
            runtimeTarget,
          );
        } catch (error) {
          const removedTaskIds = this.plugin.chatManager.rollbackPendingSend(
            pendingSend.conversation.id,
            pendingSend.userMessageId,
            taskId,
            pendingSend.createdConversation,
            restartNoticeId ? [restartNoticeId] : [],
          );
          this.plugin.taskEngine.clearTasks(removedTaskIds);
          throw error;
        }
      })
      .then(() => {
        this.composerEl.value = "";
        this.clearSelectedAttachments();
        this.syncComposerActionButton(this.hasRunningChatTask());
      })
      .catch((error) => {
        new Notice(error instanceof Error ? error.message : "Failed to start Ante chat");
      });
  }
}
