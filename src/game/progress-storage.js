import { DEFAULT_GAME_MODE, sanitizeGameMode } from "./modes.js";

const PROFILE_KEY = "russian-block-profile";
const MAX_RUNS = 12;
const MAX_REPLAYS = 6;

function createEmptyStats() {
  return {
    totalRuns: 0,
    totalCompletedRuns: 0,
    totalScore: 0,
    totalLines: 0,
    totalPlayMs: 0,
    bestScore: 0,
    bestCombo: 0,
    bestByMode: {},
  };
}

function createDefaultProfile() {
  return {
    runs: [],
    replays: {},
    stats: createEmptyStats(),
  };
}

function sanitizeRun(run) {
  if (!run || typeof run !== "object") {
    return null;
  }

  return {
    id: String(run.id ?? ""),
    gameMode: sanitizeGameMode(run.gameMode),
    label: String(run.label ?? ""),
    outcome: String(run.outcome ?? "gameover"),
    score: Number(run.score) || 0,
    lines: Number(run.lines) || 0,
    level: Number(run.level) || 1,
    durationMs: Number(run.durationMs) || 0,
    seed: String(run.seed ?? ""),
    combo: Number(run.combo) || 0,
    b2b: Number(run.b2b) || 0,
    themeId: String(run.themeId ?? "classic"),
    createdAt: String(run.createdAt ?? new Date().toISOString()),
    replayId: String(run.replayId ?? ""),
    reason: String(run.reason ?? ""),
  };
}

function sanitizeReplayMap(replays) {
  if (!replays || typeof replays !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(replays)
      .filter(([key, value]) => typeof key === "string" && value && typeof value === "object")
      .map(([key, value]) => [key, value])
  );
}

function sanitizeStats(stats) {
  if (!stats || typeof stats !== "object") {
    return createEmptyStats();
  }

  const bestByMode = {};
  Object.entries(stats.bestByMode ?? {}).forEach(([mode, value]) => {
    bestByMode[sanitizeGameMode(mode)] = Math.max(0, Number(value) || 0);
  });

  return {
    totalRuns: Math.max(0, Number(stats.totalRuns) || 0),
    totalCompletedRuns: Math.max(0, Number(stats.totalCompletedRuns) || 0),
    totalScore: Math.max(0, Number(stats.totalScore) || 0),
    totalLines: Math.max(0, Number(stats.totalLines) || 0),
    totalPlayMs: Math.max(0, Number(stats.totalPlayMs) || 0),
    bestScore: Math.max(0, Number(stats.bestScore) || 0),
    bestCombo: Math.max(0, Number(stats.bestCombo) || 0),
    bestByMode,
  };
}

export function loadProfile() {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) {
      return createDefaultProfile();
    }

    const parsed = JSON.parse(raw);
    return {
      runs: Array.isArray(parsed.runs)
        ? parsed.runs.map(sanitizeRun).filter(Boolean).slice(0, MAX_RUNS)
        : [],
      replays: sanitizeReplayMap(parsed.replays),
      stats: sanitizeStats(parsed.stats),
    };
  } catch {
    return createDefaultProfile();
  }
}

export function saveProfile(profile) {
  const payload = {
    runs: Array.isArray(profile.runs) ? profile.runs.slice(0, MAX_RUNS) : [],
    replays: sanitizeReplayMap(profile.replays),
    stats: sanitizeStats(profile.stats),
  };
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(payload));
}

export function recordRun(profile, runSummary, replay) {
  const nextProfile = {
    runs: [...profile.runs],
    replays: { ...profile.replays },
    stats: sanitizeStats(profile.stats),
  };

  nextProfile.runs.unshift(runSummary);
  nextProfile.runs = nextProfile.runs.slice(0, MAX_RUNS);

  if (replay && runSummary.replayId) {
    nextProfile.replays[runSummary.replayId] = replay;
    const replayKeys = Object.keys(nextProfile.replays);
    if (replayKeys.length > MAX_REPLAYS) {
      replayKeys
        .filter((key) => !nextProfile.runs.some((run) => run.replayId === key))
        .slice(0, Math.max(0, replayKeys.length - MAX_REPLAYS))
        .forEach((key) => {
          delete nextProfile.replays[key];
        });
    }
  }

  nextProfile.stats.totalRuns += 1;
  nextProfile.stats.totalScore += runSummary.score;
  nextProfile.stats.totalLines += runSummary.lines;
  nextProfile.stats.totalPlayMs += runSummary.durationMs;
  nextProfile.stats.bestScore = Math.max(nextProfile.stats.bestScore, runSummary.score);
  nextProfile.stats.bestCombo = Math.max(nextProfile.stats.bestCombo, runSummary.combo);
  nextProfile.stats.bestByMode[runSummary.gameMode] = Math.max(
    nextProfile.stats.bestByMode[runSummary.gameMode] ?? 0,
    runSummary.score
  );
  if (runSummary.outcome === "completed") {
    nextProfile.stats.totalCompletedRuns += 1;
  }

  return nextProfile;
}

export function getReplayForRun(profile, replayId) {
  return replayId ? profile.replays[replayId] ?? null : null;
}

export function getBestScoreForMode(profile, gameMode) {
  return profile.stats.bestByMode[sanitizeGameMode(gameMode)] ?? 0;
}

export { DEFAULT_GAME_MODE };
