export interface TmdSettings {
  command: string;
  argsJson: string;
  cwd: string;
  anteModel: string;
  anteProvider: string;
  mentionTriggerDebug: boolean;
}

export const DEFAULT_SETTINGS: TmdSettings = {
  command: "ante",
  argsJson: JSON.stringify(["serve", "--stdio", "--yolo"]),
  cwd: "",
  anteModel: "gpt-5.4",
  anteProvider: "openai-subscription",
  mentionTriggerDebug: false
};

export const normalizeSettings = (stored: Partial<TmdSettings> | null | undefined): TmdSettings => {
  const raw = stored ?? {};
  return {
    command: typeof raw.command === "string" ? raw.command : DEFAULT_SETTINGS.command,
    argsJson: typeof raw.argsJson === "string" ? raw.argsJson : DEFAULT_SETTINGS.argsJson,
    cwd: typeof raw.cwd === "string" ? raw.cwd : DEFAULT_SETTINGS.cwd,
    anteModel: typeof raw.anteModel === "string" ? raw.anteModel : DEFAULT_SETTINGS.anteModel,
    anteProvider: typeof raw.anteProvider === "string" ? raw.anteProvider : DEFAULT_SETTINGS.anteProvider,
    mentionTriggerDebug: raw.mentionTriggerDebug === true
  };
};
