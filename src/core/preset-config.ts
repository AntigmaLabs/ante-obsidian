export interface CustomPresetConfig {
  id: string;
  name: string;
  instruction: string;
  enabled: boolean;
  sortOrder: number;
  interactionMode?: "inline" | "panel";
}

export interface BuiltinPresetPreference {
  id: string;
  enabled: boolean;
  sortOrder: number;
}

export interface PresetSettings {
  customPresets: CustomPresetConfig[];
  builtinPresetPreferences: BuiltinPresetPreference[];
}
