import type { TerminalRow } from "./terminal-state-analyzer";
import { prefixForRow } from "./terminal-state-analyzer";

export const formatTime = (timestamp: string): string =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export const createRowElement = (streamEl: HTMLDivElement, row: TerminalRow): HTMLDivElement => {
  const rowEl = streamEl.createDiv({
    cls: `tmd-terminal-row tmd-is-${row.kind}`,
  });
  rowEl.createDiv({ cls: "tmd-terminal-row-time" });
  rowEl.createDiv({ cls: "tmd-terminal-row-prefix" });
  rowEl.createDiv({ cls: "tmd-terminal-row-text" });
  updateRowElement(rowEl, row);
  return rowEl;
};

export const updateRowElement = (rowEl: HTMLDivElement, row: TerminalRow): void => {
  const nextClassName = `tmd-terminal-row tmd-is-${row.kind}`;
  if (rowEl.className !== nextClassName) {
    rowEl.className = nextClassName;
  }
  const timeEl = rowEl.children[0] as HTMLDivElement | undefined;
  const prefixEl = rowEl.children[1] as HTMLDivElement | undefined;
  const textEl = rowEl.children[2] as HTMLDivElement | undefined;
  const nextTime = formatTime(row.timestamp);
  const nextPrefix = prefixForRow(row.kind);
  if (timeEl && timeEl.dataset.value !== nextTime) {
    timeEl.dataset.value = nextTime;
    timeEl.textContent = nextTime;
  }
  if (prefixEl && prefixEl.dataset.value !== nextPrefix) {
    prefixEl.dataset.value = nextPrefix;
    prefixEl.textContent = nextPrefix;
  }
  if (textEl && textEl.dataset.value !== row.text) {
    textEl.dataset.value = row.text;
    textEl.textContent = row.text;
  }
};

export const syncRows = (
  streamEl: HTMLDivElement,
  rowElsMap: Map<string, HTMLDivElement>,
  rows: TerminalRow[],
): void => {
  const nextKeys = new Set(rows.map((row) => row.key));

  for (const [key, rowEl] of [...rowElsMap.entries()]) {
    if (!nextKeys.has(key)) {
      rowEl.remove();
      rowElsMap.delete(key);
    }
  }

  let previousEl: HTMLElement | null = null;
  for (const row of rows) {
    let rowEl = rowElsMap.get(row.key);
    if (!rowEl) {
      rowEl = createRowElement(streamEl, row);
      rowElsMap.set(row.key, rowEl);
    }
    updateRowElement(rowEl, row);
    const anchor: ChildNode | null = previousEl ? previousEl.nextSibling : streamEl.firstChild;
    streamEl.insertBefore(rowEl, anchor);
    previousEl = rowEl;
  }
};
