export const GAME_MODES = {
  marathon: {
    id: "marathon",
    name: "Marathon",
    label: "Classic Marathon",
    description: "Classic endless scoring. Survive longer as gravity speeds up.",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: false,
  },
  sprint: {
    id: "sprint",
    name: "Sprint 40L",
    label: "Sprint 40 Lines",
    description: "Clear 40 lines as fast as possible.",
    targetLines: 40,
    timeLimitMs: null,
    usesSeed: false,
  },
  ultra: {
    id: "ultra",
    name: "Ultra 120s",
    label: "Ultra 120 Seconds",
    description: "Score as much as possible in two minutes.",
    targetLines: null,
    timeLimitMs: 120000,
    usesSeed: false,
  },
  seed_challenge: {
    id: "seed_challenge",
    name: "Challenge Seed",
    label: "Fixed Seed Run",
    description: "Replay the same seed again and again to optimize your route.",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: true,
  },
  ghost_race: {
    id: "ghost_race",
    name: "Ghost Duel",
    label: "Ghost Duel",
    description: "Race a replay ghost in Sprint or Ultra with a shared seed.",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: false,
  },
  puzzle: {
    id: "puzzle",
    name: "Puzzle",
    label: "Puzzle",
    description: "Reserved for future handcrafted puzzle challenges.",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: true,
  },
  boss: {
    id: "boss",
    name: "Boss",
    label: "Boss Mode",
    description: "Reserved for future experimental boss encounters.",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: false,
  },
  gravity_shift: {
    id: "gravity_shift",
    name: "Gravity Shift",
    label: "Gravity Shift",
    description: "Experimental survival mode with gravity flips every 18 seconds.",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: false,
  },
  dual_board: {
    id: "dual_board",
    name: "Dual Board",
    label: "Dual Board",
    description: "Reserved for future two-board experiments.",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: false,
  },
  rhythm: {
    id: "rhythm",
    name: "Rhythm",
    label: "Rhythm Mode",
    description: "Reserved for a music-driven timing mode.",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: false,
  },
};

export const PLAYABLE_PHASE_ONE_MODES = ["marathon", "sprint", "ultra", "seed_challenge", "ghost_race"];
export const DEFAULT_GAME_MODE = "marathon";

function isKnownMode(modeId) {
  return typeof modeId === "string" && Object.hasOwn(GAME_MODES, modeId);
}

export function sanitizeGameMode(modeId) {
  return isKnownMode(modeId) ? modeId : DEFAULT_GAME_MODE;
}

export function createSeed() {
  const timestampPart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `${timestampPart}-${randomPart}`;
}

export function normalizeSeed(seed) {
  const value = String(seed ?? "").trim();
  return value.length > 0 ? value : createSeed();
}

export function buildGameConfig(partial = {}) {
  const gameMode = sanitizeGameMode(partial.gameMode ?? partial.mode);
  const definition = GAME_MODES[gameMode];
  const duelMode = sanitizeGameMode(partial.duelMode ?? partial.baseMode ?? "sprint");
  const duelDefinition = GAME_MODES[duelMode];
  const rawSeed = partial.seed;

  const targetLines = gameMode === "ghost_race" ? duelDefinition.targetLines : definition.targetLines;
  const timeLimitMs = gameMode === "ghost_race" ? duelDefinition.timeLimitMs : definition.timeLimitMs;
  const label = gameMode === "ghost_race" ? `${definition.label} · ${duelDefinition.name}` : definition.label;
  const description =
    gameMode === "ghost_race"
      ? `${definition.description} Current ruleset: ${duelDefinition.name}.`
      : definition.description;

  return {
    gameMode,
    label,
    description,
    usesSeed: definition.usesSeed,
    seed: definition.usesSeed || rawSeed ? normalizeSeed(rawSeed) : createSeed(),
    targetLines,
    timeLimitMs,
    duelMode: gameMode === "ghost_race" ? duelMode : null,
    gravityShiftEnabled: gameMode === "gravity_shift",
  };
}

export function getModeDefinition(modeId) {
  return GAME_MODES[sanitizeGameMode(modeId)];
}
