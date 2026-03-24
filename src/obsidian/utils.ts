import { Notice } from "obsidian";

/**
 * 处理异步操作的错误，显示通知
 * @param error 错误对象
 * @param defaultMessage 默认错误消息
 */
export const handleError = (error: unknown, defaultMessage: string): void => {
  new Notice(error instanceof Error ? error.message : defaultMessage);
};
