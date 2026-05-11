import { parseMentionLine, type MentionMatch } from "./mention-parser";

export interface MentionTriggerResolution {
  match: MentionMatch | null;
  matchLine: number;
  matchText: string;
  lineKey: string | null;
  releaseHandledPrefix: string | null;
}

export const resolveMentionTrigger = (
  filePath: string,
  cursorLine: number,
  currentLine: string,
  previousLine: string
): MentionTriggerResolution => {
  const previousLineIndex = cursorLine > 0 ? cursorLine - 1 : -1;
  const previousMatch = previousLineIndex >= 0 ? parseMentionLine(previousLine) : null;
  const match = currentLine.trim().length === 0 ? previousMatch : null;

  if (match) {
    return {
      match,
      matchLine: previousLineIndex,
      matchText: previousLine,
      lineKey: `${filePath}:${previousLineIndex}:${previousLine}`,
      releaseHandledPrefix: null
    };
  }

  const currentMatch = parseMentionLine(currentLine);
  return {
    match: null,
    matchLine: currentMatch ? cursorLine : -1,
    matchText: currentLine,
    lineKey: null,
    releaseHandledPrefix: currentMatch ? `${filePath}:${cursorLine}:` : null
  };
};
