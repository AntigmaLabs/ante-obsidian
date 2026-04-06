import type { TaskRecord } from "./types";

export const terminalStatus = (task: TaskRecord | undefined): string => {
  if (!task) {
    return "ready";
  }

  switch (task.status) {
    case "running":
      return "active";
    case "applied":
      return "done";
    case "failed":
      return "error";
    case "discarded":
    case "cancelled":
      return "stopped";
    default:
      return task.status;
  }
};

export const terminalStatusClass = (task: TaskRecord | undefined): string => {
  const status = terminalStatus(task);
  switch (status) {
    case "active":
      return "tmd-is-running";
    case "error":
      return "tmd-is-failed";
    case "stopped":
      return "tmd-is-muted";
    default:
      return "tmd-is-completed";
  }
};
