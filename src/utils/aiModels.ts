export const STABLE_FLASH_MODEL = "gemini-3.1-flash-lite-preview";
export const STABLE_FLASH_LITE_MODEL = "gemini-2.5-flash";
export const STABLE_IMAGE_MODEL = "gemini-3.1-flash-preview";

export const DEFAULT_TEXT_MODEL_PREFERENCE = "";
export const QUICK_TEXT_MODEL_PREFERENCES = [
  STABLE_FLASH_MODEL,
  STABLE_FLASH_LITE_MODEL,
] as const;

export type TextModelPreference = string;

export const AI_MODEL_PREFERENCE_CHANGED_EVENT =
  "storycraft:ai-model-preference-changed";

const TEXT_MODEL_STORAGE_KEY = "storycraft:text-model-preference";

const LEGACY_MODEL_ALIASES: Record<string, string> = {
  "gemini-2.5-flash-lite": STABLE_FLASH_LITE_MODEL,
  "gemini-flash-latest": STABLE_FLASH_MODEL,
  "gemini-flash-lite-latest": STABLE_FLASH_LITE_MODEL,
};

function emitAiModelPreferenceChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AI_MODEL_PREFERENCE_CHANGED_EVENT));
  }
}

export function isQuickTextModelPreference(
  value: string,
): value is (typeof QUICK_TEXT_MODEL_PREFERENCES)[number] {
  return QUICK_TEXT_MODEL_PREFERENCES.includes(
    value as (typeof QUICK_TEXT_MODEL_PREFERENCES)[number],
  );
}

export function normalizeGeminiModelName(model?: string) {
  const normalizedModel = model?.trim();
  if (!normalizedModel) return STABLE_FLASH_MODEL;

  if (
    normalizedModel === STABLE_FLASH_MODEL ||
    normalizedModel === STABLE_FLASH_LITE_MODEL ||
    normalizedModel === STABLE_IMAGE_MODEL
  ) {
    return normalizedModel;
  }

  return LEGACY_MODEL_ALIASES[normalizedModel] ?? normalizedModel;
}

export function isImageGenerationModel(model?: string | null) {
  if (!model) return false;
  return normalizeGeminiModelName(model).includes("image");
}

export function getPreferredTextModelPreference(): TextModelPreference {
  if (typeof window === "undefined") {
    return DEFAULT_TEXT_MODEL_PREFERENCE;
  }

  const savedPreference = window.localStorage.getItem(TEXT_MODEL_STORAGE_KEY);
  return savedPreference?.trim() || DEFAULT_TEXT_MODEL_PREFERENCE;
}

export function setPreferredTextModelPreference(
  model: TextModelPreference,
) {
  if (typeof window === "undefined") return;

  const normalizedModel = model.trim();
  if (!normalizedModel) {
    window.localStorage.removeItem(TEXT_MODEL_STORAGE_KEY);
  } else {
    window.localStorage.setItem(TEXT_MODEL_STORAGE_KEY, normalizedModel);
  }
  emitAiModelPreferenceChanged();
}
