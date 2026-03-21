import type { Editor, Menu } from "obsidian";
import type TmdPlugin from "./main";
import type { PresetId } from "../core/types";

const PRESET_MENU_ITEMS: Array<{ title: string; presetId: PresetId; icon: string }> = [
  { title: "@ante", presetId: "default", icon: "bot" },
  { title: "@ante research", presetId: "research", icon: "search" },
  { title: "@ante plan", presetId: "plan", icon: "list-todo" }
];

export const populateEditorMenu = (menu: Menu, _editor: Editor, plugin: TmdPlugin): void => {
  menu.addSeparator();

  for (const item of PRESET_MENU_ITEMS) {
    menu.addItem((entry) =>
      entry
        .setTitle(item.title)
        .setIcon(item.icon)
        .onClick(() => void plugin.runPresetFromContextMenu(item.presetId))
    );
  }

  menu.addItem((entry) =>
    entry
      .setTitle("Open Ante Console")
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
