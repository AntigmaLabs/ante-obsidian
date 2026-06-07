import { Notice, setIcon } from "obsidian";
import { DEFAULT_UPDATE_CONFIG } from "./update-config";
import type TmdPlugin from "./main";

/**
 * 处理异步操作的错误，显示通知
 * @param error 错误对象
 * @param defaultMessage 默认错误消息
 */
export const handleError = (error: unknown, defaultMessage: string): void => {
  new Notice(error instanceof Error ? error.message : defaultMessage);
};

/**
 * Appends a clickable bug report button next to error messages.
 * Clicking the button opens GitHub Issue creation prefilled with error info.
 */
export const appendErrorReportLink = (
  containerEl: HTMLElement,
  errorText: string,
  plugin?: TmdPlugin
): void => {
  if (!errorText.trim()) return;

  // Prevent duplicate report buttons
  if (containerEl.querySelector(".tmd-error-report-btn")) {
    return;
  }

  const reportBtn = containerEl.createEl("button", {
    cls: "tmd-error-report-btn clickable-icon",
    attr: {
      "aria-label": "Report this issue to GitHub",
      title: "Report this issue to GitHub",
      type: "button"
    }
  });
  setIcon(reportBtn, "bug");

  reportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    let providerInfo = "Unknown";
    let modelInfo = "Unknown";
    let useDefaults = "Unknown";
    let pluginVersion = "Unknown";

    if (plugin) {
      try {
        const resolved = plugin.getResolvedAnteTarget();
        providerInfo = resolved.provider || "None";
        modelInfo = resolved.model || "None";
      } catch {
        providerInfo = plugin.settings.anteProvider || "None";
        modelInfo = plugin.settings.anteModel || "None";
      }
      useDefaults = String(plugin.settings.useAnteDefaults);
      pluginVersion = plugin.manifest.version || "Unknown";
    }

    const title = `Runtime Error: ${providerInfo} / ${modelInfo}`;

    const body = `### Description
Describe what you were doing when the error occurred:

### Error Message
\`\`\`
${errorText}
\`\`\`

### Environment & Settings
- **Obsidian Plugin Version**: \`${pluginVersion}\`
- **Resolved Provider**: \`${providerInfo}\`
- **Resolved Model**: \`${modelInfo}\`
- **Follow Ante CLI Defaults**: \`${useDefaults}\`
- **Platform**: \`${typeof process !== "undefined" ? process.platform : "unknown"}\` (\`${typeof process !== "undefined" ? process.arch : "unknown"}\`)
`;
    const url = `${DEFAULT_UPDATE_CONFIG.pluginRepositoryUrl}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank");
  });
};
