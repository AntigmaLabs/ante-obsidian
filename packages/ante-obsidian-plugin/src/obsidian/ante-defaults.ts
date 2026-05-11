import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

export interface AnteDefaults {
  provider: string;
  model: string;
}

const ANTE_SETTINGS_PATH = join(homedir(), ".ante", "settings.json");

export const readAnteDefaults = async (): Promise<AnteDefaults | null> => {
  try {
    const raw = await readFile(ANTE_SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as { provider?: unknown; model?: unknown };
    if (typeof parsed.provider !== "string" || typeof parsed.model !== "string") {
      return null;
    }
    const provider = parsed.provider.trim();
    const model = parsed.model.trim();
    if (!provider || !model) {
      return null;
    }
    return { provider, model };
  } catch {
    return null;
  }
};
