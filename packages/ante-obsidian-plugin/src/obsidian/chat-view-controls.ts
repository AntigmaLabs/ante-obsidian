import { App, Menu, Notice, setIcon } from "obsidian"
import type TmdPlugin from "./main"
import {
  normalizeProvider,
  type AnteProvider,
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
  private selectedModel = ""
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

  private showMenu(menu: Menu, buttonEl: HTMLButtonElement, event: MouseEvent): void {
    if (event && event.clientX !== 0 && event.clientY !== 0) {
      menu.showAtMouseEvent(event)
    } else {
      const rect = buttonEl.getBoundingClientRect()
      menu.showAtPosition({
        x: rect.left,
        y: rect.bottom,
      })
    }
  }

  initializeRuntimeTargetControls(): void {
    const resolvedTarget = this.plugin.getResolvedAnteTarget()
    this.selectedProvider = normalizeProvider(resolvedTarget.provider)
    this.selectedModel = this.getSelectableModel(this.selectedProvider, resolvedTarget.model)
    this.selectedThinking = this.plugin.settings.anteThinking

    this.populateProviderSelect()
    this.populateModelSelect()
    this.populateThinkingSelect()

    // Warm the model catalog for the initial provider so the model list
    // is populated before the user opens the model picker.
    if (!this.plugin.getAvailableModelNamesForProvider(this.selectedProvider).length) {
      this.loadingModelProvider = this.selectedProvider
      this.populateModelSelect()
      this.plugin.warmAnteModelCatalog({
        provider: this.selectedProvider,
        model: this.selectedModel,
        thinking: this.selectedThinking,
      }).then(() => {
        if (this.loadingModelProvider !== this.selectedProvider) return
        this.loadingModelProvider = null
        const best = this.getSelectableModel(this.selectedProvider, this.selectedModel)
        if (best && best !== this.selectedModel) {
          this.selectedModel = best
        }
        this.populateModelSelect()
      }).catch(() => {
        if (this.loadingModelProvider !== this.selectedProvider) return
        this.loadingModelProvider = null
        this.modelLoadFailedProvider = this.selectedProvider
        this.populateModelSelect()
      })
    }

    this.providerButtonEl.addEventListener("click", (event) => {
      const menu = new Menu()
      const configuredProviders = this.plugin.getConfiguredProviders()
      for (const providerMeta of configuredProviders) {
        const providerId = providerMeta.id
        const label = PROVIDER_LABELS[providerId] ?? providerMeta.label
        menu.addItem((item) => {
          item
            .setTitle(label)
            .setChecked(providerId === this.selectedProvider)
            .onClick(() => {
              if (providerId === this.selectedProvider) {
                return
              }
              new ChatProviderSwitchModal(
                this.app,
                label,
                () => {
                  this.switchProviderConversation(providerId).catch((error) => {
                    console.error("Failed to switch provider conversation:", error)
                  })
                },
              ).open()
            })
        })
      }
      this.showMenu(menu, this.providerButtonEl, event)
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
      this.showMenu(menu, this.modelButtonEl, event)
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
      this.showMenu(menu, this.thinkingButtonEl, event)
    })
  }

  populateProviderSelect(): void {
    const label = PROVIDER_LABELS[this.selectedProvider] ?? this.selectedProvider
    this.providerButtonEl.setText(label)
    this.providerButtonEl.setAttribute("title", label)
  }

  populateModelSelect(): void {
    const rawLabel =
      this.loadingModelProvider === this.selectedProvider
        ? "Loading models..."
        : this.modelLoadFailedProvider === this.selectedProvider
          ? "Models unavailable"
          : this.selectedModel || "Models not loaded"

    // Strip provider prefix (e.g. 'google/gemini' -> 'gemini') for display purposes only
    let displayLabel = rawLabel;
    if (displayLabel && displayLabel.includes("/") && !displayLabel.startsWith("http")) {
      displayLabel = displayLabel.split("/").pop() ?? displayLabel;
    }

    this.modelButtonEl.setText(displayLabel)
    this.modelButtonEl.setAttribute("title", rawLabel)
  }

  getSelectableModel(provider: string, preferredModel: string): string {
    const availableModels = this.plugin.getAvailableModelNamesForProvider(provider)
    const preferred = preferredModel.trim()
    if (preferred && availableModels.includes(preferred)) {
      return preferred
    }
    if (availableModels.length > 0) {
      // Pick first cached model for this provider — do NOT fall back to a
      // cross-provider default like gpt-5.4, which would cause ante to reject
      // the session when the active provider doesn't support that model.
      return availableModels[0]!
    }
    // No cache yet — return empty string so ante picks the provider's own default.
    return ""
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
    const label = THINKING_LABELS[this.selectedThinking]
    this.thinkingButtonEl.setText(label)
    this.thinkingButtonEl.setAttribute("title", label)
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
    // When syncing, use the conversation's own model if present. If absent (new
    // conversation) or if the provider has changed, resolve via the provider's
    // own cache — never inherit a model from a different provider.
    const rawModel = conversationTarget?.model ?? ""
    const model = this.getSelectableModel(provider, rawModel)
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
