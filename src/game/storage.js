import { DEFAULT_THEME_ID, isThemeId } from "./themes.js";
import { DEFAULT_GAME_MODE, normalizeSeed, sanitizeGameMode } from "./modes.js";

const STORAGE_KEY = "russian-block-settings";

const DEFAULT_SETTINGS = {
  bestScore: 0,
  muted: false,
  themeId: DEFAULT_THEME_ID,
  lastMode: DEFAULT_GAME_MODE,
  lastSeed: normalizeSeed("starter-seed"),
  autoStartLastMode: true,
  ghostEnabled: true,
  apiBase: "",
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
      lastMode: sanitizeGameMode(parsed.lastMode),
      lastSeed: normalizeSeed(parsed.lastSeed),
      autoStartLastMode: parsed.autoStartLastMode !== false,
      ghostEnabled: parsed.ghostEnabled !== false,
      apiBase: typeof parsed.apiBase === "string" ? parsed.apiBase.trim() : "",
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
    lastMode: sanitizeGameMode(nextSettings.lastMode),
    lastSeed: normalizeSeed(nextSettings.lastSeed),
    autoStartLastMode: nextSettings.autoStartLastMode !== false,
    ghostEnabled: nextSettings.ghostEnabled !== false,
    apiBase: typeof nextSettings.apiBase === "string" ? nextSettings.apiBase.trim() : "",
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
