import {
  normalizeProvider,
} from "./settings"

export const getSelectedModelForProvider = (
  model: string,
  availableModels: readonly string[],
): string => {
  const trimmed = model.trim()
  if (trimmed && availableModels.includes(trimmed)) {
    return trimmed
  }
  if (availableModels.length > 0) {
    return availableModels[0] ?? ""
  }
  return trimmed
}

export const applyProviderOverrideSelection = (
  settings: { anteProvider: string; anteModel: string },
  value: string,
  availableModels: readonly string[],
): void => {
  const provider = normalizeProvider(value)
  settings.anteProvider = provider
  // Preserve current model if still valid, otherwise select first available
  settings.anteModel = getSelectedModelForProvider(
    settings.anteModel,
    availableModels,
  )
}
