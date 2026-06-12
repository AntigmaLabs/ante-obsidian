import { button, div, h2, span, type ObsidianDomParent } from "./dom-factory";

export interface TerminalLayoutNodes {
  runtimeHelpEl: HTMLDivElement;
  frameEl: HTMLDivElement;
  statusEl: HTMLDivElement;
  metaLineEl: HTMLDivElement;
  screenEl: HTMLDivElement;
  streamEl: HTMLDivElement;
  promptEl: HTMLDivElement;
  editorEl: HTMLDivElement;
  inlineArtifactsEl: HTMLDivElement;
  stopButtonEl: HTMLButtonElement;
}

interface TerminalChromeNodes {
  statusEl: HTMLDivElement;
  stopButtonEl: HTMLButtonElement;
}

interface TerminalMetaNodes {
  metaLineEl: HTMLDivElement;
}

interface TerminalPromptNodes {
  screenEl: HTMLDivElement;
  streamEl: HTMLDivElement;
  promptEl: HTMLDivElement;
  editorEl: HTMLDivElement;
}

const renderTerminalChrome = (frameEl: HTMLDivElement): TerminalChromeNodes => {
  const chromeEl = div({ cls: "tmd-terminal-chrome" }).appendTo(frameEl);
  div({
    cls: "tmd-terminal-chrome-title",
    text: "markdown context agent",
  }).appendTo(chromeEl);
  const chromeActionsEl = div({
    cls: "tmd-terminal-chrome-actions",
  }).appendTo(chromeEl);
  const stopButtonEl = button({
    cls: "tmd-terminal-stop-button",
  }).appendTo(chromeActionsEl);
  stopButtonEl.setAttr("aria-label", "Stop active Ante task");
  span({ cls: "tmd-terminal-stop-icon", text: "■" }).appendTo(stopButtonEl);
  span({ cls: "tmd-terminal-stop-label", text: "Stop" }).appendTo(stopButtonEl);
  const statusEl = div({ cls: "tmd-terminal-status" }).appendTo(chromeActionsEl);

  return {
    statusEl,
    stopButtonEl,
  };
};

const renderTerminalMeta = (frameEl: HTMLDivElement): TerminalMetaNodes => {
  const metaEl = div({ cls: "tmd-terminal-meta" }).appendTo(frameEl);
  const metaLineEl = div({ cls: "tmd-terminal-meta-line" }).appendTo(metaEl);

  return {
    metaLineEl,
  };
};

const renderTerminalPrompt = (frameEl: HTMLDivElement): TerminalPromptNodes => {
  const screenEl = div({ cls: "tmd-terminal-screen" }).appendTo(frameEl);
  const streamEl = div({ cls: "tmd-terminal-stream" }).appendTo(screenEl);
  const promptEl = div({
    cls: "tmd-terminal-row tmd-terminal-promptline",
  }).appendTo(screenEl);
  const editorEl = div({
    cls: "tmd-terminal-shell-editor tmd-is-empty",
  }).appendTo(promptEl);
  editorEl.setAttr("role", "textbox");
  editorEl.setAttr("aria-label", "Ante terminal prompt");

  return {
    screenEl,
    streamEl,
    promptEl,
    editorEl,
  };
};

export const renderTerminalLayout = (container: ObsidianDomParent): TerminalLayoutNodes => {
  container.empty();
  h2({ text: "Ante Workspace" }).appendTo(container);

  const runtimeHelpEl = div({ cls: "tmd-runtime-help" }).appendTo(container);
  runtimeHelpEl.hide();

  const frameEl = div({ cls: "tmd-terminal-frame" }).appendTo(container);
  const chrome = renderTerminalChrome(frameEl);
  const meta = renderTerminalMeta(frameEl);
  const prompt = renderTerminalPrompt(frameEl);

  const inlineArtifactsEl = div({
    cls: "tmd-terminal-inline-container",
  }).appendTo(container);

  return {
    runtimeHelpEl,
    frameEl,
    statusEl: chrome.statusEl,
    metaLineEl: meta.metaLineEl,
    screenEl: prompt.screenEl,
    streamEl: prompt.streamEl,
    promptEl: prompt.promptEl,
    editorEl: prompt.editorEl,
    inlineArtifactsEl,
    stopButtonEl: chrome.stopButtonEl,
  };
};
