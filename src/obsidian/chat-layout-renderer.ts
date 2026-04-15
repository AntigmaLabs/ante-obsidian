import {
  button,
  div,
  h2,
  span,
  textarea,
  type ObsidianDomParent,
} from "./dom-factory"

export interface ChatLayoutNodes {
  shellEl: HTMLDivElement
  sidebarEl: HTMLDivElement
  sidebarHeaderEl: HTMLDivElement
  sidebarToggleEl: HTMLButtonElement
  newChatButtonEl: HTMLButtonElement
  newChatIconEl: HTMLSpanElement
  conversationListEl: HTMLDivElement
  headerActionsEl: HTMLDivElement
  contextEl: HTMLDivElement
  contextTitleEl: HTMLDivElement
  contextValueEl: HTMLDivElement
  timelineEl: HTMLDivElement
  composerContainerEl: HTMLDivElement
  inputShellEl: HTMLDivElement
  attachmentListEl: HTMLDivElement
  composerMetaEl: HTMLDivElement
  attachmentButtonEl: HTMLButtonElement
  providerButtonEl: HTMLButtonElement
  modelButtonEl: HTMLButtonElement
  composerEl: HTMLTextAreaElement
  composerActionButtonEl: HTMLButtonElement
  fileInputEl: HTMLInputElement
}

interface ChatSidebarNodes {
  sidebarEl: HTMLDivElement
  sidebarHeaderEl: HTMLDivElement
  sidebarToggleEl: HTMLButtonElement
  newChatButtonEl: HTMLButtonElement
  newChatIconEl: HTMLSpanElement
  conversationListEl: HTMLDivElement
}

interface ChatHeaderNodes {
  headerActionsEl: HTMLDivElement
}

interface ChatContextNodes {
  contextEl: HTMLDivElement
  contextTitleEl: HTMLDivElement
  contextValueEl: HTMLDivElement
}

interface ChatComposerNodes {
  composerContainerEl: HTMLDivElement
  inputShellEl: HTMLDivElement
  attachmentListEl: HTMLDivElement
  composerMetaEl: HTMLDivElement
  attachmentButtonEl: HTMLButtonElement
  providerButtonEl: HTMLButtonElement
  modelButtonEl: HTMLButtonElement
  composerEl: HTMLTextAreaElement
  composerActionButtonEl: HTMLButtonElement
  fileInputEl: HTMLInputElement
}

const renderChatSidebar = (shellEl: HTMLDivElement): ChatSidebarNodes => {
  const sidebarEl = div({ cls: "tmd-chat-sidebar" }).appendTo(shellEl)
  const sidebarHeaderEl = div({
    cls: "tmd-chat-sidebar-header",
  }).appendTo(sidebarEl)
  const sidebarToggleEl = button({
    cls: "tmd-chat-sidebar-toggle",
  }).appendTo(sidebarHeaderEl)
  const newChatButtonEl = button({
    cls: "tmd-chat-sidebar-new",
    text: "New chat",
  }).appendTo(sidebarHeaderEl)
  const newChatIconEl = span({
    cls: "tmd-chat-sidebar-new-icon",
  }).appendTo(newChatButtonEl)
  const conversationListEl = div({
    cls: "tmd-chat-sidebar-list",
  }).appendTo(sidebarEl)

  return {
    sidebarEl,
    sidebarHeaderEl,
    sidebarToggleEl,
    newChatButtonEl,
    newChatIconEl,
    conversationListEl,
  }
}

const renderChatHeader = (mainEl: HTMLDivElement): ChatHeaderNodes => {
  const titleRowEl = div({ cls: "tmd-title-row tmd-chat-header" }).appendTo(
    mainEl,
  )
  const headerActionsEl = div({ cls: "tmd-chat-header-actions" }).appendTo(
    titleRowEl,
  )
  const headerCopyEl = div({ cls: "tmd-chat-header-copy" }).appendTo(titleRowEl)
  h2({ text: "Chat with Ante" }).appendTo(headerCopyEl)

  return {
    headerActionsEl,
  }
}

const renderChatContext = (mainEl: HTMLDivElement): ChatContextNodes => {
  const contextEl = div({ cls: "tmd-chat-contextbar" }).appendTo(mainEl)
  const contextTitleEl = div({ cls: "tmd-chat-context-title" }).appendTo(
    contextEl,
  )
  const contextValueEl = div({ cls: "tmd-chat-context-value" }).appendTo(
    contextEl,
  )

  return {
    contextEl,
    contextTitleEl,
    contextValueEl,
  }
}

const renderChatComposer = (mainEl: HTMLDivElement): ChatComposerNodes => {
  const composerContainerEl = div({ cls: "tmd-chat-composer" }).appendTo(mainEl)
  const inputShellEl = div({ cls: "tmd-chat-input-shell" }).appendTo(
    composerContainerEl,
  )
  const composerEl = textarea({ cls: "tmd-chat-input" }).appendTo(inputShellEl)
  const attachmentListEl = div({ cls: "tmd-chat-attachments" }).appendTo(
    inputShellEl,
  )
  const composerMetaEl = div({ cls: "tmd-chat-composer-meta" }).appendTo(
    inputShellEl,
  )
  const attachmentButtonEl = button({
    cls: "tmd-chat-attachment-button",
  }).appendTo(composerMetaEl)
  const providerButtonEl = button({
    cls: "tmd-chat-picker tmd-chat-provider-picker",
  }).appendTo(composerMetaEl)
  const modelButtonEl = button({
    cls: "tmd-chat-picker tmd-chat-model-picker",
  }).appendTo(composerMetaEl)
  const composerActionButtonEl = button({
    cls: "tmd-chat-primary-action",
  }).appendTo(inputShellEl)
  const fileInputEl = inputShellEl.createEl("input", {
    cls: "tmd-chat-file-input",
  }) as HTMLInputElement
  fileInputEl.type = "file"
  fileInputEl.multiple = true

  return {
    composerContainerEl,
    inputShellEl,
    attachmentListEl,
    composerMetaEl,
    attachmentButtonEl,
    providerButtonEl,
    modelButtonEl,
    composerEl,
    composerActionButtonEl,
    fileInputEl,
  }
}

const renderChatMain = (
  shellEl: HTMLDivElement,
): {
  mainEl: HTMLDivElement
  header: ChatHeaderNodes
  context: ChatContextNodes
  timelineEl: HTMLDivElement
  composer: ChatComposerNodes
} => {
  const mainEl = div({ cls: "tmd-chat-main" }).appendTo(shellEl)
  const header = renderChatHeader(mainEl)
  const context = renderChatContext(mainEl)
  const timelineEl = div({ cls: "tmd-chat-timeline" }).appendTo(mainEl)
  const composer = renderChatComposer(mainEl)

  return {
    mainEl,
    header,
    context,
    timelineEl,
    composer,
  }
}

export const renderChatLayout = (
  container: ObsidianDomParent,
): ChatLayoutNodes => {
  container.empty()

  const shellEl = div({ cls: "tmd-chat-shell" }).appendTo(container)
  const sidebar = renderChatSidebar(shellEl)
  const main = renderChatMain(shellEl)

  return {
    shellEl,
    sidebarEl: sidebar.sidebarEl,
    sidebarHeaderEl: sidebar.sidebarHeaderEl,
    sidebarToggleEl: sidebar.sidebarToggleEl,
    newChatButtonEl: sidebar.newChatButtonEl,
    newChatIconEl: sidebar.newChatIconEl,
    conversationListEl: sidebar.conversationListEl,
    headerActionsEl: main.header.headerActionsEl,
    contextEl: main.context.contextEl,
    contextTitleEl: main.context.contextTitleEl,
    contextValueEl: main.context.contextValueEl,
    timelineEl: main.timelineEl,
    composerContainerEl: main.composer.composerContainerEl,
    inputShellEl: main.composer.inputShellEl,
    attachmentListEl: main.composer.attachmentListEl,
    composerMetaEl: main.composer.composerMetaEl,
    attachmentButtonEl: main.composer.attachmentButtonEl,
    providerButtonEl: main.composer.providerButtonEl,
    modelButtonEl: main.composer.modelButtonEl,
    composerEl: main.composer.composerEl,
    composerActionButtonEl: main.composer.composerActionButtonEl,
    fileInputEl: main.composer.fileInputEl,
  }
}
