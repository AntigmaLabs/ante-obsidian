import type { Editor, Menu } from "obsidian";
import type TmdPlugin from "./main";
import type { PresetId } from "../core/types";

const PRESET_MENU_ITEMS: Array<{ title: string; presetId: PresetId; icon: string }> = [
  { title: "@ante", presetId: "default", icon: "bot" },
  { title: "@ante research", presetId: "research", icon: "search" },
  { title: "@ante plan", presetId: "plan", icon: "list-todo" },
  { title: "@ante summary", presetId: "summary", icon: "scroll-text" }
];

export const populateEditorMenu = (menu: Menu, editor: Editor, plugin: TmdPlugin): void => {
  const hasSelection = editor.getSelection().trim().length > 0;

  menu.addSeparator();

  for (const item of PRESET_MENU_ITEMS) {
    menu.addItem((entry) => {
      entry.setTitle(item.title).setIcon(item.icon).setDisabled(!hasSelection);

      if (hasSelection) {
        entry.onClick(() => void plugin.runPresetFromContextMenu(item.presetId));
      }
    });
  }

  menu.addItem((entry) =>
    entry
      .setTitle("Chat with Ante")
      .setIcon("terminal-square")
      .onClick(() => void plugin.openConsoleView())
  );

  menu.addItem((entry) =>
    entry
      .setTitle("Open Ante Terminal")
      .setIcon("square-terminal")
      .onClick(() => void plugin.openTerminalView())
  );
};
