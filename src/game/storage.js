import { DEFAULT_THEME_ID, isThemeId } from "./themes.js";

const STORAGE_KEY = "russian-block-settings";

const DEFAULT_SETTINGS = {
  bestScore: 0,
  muted: false,
  themeId: DEFAULT_THEME_ID,
};

export function loadSettings() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw);
    return {
      bestScore: Number(parsed.bestScore) || 0,
      muted: Boolean(parsed.muted),
      themeId: isThemeId(parsed.themeId) ? parsed.themeId : DEFAULT_THEME_ID,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(nextSettings) {
  const payload = {
    bestScore: Number(nextSettings.bestScore) || 0,
    muted: Boolean(nextSettings.muted),
    themeId: isThemeId(nextSettings.themeId) ? nextSettings.themeId : DEFAULT_THEME_ID,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
