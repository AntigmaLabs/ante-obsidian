import { App, Menu, Notice } from "obsidian"
import type TmdPlugin from "./main"
import {
  DEFAULT_ANTE_MODEL,
  normalizeProvider,
  type AnteProvider,
  AVAILABLE_PROVIDERS,
} from "./settings"
import {
  ANTE_DEFAULT_THINKING,
  ANTE_THINKING_LEVELS,
  resolveAnteThinkingPreference,
  type AnteThinkingPreference,
} from "../core/ante-thinking"
import { ChatProviderSwitchModal } from "./chat-provider-switch-modal"
import {
  PROVIDER_LABELS,
  THINKING_LABELS,
} from "./chat-view-helpers"
import type { ContextSnapshot } from "../core/types"

export class ChatViewControls {
  private selectedProvider: AnteProvider = "openai-subscription"
  private selectedModel = DEFAULT_ANTE_MODEL
  private selectedThinking: AnteThinkingPreference = ANTE_DEFAULT_THINKING
  private loadingModelProvider: string | null = null
  private modelLoadFailedProvider: string | null = null

  constructor(
    private readonly app: App,
    private readonly plugin: TmdPlugin,
    private readonly providerButtonEl: HTMLButtonElement,
    private readonly modelButtonEl: HTMLButtonElement,
    private readonly thinkingButtonEl: HTMLButtonElement,
    private readonly getLiveContext: () => ContextSnapshot | null,
    private readonly getActiveConversationId: () => string | null,
  ) {}

  initializeRuntimeTargetControls(): void {
    const resolvedTarget = this.plugin.getResolvedAnteTarget()
    this.selectedProvider = normalizeProvider(resolvedTarget.provider)
    this.selectedModel = this.getSelectableModel(this.selectedProvider, resolvedTarget.model)
    this.selectedThinking = this.plugin.settings.anteThinking

    this.populateProviderSelect()
    this.populateModelSelect()
    this.populateThinkingSelect()

    this.providerButtonEl.addEventListener("click", (event) => {
      const menu = new Menu()
      const providers: AnteProvider[] = AVAILABLE_PROVIDERS.map(p => p.id)
      for (const provider of providers) {
        menu.addItem((item) => {
          item
            .setTitle(PROVIDER_LABELS[provider])
            .setChecked(provider === this.selectedProvider)
            .onClick(() => {
              if (provider === this.selectedProvider) {
                return
              }
              new ChatProviderSwitchModal(
                this.app,
                PROVIDER_LABELS[provider],
                () => {
                  this.switchProviderConversation(provider).catch((error) => {
                    console.error("Failed to switch provider conversation:", error)
                  })
                },
              ).open()
            })
        })
      }
      menu.showAtMouseEvent(event)
    })

    this.modelButtonEl.addEventListener("click", (event) => {
      const menu = new Menu()
      const models = this.plugin.getModelNamesForProvider(this.selectedProvider, this.selectedModel)
      for (const model of models) {
        menu.addItem((item) => {
          item
            .setTitle(model)
            .setChecked(model === this.selectedModel)
            .onClick(() => {
              this.selectedModel = model
              this.populateModelSelect()
              const activeConvId = this.getActiveConversationId()
              if (activeConvId) {
                this.plugin.chatManager.setConversationRuntimeTarget(activeConvId, {
                  provider: this.selectedProvider,
                  model: this.selectedModel,
                  thinking: this.selectedThinking,
                })
              }
            })
        })
      }
      if (models.length === 0) {
        menu.addItem((item) => {
          item
            .setTitle(
              this.modelLoadFailedProvider === this.selectedProvider
                ? "Failed to load models from Ante"
                : "Loading models from Ante"
            )
            .setDisabled(true)
        })
      }
      menu.showAtMouseEvent(event)
    })

    this.thinkingButtonEl.addEventListener("click", (event) => {
      const menu = new Menu()
      menu.addItem((item) => {
        item.setTitle("Thinking level").setDisabled(true)
      })
      menu.addItem((item) => {
        item
          .setTitle(THINKING_LABELS[ANTE_DEFAULT_THINKING])
          .setChecked(this.selectedThinking === ANTE_DEFAULT_THINKING)
          .onClick(() => {
            this.selectedThinking = ANTE_DEFAULT_THINKING
            this.populateThinkingSelect()
            const activeConvId = this.getActiveConversationId()
            if (activeConvId) {
              this.plugin.chatManager.setConversationRuntimeTarget(activeConvId, {
                provider: this.selectedProvider,
                model: this.selectedModel,
                thinking: this.selectedThinking,
              })
            }
          })
      })
      for (const thinking of ANTE_THINKING_LEVELS) {
        menu.addItem((item) => {
          item
            .setTitle(THINKING_LABELS[thinking])
            .setChecked(thinking === this.selectedThinking)
            .onClick(() => {
              this.selectedThinking = thinking
              this.populateThinkingSelect()
              const activeConvId = this.getActiveConversationId()
              if (activeConvId) {
                this.plugin.chatManager.setConversationRuntimeTarget(activeConvId, {
                  provider: this.selectedProvider,
                  model: this.selectedModel,
                  thinking: this.selectedThinking,
                })
              }
            })
        })
      }
      menu.showAtMouseEvent(event)
    })
  }

  populateProviderSelect(): void {
    this.providerButtonEl.setText(PROVIDER_LABELS[this.selectedProvider])
    this.providerButtonEl.setAttribute(
      "title",
      PROVIDER_LABELS[this.selectedProvider],
    )
  }

  populateModelSelect(): void {
    const label =
      this.loadingModelProvider === this.selectedProvider
        ? "Loading models..."
        : this.modelLoadFailedProvider === this.selectedProvider
          ? "Models unavailable"
          : this.selectedModel || "Models not loaded"
    this.modelButtonEl.setText(label)
    this.modelButtonEl.setAttribute("title", label)
  }

  getSelectableModel(provider: string, preferredModel: string): string {
    const availableModels = this.plugin.getAvailableModelNamesForProvider(provider)
    const preferred = preferredModel.trim()
    if (preferred && availableModels.includes(preferred)) {
      return preferred
    }
    if (availableModels.length > 0) {
      return availableModels[0] ?? DEFAULT_ANTE_MODEL
    }
    return preferred
  }

  async switchProviderConversation(provider: AnteProvider): Promise<void> {
    if (!this.plugin.ensureAnteInstalled("Chat with Ante")) {
      return
    }
    const previousProvider = this.selectedProvider
    const previousModel = this.selectedModel
    const previousThinking = this.selectedThinking

    this.loadingModelProvider = provider
    this.modelLoadFailedProvider = null
    this.populateModelSelect()

    try {
      const conversation = await this.plugin.createChatConversation(this.getLiveContext(), { forceNew: true })
      this.plugin.chatManager.setConversationRuntimeTarget(conversation.id, {
        provider,
        model: "",
        thinking: this.selectedThinking,
      })
      this.selectedProvider = provider
      this.selectedModel = ""
      this.populateProviderSelect()
      this.populateModelSelect()
      this.populateThinkingSelect()
      try {
        await this.plugin.warmAnteModelCatalog({
          provider,
          model: "",
          thinking: this.selectedThinking,
        })
        if (this.selectedProvider !== provider) {
          return
        }
        this.loadingModelProvider = null
        this.selectedModel = this.getSelectableModel(provider, "")
        this.plugin.chatManager.setConversationRuntimeTarget(conversation.id, {
          provider,
          model: this.selectedModel,
          thinking: this.selectedThinking,
        })
        this.populateModelSelect()
      } catch (error) {
        if (this.selectedProvider !== provider) {
          return
        }
        this.loadingModelProvider = null
        this.modelLoadFailedProvider = provider
        this.populateModelSelect()
        new Notice(error instanceof Error ? error.message : "Failed to load Ante models")
      }
    } catch (error) {
      this.loadingModelProvider = null
      this.selectedProvider = previousProvider
      this.selectedModel = previousModel
      this.selectedThinking = previousThinking
      this.populateProviderSelect()
      this.populateModelSelect()
      this.populateThinkingSelect()
      new Notice(error instanceof Error ? error.message : "Failed to switch provider conversation")
    }
  }

  populateThinkingSelect(): void {
    this.thinkingButtonEl.setText(THINKING_LABELS[this.selectedThinking])
    this.thinkingButtonEl.setAttribute("title", THINKING_LABELS[this.selectedThinking])
  }

  getSelectedRuntimeTarget(): {
    provider: string
    model: string
    thinking: AnteThinkingPreference
  } {
    return {
      provider: this.selectedProvider,
      model: this.selectedModel,
      thinking: this.selectedThinking,
    }
  }

  syncRuntimeTargetControls(conversationId: string | null): void {
    const conversationTarget = conversationId
      ? this.plugin.chatManager.getConversationRuntimeTarget(conversationId)
      : null
    const fallbackTarget = this.plugin.getResolvedAnteTarget()
    const provider = normalizeProvider(
      conversationTarget?.provider ?? fallbackTarget.provider
    )
    const model = this.getSelectableModel(provider, conversationTarget?.model ?? fallbackTarget.model)
    const thinking =
      conversationTarget?.thinking ?? this.plugin.settings.anteThinking

    const changed =
      provider !== this.selectedProvider ||
      model !== this.selectedModel ||
      thinking !== this.selectedThinking
    if (!changed) {
      return
    }

    this.selectedProvider = provider
    this.selectedModel = model
    this.selectedThinking = thinking
    this.populateProviderSelect()
    this.populateModelSelect()
    this.populateThinkingSelect()
  }

  resolveConversationSendMode(
    conversationId: string,
    target: { provider: string; model: string; thinking: AnteThinkingPreference }
  ): {
    runtimeSessionId: string | null
    requiresSessionRestart: boolean
    switchedProvider: boolean
    switchedModel: boolean
    switchedThinking: boolean
  } {
    const currentTarget =
      this.plugin.chatManager.getConversationRuntimeTarget(conversationId)
    const runtimeSessionId =
      this.plugin.chatManager.getConversationRuntimeSessionId(conversationId)
    const currentThinkingPreference =
      currentTarget?.thinking ?? this.plugin.settings.anteThinking
    const currentThinking =
      currentThinkingPreference === ANTE_DEFAULT_THINKING
        ? this.plugin.getResolvedAnteThinking()
        : resolveAnteThinkingPreference(currentThinkingPreference)
    const nextThinking =
      target.thinking === ANTE_DEFAULT_THINKING
        ? this.plugin.getResolvedAnteThinking()
        : resolveAnteThinkingPreference(target.thinking)

    if (
      runtimeSessionId &&
      ((currentTarget?.provider &&
        currentTarget.provider !== target.provider) ||
        (currentTarget?.model &&
          currentTarget.model !== target.model) ||
        currentThinking !== nextThinking)
    ) {
      return {
        runtimeSessionId: null,
        requiresSessionRestart: true,
        switchedProvider: Boolean(
          currentTarget?.provider && currentTarget.provider !== target.provider
        ),
        switchedModel: Boolean(
          currentTarget?.model && currentTarget.model !== target.model
        ),
        switchedThinking: currentThinking !== nextThinking,
      }
    }

    return {
      runtimeSessionId,
      requiresSessionRestart: false,
      switchedProvider: false,
      switchedModel: false,
      switchedThinking: false,
    }
  }
}
