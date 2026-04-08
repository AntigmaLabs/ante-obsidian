import type TmdPlugin from "./main"
import {
  PROVIDER_MODELS,
  getDefaultModelForProvider,
  normalizeProvider,
} from "./settings"

export const getSelectedModelForProvider = (
  provider: keyof typeof PROVIDER_MODELS,
  model: string,
): string => {
  const models = PROVIDER_MODELS[provider]
  return models.includes(model as (typeof models)[number])
    ? model
    : getDefaultModelForProvider(provider)
}

export const applyProviderOverrideSelection = (
  settings: Pick<TmdPlugin["settings"], "anteProvider" | "anteModel">,
  value: string,
): void => {
  const provider = normalizeProvider(value)
  settings.anteProvider = provider
  settings.anteModel = getDefaultModelForProvider(provider)
}
