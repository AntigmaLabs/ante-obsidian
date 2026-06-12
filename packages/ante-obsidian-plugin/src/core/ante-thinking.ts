export const ANTE_DEFAULT_THINKING = "ante-default";

export const ANTE_THINKING_LEVELS = ["Disabled", "Enabled", "Deep", "Max"] as const;

export type AnteThinkingLevel = (typeof ANTE_THINKING_LEVELS)[number];
export type AnteThinkingPreference = typeof ANTE_DEFAULT_THINKING | AnteThinkingLevel;

export const normalizeAnteThinkingPreference = (value: unknown): AnteThinkingPreference =>
  typeof value === "string" && ANTE_THINKING_LEVELS.includes(value as AnteThinkingLevel)
    ? (value as AnteThinkingLevel)
    : ANTE_DEFAULT_THINKING;

export const resolveAnteThinkingPreference = (
  value: AnteThinkingPreference,
): AnteThinkingLevel | null => (value === ANTE_DEFAULT_THINKING ? null : value);
