import { DropdownComponent, Modal, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import { listResolvedPresets } from "../core/presets";
import type TmdPlugin from "./main";
import {
  type AnteConnectionMode,
  ANTHROPIC_PROVIDER,
  GEMINI_PROVIDER,
  OPENAI_PROVIDER,
  PROVIDER_MODELS,
  getDefaultModelForProvider,
  normalizeProvider
} from "./settings";

export class TmdSettingTab extends PluginSettingTab {
  private draggingPresetId: string | null = null;

  constructor(private readonly pluginRef: TmdPlugin) {
    super(pluginRef.app, pluginRef);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Ante Obsidian Settings" });

    new Setting(containerEl)
      .setName("Ante connection mode")
      .setDesc("Choose whether Ante Obsidian talks to Ante over stdin/stdout or WebSocket.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("stdio", "Local STDIO")
          .addOption("websocket", "WebSocket")
          .setValue(this.pluginRef.settings.connectionMode)
          .onChange(async (value) => {
            this.pluginRef.settings.connectionMode = this.normalizeConnectionMode(value);
            await this.pluginRef.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName("Ante command")
      .setDesc(
        this.pluginRef.resolvedAnteCommand
          ? `Executable used to launch Ante. Default: \`ante\`. Auto-detected current path: \`${this.pluginRef.resolvedAnteCommand}\`.`
          : 'Executable used to launch Ante. Default: `ante`.'
      )
      .addText((text) =>
        text.setValue(this.pluginRef.settings.command).onChange(async (value) => {
          this.pluginRef.settings.command = value.trim();
          await this.pluginRef.saveSettings();
        })
      );

    if (this.pluginRef.settings.connectionMode === "stdio") {
      new Setting(containerEl)
        .setName("Ante arguments JSON")
        .setDesc('JSON string array passed to Ante. Default: `["serve","--stdio","--yolo"]`.')
        .addTextArea((text) =>
          text.setValue(this.pluginRef.settings.argsJson).onChange(async (value) => {
            this.pluginRef.settings.argsJson = value;
            await this.pluginRef.saveSettings();
          })
        );
    } else {
      new Setting(containerEl)
        .setName("Ante WebSocket address")
        .setDesc("Socket address passed to `ante serve --ws`. Example: `127.0.0.1:8765`.")
        .addText((text) =>
          text.setPlaceholder("127.0.0.1:8765").setValue(this.pluginRef.settings.wsAddress).onChange(async (value) => {
            this.pluginRef.settings.wsAddress = value.trim() || "127.0.0.1:8765";
            await this.pluginRef.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName("Ante arguments JSON")
        .setDesc('Additional JSON string array passed to Ante. Transport flags are managed by Ante Obsidian in WebSocket mode, so keep only extras such as `["--yolo"]`.')
        .addTextArea((text) =>
          text.setValue(this.pluginRef.settings.argsJson).onChange(async (value) => {
            this.pluginRef.settings.argsJson = value;
            await this.pluginRef.saveSettings();
          })
        );
    }

    new Setting(containerEl)
      .setName("Working directory")
      .setDesc("Optional working directory used when launching Ante. Leave empty to inherit the current environment.")
      .addText((text) =>
        text.setValue(this.pluginRef.settings.cwd).onChange(async (value) => {
          this.pluginRef.settings.cwd = value;
          await this.pluginRef.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Auto-approve Ante tools")
      .setDesc("Automatically approve Ante tool calls inside Ante Obsidian. Default: on.")
      .addToggle((toggle) =>
        toggle.setValue(this.pluginRef.settings.autoApproveAnteTools).onChange(async (value) => {
          this.pluginRef.settings.autoApproveAnteTools = value;
          await this.pluginRef.saveSettings();
        })
      );

    const resolvedAnteTarget = this.pluginRef.getResolvedAnteTarget();

    new Setting(containerEl)
      .setName("Use Ante defaults")
      .setDesc(`Read provider/model from ~/.ante/settings.json. Current detected: \`${resolvedAnteTarget.provider}\` / \`${resolvedAnteTarget.model}\`.`)
      .addToggle((toggle) =>
        toggle.setValue(this.pluginRef.settings.useAnteDefaults).onChange(async (value) => {
          this.pluginRef.settings.useAnteDefaults = value;
          await this.pluginRef.saveSettings();
          this.display();
        })
      );

    if (!this.pluginRef.settings.useAnteDefaults) {
      new Setting(containerEl)
        .setName("Ante provider")
        .setDesc("Matches Ante provider naming. `openai-subscription` uses your ChatGPT subscription; `gemini` uses Gemini API credentials.")
        .addDropdown((dropdown) =>
          dropdown
            .addOption(OPENAI_PROVIDER, "OpenAI Subscription")
            .addOption(GEMINI_PROVIDER, "Gemini API")
            .addOption(ANTHROPIC_PROVIDER, "Anthropic API")
            .setValue(this.pluginRef.settings.anteProvider)
            .onChange(async (value) => {
              const provider = normalizeProvider(value);
              this.pluginRef.settings.anteProvider = provider;
              this.pluginRef.settings.anteModel = getDefaultModelForProvider(provider);
              await this.pluginRef.saveSettings();
              this.display();
            })
        );

      new Setting(containerEl)
        .setName("Ante model")
        .setDesc("Model options follow the selected Ante provider.")
        .addDropdown((dropdown) =>
          this.addModelOptions(dropdown)
            .setValue(this.getSelectedModel())
            .onChange(async (value) => {
              this.pluginRef.settings.anteModel = value;
              await this.pluginRef.saveSettings();
            })
        );
    }

    if ((this.pluginRef.settings.useAnteDefaults ? resolvedAnteTarget.provider : this.pluginRef.settings.anteProvider) === GEMINI_PROVIDER) {
      new Setting(containerEl)
        .setName("Gemini env key")
        .setDesc("Ante expects Gemini auth via header `x-goog-api-key` sourced from this environment variable. Default: `GEMINI_API_KEY`.")
        .addText((text) =>
          text.setPlaceholder("GEMINI_API_KEY").setValue(this.pluginRef.settings.geminiApiKeyEnvKey).onChange(async (value) => {
            this.pluginRef.settings.geminiApiKeyEnvKey = value.trim() || "GEMINI_API_KEY";
            await this.pluginRef.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName("Gemini API key")
        .setDesc("Optional local override. Leave empty to reuse the key already available to Ante in your environment.")
        .addText((text) => {
          text.inputEl.type = "password";
          text.setPlaceholder("AIza...");
          text.setValue(this.pluginRef.settings.geminiApiKey);
          text.onChange(async (value) => {
            this.pluginRef.settings.geminiApiKey = value.trim();
            await this.pluginRef.saveSettings();
          });
        });
    }

    this.renderPresetSection(containerEl);

    new Setting(containerEl)
      .setName("Mention trigger debug")
      .setDesc("Show a Notice when a mention trigger is detected.")
      .addToggle((toggle) =>
        toggle.setValue(this.pluginRef.settings.mentionTriggerDebug).onChange(async (value) => {
          this.pluginRef.settings.mentionTriggerDebug = value;
          await this.pluginRef.saveSettings();
        })
      );
  }

  private renderPresetSection(containerEl: HTMLElement): void {
    const sectionEl = containerEl.createDiv({ cls: "tmd-preset-section" });
    const headerRow = sectionEl.createDiv({ cls: "tmd-preset-toolbar" });
    const titleGroup = headerRow.createDiv({ cls: "tmd-preset-toolbar-copy" });
    titleGroup.createEl("h3", { text: "Presets", cls: "tmd-preset-title" });

    const summary = titleGroup.createEl("p", { cls: "tmd-preset-summary" });
    summary.setText("Visible presets appear in the editor context menu. Built-in presets can be reordered or hidden.");

    const newPresetButton = headerRow.createEl("button", { text: "New preset", cls: "mod-cta" });
    newPresetButton.addClass("tmd-preset-new-button");
    newPresetButton.addEventListener("click", () => {
      new CustomPresetModal(this.pluginRef, () => this.display()).open();
    });

    const presets = listResolvedPresets(this.pluginRef.settings);
    const listEl = sectionEl.createDiv({ cls: "tmd-preset-list" });

    for (const preset of presets) {
      const isBuiltin = preset.source === "builtin";
      const typeLabel = isBuiltin ? "Built-in" : "Custom";
      const statusLabel = preset.enabled !== false ? "Visible" : "Hidden";
      const rowEl = listEl.createDiv({ cls: "tmd-preset-row" });
      rowEl.dataset.presetId = preset.id;
      const handleEl = rowEl.createDiv({ cls: "tmd-preset-handle" });
      handleEl.setAttribute("aria-label", `Drag to reorder ${preset.label}`);
      handleEl.draggable = true;
      for (let index = 0; index < 9; index += 1) {
        handleEl.createSpan({ cls: "tmd-preset-handle-dot" });
      }

      handleEl.addEventListener("dragstart", (event) => {
        this.draggingPresetId = preset.id;
        rowEl.addClass("is-dragging");
        event.dataTransfer?.setData("text/plain", preset.id);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
        }
      });

      handleEl.addEventListener("dragend", () => {
        this.draggingPresetId = null;
        this.clearPresetDragStyles(listEl);
      });

      rowEl.addEventListener("dragover", (event) => {
        if (!this.draggingPresetId || this.draggingPresetId === preset.id) {
          return;
        }
        event.preventDefault();
        this.clearPresetDragStyles(listEl);
        rowEl.addClass("is-drop-target");
        const rect = rowEl.getBoundingClientRect();
        rowEl.toggleClass("is-drop-after", event.clientY >= rect.top + rect.height / 2);
      });

      rowEl.addEventListener("dragleave", () => {
        rowEl.removeClass("is-drop-target", "is-drop-after");
      });

      rowEl.addEventListener("drop", async (event) => {
        if (!this.draggingPresetId || this.draggingPresetId === preset.id) {
          return;
        }
        event.preventDefault();
        const rect = rowEl.getBoundingClientRect();
        const insertAfter = event.clientY >= rect.top + rect.height / 2;
        await this.reorderPreset(this.draggingPresetId, preset.id, insertAfter);
      });

      const contentEl = rowEl.createDiv({ cls: "tmd-preset-content" });
      const copyEl = contentEl.createDiv({ cls: "tmd-preset-copy" });
      copyEl.createDiv({ cls: "tmd-preset-name", text: preset.label });
      copyEl.createDiv({ cls: "tmd-preset-meta", text: `${typeLabel} · ${statusLabel}` });

      const controlsEl = contentEl.createDiv({ cls: "tmd-preset-controls" });
      const toggleSetting = new Setting(controlsEl);
      toggleSetting.settingEl.addClass("tmd-preset-toggle-setting");
      toggleSetting.addToggle((toggle) =>
        toggle.setValue(preset.enabled !== false).onChange(async (value) => {
          await this.setPresetEnabled(preset.id, value, isBuiltin);
        })
      );

      const editButton = controlsEl.createEl("button", { cls: "clickable-icon" });
      editButton.addClass("tmd-preset-icon-button");
      if (isBuiltin) {
        editButton.disabled = true;
        editButton.setAttribute("aria-label", "Built-in preset content is fixed");
        setIcon(editButton, "lock");
      } else {
        editButton.setAttribute("aria-label", `Edit ${preset.label}`);
        setIcon(editButton, "pencil");
        editButton.addEventListener("click", () => {
          new CustomPresetModal(
            this.pluginRef,
            () => this.display(),
            this.pluginRef.settings.customPresets.find((entry) => entry.id === preset.id) ?? null
          ).open();
        });
      }

      const deleteButton = controlsEl.createEl("button", { cls: "clickable-icon" });
      deleteButton.addClass("tmd-preset-icon-button");
      if (isBuiltin) {
        deleteButton.disabled = true;
        deleteButton.setAttribute("aria-label", "Built-in preset cannot be deleted");
        setIcon(deleteButton, "minus");
      } else {
        deleteButton.setAttribute("aria-label", `Delete ${preset.label}`);
        setIcon(deleteButton, "trash");
        deleteButton.addEventListener("click", async () => {
          await this.deleteCustomPreset(preset.id);
        });
      }
    }
  }

  private async setPresetEnabled(presetId: string, enabled: boolean, isBuiltin: boolean): Promise<void> {
    if (isBuiltin) {
      const preset = this.pluginRef.settings.builtinPresetPreferences.find((entry) => entry.id === presetId);
      if (preset) {
        preset.enabled = enabled;
      }
    } else {
      const preset = this.pluginRef.settings.customPresets.find((entry) => entry.id === presetId);
      if (preset) {
        preset.enabled = enabled;
      }
    }
    await this.pluginRef.saveSettings();
    this.display();
  }

  private async reorderPreset(sourcePresetId: string, targetPresetId: string, insertAfter: boolean): Promise<void> {
    const ordered = listResolvedPresets(this.pluginRef.settings);
    const sourceIndex = ordered.findIndex((preset) => preset.id === sourcePresetId);
    const targetIndex = ordered.findIndex((preset) => preset.id === targetPresetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
      return;
    }

    const [moved] = ordered.splice(sourceIndex, 1);
    const adjustedTargetIndex = ordered.findIndex((preset) => preset.id === targetPresetId);
    const insertionIndex = insertAfter ? adjustedTargetIndex + 1 : adjustedTargetIndex;
    ordered.splice(insertionIndex, 0, moved);

    this.applyPresetOrder(ordered);
    await this.pluginRef.saveSettings();
    this.draggingPresetId = null;
    this.display();
  }

  private async deleteCustomPreset(presetId: string): Promise<void> {
    const preset = this.pluginRef.settings.customPresets.find((entry) => entry.id === presetId);
    if (!preset) {
      return;
    }

    if (!preset.instruction.trim() || window.confirm(`Delete custom preset "${preset.name}"?`)) {
      this.pluginRef.settings.customPresets = this.pluginRef.settings.customPresets.filter((entry) => entry.id !== presetId);
      this.applyPresetOrder();
      await this.pluginRef.saveSettings();
      this.display();
      return;
    }

    new Notice("Deletion cancelled");
  }

  private applyPresetOrder(ordered = listResolvedPresets(this.pluginRef.settings)): void {
    ordered.forEach((preset, sortOrder) => {
      if (preset.source === "builtin") {
        const builtin = this.pluginRef.settings.builtinPresetPreferences.find((entry) => entry.id === preset.id);
        if (builtin) {
          builtin.sortOrder = sortOrder;
        }
      } else {
        const custom = this.pluginRef.settings.customPresets.find((entry) => entry.id === preset.id);
        if (custom) {
          custom.sortOrder = sortOrder;
        }
      }
    });
    this.pluginRef.settings.builtinPresetPreferences.sort((left, right) => left.sortOrder - right.sortOrder);
    this.pluginRef.settings.customPresets.sort((left, right) => left.sortOrder - right.sortOrder);
  }

  private clearPresetDragStyles(listEl: HTMLElement): void {
    for (const row of Array.from(listEl.querySelectorAll<HTMLElement>(".tmd-preset-row"))) {
      row.removeClass("is-dragging", "is-drop-target", "is-drop-after");
    }
  }

  private addModelOptions(dropdown: DropdownComponent): DropdownComponent {
    const models = PROVIDER_MODELS[this.pluginRef.settings.anteProvider];
    for (const model of models) {
      dropdown.addOption(model, model);
    }
    return dropdown;
  }

  private getSelectedModel(): string {
    const models = PROVIDER_MODELS[this.pluginRef.settings.anteProvider];
    return models.includes(this.pluginRef.settings.anteModel as (typeof models)[number])
      ? this.pluginRef.settings.anteModel
      : getDefaultModelForProvider(this.pluginRef.settings.anteProvider);
  }

  private normalizeConnectionMode(value: string): AnteConnectionMode {
    return value === "websocket" ? "websocket" : "stdio";
  }
}

class CustomPresetModal extends Modal {
  private nameValue: string;
  private instructionValue: string;

  constructor(
    private readonly pluginRef: TmdPlugin,
    private readonly onSaved: () => void,
    private readonly existingPreset: {
      id: string;
      name: string;
      instruction: string;
      enabled: boolean;
      sortOrder: number;
      interactionMode?: "inline" | "panel";
    } | null = null
  ) {
    super(pluginRef.app);
    this.nameValue = existingPreset?.name ?? "";
    this.instructionValue = existingPreset?.instruction ?? "";
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("tmd-preset-modal");
    contentEl.empty();
    contentEl.createEl("h3", {
      text: this.existingPreset ? "Edit Custom Preset" : "Add Custom Preset",
      cls: "tmd-preset-modal-title"
    });

    const nameSetting = new Setting(contentEl)
      .setName("Preset name")
      .setDesc("Shown in the editor context menu.")
      .addText((text) => {
        text.setPlaceholder("Custom preset");
        text.setValue(this.nameValue);
        text.inputEl.focus();
        text.onChange((value) => {
          this.nameValue = value;
        });
      });
    nameSetting.settingEl.addClass("tmd-preset-modal-setting");

    const instructionSetting = new Setting(contentEl)
      .setName("Instruction")
      .setDesc("Used as the preset execution instructions.")
      .addTextArea((text) =>
        text
          .setPlaceholder("Describe how this preset should operate on the current Markdown context.")
          .setValue(this.instructionValue)
          .onChange((value) => {
            this.instructionValue = value;
          })
      );
    instructionSetting.settingEl.addClass("tmd-preset-modal-setting", "is-textarea");

    const actionSetting = new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("Confirm").setCta().onClick(async () => {
          await this.savePreset();
        })
      )
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => {
          this.close();
        })
      );
    actionSetting.settingEl.addClass("tmd-preset-modal-actions");
  }

  onClose(): void {
    this.modalEl.removeClass("tmd-preset-modal");
    this.contentEl.empty();
  }

  private async savePreset(): Promise<void> {
    const name = this.nameValue.trim();
    const instruction = this.instructionValue.trim();

    if (!name) {
      new Notice("Preset name is required");
      return;
    }
    if (!instruction) {
      new Notice("Instruction is required");
      return;
    }

    if (this.existingPreset) {
      const preset = this.pluginRef.settings.customPresets.find((entry) => entry.id === this.existingPreset?.id);
      if (!preset) {
        new Notice("Custom preset no longer exists");
        return;
      }
      preset.name = name;
      preset.instruction = instruction;
    } else {
      this.pluginRef.settings.customPresets.push({
        id: `custom-${crypto.randomUUID()}`,
        name,
        instruction,
        enabled: true,
        sortOrder: listResolvedPresets(this.pluginRef.settings).length,
        interactionMode: "inline"
      });
    }
    this.pluginRef.settings.customPresets.sort((left, right) => left.sortOrder - right.sortOrder);
    await this.pluginRef.saveSettings();
    this.close();
    this.onSaved();
  }
}
