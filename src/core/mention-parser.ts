import type { PresetId } from "./types";

export interface MentionMatch {
  presetId: PresetId;
  inlineInstruction: string;
  start: number;
  end: number;
}

const TOKEN_PATTERN = /(^|[\s(])@ante(?:(?:\s+)(research|plan))?(?=\s|$)/i;

export const parseMentionLine = (line: string): MentionMatch | null => {
  const match = TOKEN_PATTERN.exec(line);
  if (!match || match.index < 0) {
    return null;
  }

  const prefixLength = match[1]?.length ?? 0;
  const tokenStart = match.index + prefixLength;
  const tokenEnd = tokenStart + match[0].slice(prefixLength).length;
  const modifier = (match[2] ?? "").toLowerCase();
  const presetId: PresetId = modifier === "research" || modifier === "plan" ? modifier : "default";
  const inlineInstruction = line.slice(tokenEnd).trim();

  return {
    presetId,
    inlineInstruction,
    start: tokenStart,
    end: tokenEnd
  };
};
