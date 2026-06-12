import type { ChatMessageRecord } from "../core/chat-types";
import type { ContextSnapshot, LogEntry, RuntimeProcessLane } from "../core/types";
import { formatLoadingLabel } from "../core/loading-label";
import { ANTE_DEFAULT_THINKING, type AnteThinkingPreference } from "../core/ante-thinking";

export const THINKING_LABELS: Record<AnteThinkingPreference, string> = {
  [ANTE_DEFAULT_THINKING]: "Default",
  Disabled: "Off",
  Enabled: "On",
  Deep: "Deep",
  Max: "Max",
};

export const MAX_CHAT_PREVIEW_CHARS = 12000;
export const MAX_CHAT_PREVIEW_LINES = 160;
export const MESSAGE_WINDOW_SIZE = 80;
export const MAX_ATTACHMENT_LABEL_CHARS = 42;
export const MAX_CHAT_PROCESS_LOG_LINES = 24;

export const logAttachmentDebug = (message: string, details?: Record<string, unknown>): void => {
  void message;
  void details;
};

export type ElectronDialogModule = {
  showOpenDialog: (options: {
    title?: string;
    buttonLabel?: string;
    properties?: string[];
  }) => Promise<{ canceled: boolean; filePaths: string[] }>;
};

export type ElectronWebUtilsModule = {
  getPathForFile: (file: File) => string;
};

export const getElectronRequire = (): ((moduleName: string) => unknown) | null => {
  const electronWindow = window as Window & {
    require?: (moduleName: string) => unknown;
  };
  return electronWindow.require ?? null;
};

export const getElectronDialog = (): {
  dialog: ElectronDialogModule | null;
  source: string | null;
} => {
  const candidateRequire = getElectronRequire();
  if (!candidateRequire) {
    return { dialog: null, source: null };
  }

  const candidates: Array<{
    source: string;
    getDialog: () => ElectronDialogModule | null;
  }> = [
    {
      source: "@electron/remote",
      getDialog: () => {
        const remoteModule = candidateRequire("@electron/remote") as {
          dialog?: ElectronDialogModule;
        };
        return remoteModule?.dialog ?? null;
      },
    },
    {
      source: "electron.remote",
      getDialog: () => {
        const electronModule = candidateRequire("electron") as {
          remote?: { dialog?: ElectronDialogModule };
        };
        return electronModule?.remote?.dialog ?? null;
      },
    },
    {
      source: "electron.dialog",
      getDialog: () => {
        const electronModule = candidateRequire("electron") as {
          dialog?: ElectronDialogModule;
        };
        return electronModule?.dialog ?? null;
      },
    },
  ];

  for (const candidate of candidates) {
    try {
      const dialog = candidate.getDialog();
      if (dialog?.showOpenDialog) {
        return {
          dialog,
          source: candidate.source,
        };
      }
    } catch (error) {
      console.warn("[tmd chat attachments]", `failed to load ${candidate.source}`, error);
    }
  }

  return { dialog: null, source: null };
};

export const getElectronWebUtils = (): {
  webUtils: ElectronWebUtilsModule | null;
  source: string | null;
} => {
  const candidateRequire = getElectronRequire();
  if (!candidateRequire) {
    return { webUtils: null, source: null };
  }

  try {
    const electronModule = candidateRequire("electron") as {
      webUtils?: ElectronWebUtilsModule;
    };
    if (electronModule?.webUtils?.getPathForFile) {
      return {
        webUtils: electronModule.webUtils,
        source: "electron.webUtils",
      };
    }
  } catch (error) {
    console.warn("[tmd chat attachments]", "failed to load electron.webUtils", error);
  }

  return { webUtils: null, source: null };
};

export const trimAttachmentLabel = (value: string): string =>
  value.length <= MAX_ATTACHMENT_LABEL_CHARS
    ? value
    : `...${value.slice(-(MAX_ATTACHMENT_LABEL_CHARS - 3))}`;

export const getAttachmentFileName = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? normalized;
};

export const formatAttachmentLabel = (filePath: string): string => {
  return trimAttachmentLabel(getAttachmentFileName(filePath));
};

export const buildPromptWithAttachmentPaths = (prompt: string, filePaths: string[]): string => {
  if (filePaths.length === 0) {
    return prompt;
  }

  const attachmentBlock = [
    "Attached file paths:",
    ...filePaths.map((filePath) => `- ${filePath}`),
    "",
    "Use these file paths as local context when relevant.",
  ].join("\n");

  if (!prompt.trim()) {
    return attachmentBlock;
  }

  return `${prompt}\n\n${attachmentBlock}`;
};

export const hashText = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const clampPreview = (value: string): string => {
  const normalized = value.replace(/\r/g, "");
  if (!normalized) {
    return "";
  }

  const lines = normalized.split("\n");
  const tailLines =
    lines.length > MAX_CHAT_PREVIEW_LINES ? lines.slice(-MAX_CHAT_PREVIEW_LINES) : lines;
  let preview = tailLines.join("\n");

  if (preview.length > MAX_CHAT_PREVIEW_CHARS) {
    preview = preview.slice(-MAX_CHAT_PREVIEW_CHARS);
  }

  if (preview !== normalized) {
    const omittedChars = Math.max(0, normalized.length - preview.length);
    const omittedLines = Math.max(0, lines.length - tailLines.length);
    preview = `... truncated preview (${omittedLines} lines, ${omittedChars} chars omitted) ...\n${preview}`;
  }

  return preview.trim();
};

export const summarizeContext = (context: ContextSnapshot | null): string => {
  if (!context?.filePath) {
    return "No note context";
  }

  const selection = context.selection?.text?.trim();
  if (selection) {
    return `${context.filePath} · selection ${selection.length} chars`;
  }

  const documentText = context.documentText?.trim() ?? "";
  return `${context.filePath} · note ${documentText.length} chars`;
};

export const formatTime = (timestamp: string): string =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

export const loadingLabelForMessage = (
  message: ChatMessageRecord,
  loadingFrame: number,
): string => {
  if (!message.turn?.runtimeSessionId) {
    return "preparing session";
  }
  return formatLoadingLabel(message.id, loadingFrame);
};

export const buildProcessStatusLines = (process: RuntimeProcessLane | undefined): string[] => {
  if (!process) {
    return [];
  }

  const lines: string[] = [];
  const activeStep =
    process.steps.find((step) => step.status === "in_progress") ??
    process.steps.find((step) => step.status === "pending");

  lines.push(activeStep?.activeLabel ?? activeStep?.label ?? process.label);

  for (const step of process.steps) {
    lines.push(
      `${step.status === "completed" ? "■" : step.status === "in_progress" ? "▪" : "□"} ${
        step.status === "in_progress" ? (step.activeLabel ?? step.label) : step.label
      }`,
    );
  }

  if (process.steps.length === 0 && process.label !== lines[0]) {
    lines.push(`${process.phase} · ${process.label}`);
  }

  return lines;
};

export const buildRuntimeLogLines = (logs: LogEntry[], showFullProcessLogs: boolean): string[] => {
  if (!showFullProcessLogs || logs.length === 0) {
    return [];
  }

  const visibleLogs = logs
    .filter(
      (log) => log.stream === "stderr" || (log.stream === "system" && /^Ante\b/.test(log.text)),
    )
    .slice(-MAX_CHAT_PROCESS_LOG_LINES);

  return visibleLogs.map((log) => `${log.stream === "stderr" ? "err" : "sys"} ${log.text}`);
};
