import { DEFAULT_THEME_ID, isThemeId } from "./themes.js";
import { DEFAULT_GAME_MODE, normalizeSeed, sanitizeGameMode } from "./modes.js";

const STORAGE_KEY = "russian-block-settings";
const ROOM_TOKENS_KEY = "russian-block-room-tokens";

const DEFAULT_SETTINGS = {
  bestScore: 0,
  muted: false,
  themeId: DEFAULT_THEME_ID,
  lastMode: DEFAULT_GAME_MODE,
  lastSeed: normalizeSeed("starter-seed"),
  autoStartLastMode: false,
  ghostEnabled: true,
  devApiBase: "",
  nickname: "",
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
      autoStartLastMode: Boolean(parsed.autoStartLastMode),
      ghostEnabled: parsed.ghostEnabled !== false,
      devApiBase:
        typeof parsed.devApiBase === "string"
          ? parsed.devApiBase.trim()
          : typeof parsed.apiBase === "string"
            ? parsed.apiBase.trim()
            : "",
      nickname: typeof parsed.nickname === "string" ? parsed.nickname.trim().slice(0, 24) : "",
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
    autoStartLastMode: Boolean(nextSettings.autoStartLastMode),
    ghostEnabled: nextSettings.ghostEnabled !== false,
    devApiBase: typeof nextSettings.devApiBase === "string" ? nextSettings.devApiBase.trim() : "",
    nickname: typeof nextSettings.nickname === "string" ? nextSettings.nickname.trim().slice(0, 24) : "",
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function loadRoomTokens() {
  try {
    const raw = window.localStorage.getItem(ROOM_TOKENS_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([roomCode, token]) => [String(roomCode), typeof token === "string" ? token.trim() : ""])
        .filter(([, token]) => token.length > 0)
    );
  } catch {
    return {};
  }
}

export function saveRoomTokens(tokens) {
  const payload =
    tokens && typeof tokens === "object"
      ? Object.fromEntries(
          Object.entries(tokens)
            .map(([roomCode, token]) => [String(roomCode), typeof token === "string" ? token.trim() : ""])
            .filter(([, token]) => token.length > 0)
        )
      : {};
  window.localStorage.setItem(ROOM_TOKENS_KEY, JSON.stringify(payload));
}
