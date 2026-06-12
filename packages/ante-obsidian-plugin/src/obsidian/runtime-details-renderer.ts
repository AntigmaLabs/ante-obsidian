import type { RuntimeTelemetryState } from "../core/types";

export const buildRuntimeDetailsSections = (
  telemetry: RuntimeTelemetryState | undefined,
  options: {
    clampPreview: (value: string) => string;
    formatTime: (timestamp: string) => string;
  },
): string[] => {
  if (!telemetry) {
    return [];
  }

  const sections: string[] = [];
  const statusLines: string[] = [];
  if (telemetry.compacting) {
    statusLines.push("status compacting context");
  }
  if (telemetry.usage) {
    statusLines.push(
      `usage prompt=${telemetry.usage.promptTokens ?? "?"} completion=${telemetry.usage.completionTokens ?? "?"} total=${telemetry.usage.totalTokens ?? "?"}`,
    );
  }
  if (telemetry.lastInfo) {
    statusLines.push(
      `${telemetry.lastInfo.level} ${options.formatTime(telemetry.lastInfo.timestamp)}${telemetry.lastInfo.message ? ` · ${telemetry.lastInfo.message}` : ""}`,
    );
  }
  if (statusLines.length > 0) {
    sections.push(statusLines.join("\n"));
  }

  const thinking = options.clampPreview(telemetry.thinkingText ?? "");
  if (thinking) {
    sections.push(`thinking\n${thinking}`);
  }

  if (telemetry.timeline.length > 0) {
    sections.push(
      [
        "timeline",
        ...telemetry.timeline.map(
          (entry) =>
            `${options.formatTime(entry.timestamp)} · ${entry.kind}${entry.message ? ` · ${entry.message}` : ""}`,
        ),
      ].join("\n"),
    );
  }

  return sections;
};

export const shouldAutoExpandRuntimeDetails = (
  isStreaming: boolean,
  telemetry: RuntimeTelemetryState | undefined,
): boolean => {
  if (!telemetry || !isStreaming) {
    return false;
  }
  if (telemetry.compacting) {
    return true;
  }
  if ((telemetry.thinkingText ?? "").trim()) {
    return true;
  }
  if (telemetry.lastInfo?.message?.trim()) {
    return true;
  }
  return telemetry.timeline.length > 0;
};

export const renderRuntimeDetails = (
  container: HTMLElement,
  sections: string[],
  shouldOpen: boolean,
): HTMLDetailsElement => {
  const detailsEl = container.createEl("details", {
    cls: "tmd-chat-runtime-details",
  });
  detailsEl.open = shouldOpen;
  detailsEl.createEl("summary", {
    cls: "tmd-chat-runtime-summary",
    text: "Runtime details",
  });
  const bodyEl = detailsEl.createDiv({ cls: "tmd-chat-runtime-body" });
  for (const section of sections) {
    bodyEl.createEl("pre", {
      cls: "tmd-chat-runtime-block",
      text: section,
    });
  }
  return detailsEl;
};
