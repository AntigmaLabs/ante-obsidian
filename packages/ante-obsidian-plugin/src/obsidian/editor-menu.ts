import type { Editor, Menu } from "obsidian";
import type TmdPlugin from "./main";

export const populateEditorMenu = (menu: Menu, editor: Editor, plugin: TmdPlugin): void => {
  const hasSelection = editor.getSelection().trim().length > 0;

  menu.addSeparator();

  for (const item of plugin.getVisiblePresets()) {
    menu.addItem((entry) => {
      entry.setTitle(item.label).setIcon(plugin.getPresetIcon(item.id)).setDisabled(!hasSelection);

      if (hasSelection) {
        entry.onClick(() => void plugin.runPresetFromContextMenu(item.id));
      }
    });
  }

  menu.addItem((entry) =>
    entry
      .setTitle("Chat with ante")
      .setIcon("terminal-square")
      .onClick(() => void plugin.openChatView()),
  );

  menu.addItem((entry) =>
    entry
      .setTitle("Open ante terminal")
      .setIcon("square-terminal")
      .onClick(() => void plugin.openTerminalView()),
  );
};
