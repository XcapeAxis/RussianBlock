export const GAME_MODES = {
  marathon: {
    id: "marathon",
    name: "Marathon",
    label: "经典爬分",
    description: "传统无限模式，越打越快。",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: false,
  },
  sprint: {
    id: "sprint",
    name: "Sprint 40L",
    label: "40 行竞速",
    description: "以最短时间消掉 40 行。",
    targetLines: 40,
    timeLimitMs: null,
    usesSeed: false,
  },
  ultra: {
    id: "ultra",
    name: "Ultra 120s",
    label: "120 秒冲分",
    description: "两分钟内尽可能拿高分。",
    targetLines: null,
    timeLimitMs: 120000,
    usesSeed: false,
  },
  seed_challenge: {
    id: "seed_challenge",
    name: "Challenge Seed",
    label: "固定种子挑战",
    description: "用同一条随机种子反复挑战。",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: true,
  },
  puzzle: {
    id: "puzzle",
    name: "Puzzle",
    label: "残局挑战",
    description: "保留给后续残局工坊和题面挑战。",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: true,
  },
  boss: {
    id: "boss",
    name: "Boss",
    label: "Boss Mode",
    description: "保留给实验玩法。",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: false,
  },
  gravity_shift: {
    id: "gravity_shift",
    name: "Gravity Shift",
    label: "重力反转",
    description: "保留给实验玩法。",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: false,
  },
  dual_board: {
    id: "dual_board",
    name: "Dual Board",
    label: "双棋盘高压",
    description: "保留给实验玩法。",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: false,
  },
  rhythm: {
    id: "rhythm",
    name: "Rhythm",
    label: "节奏模式",
    description: "保留给实验玩法。",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: false,
  },
};

export const PLAYABLE_PHASE_ONE_MODES = ["marathon", "sprint", "ultra", "seed_challenge"];
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
  const rawSeed = partial.seed;

  return {
    gameMode,
    label: definition.label,
    description: definition.description,
    usesSeed: definition.usesSeed,
    seed: definition.usesSeed || rawSeed ? normalizeSeed(rawSeed) : createSeed(),
    targetLines: definition.targetLines,
    timeLimitMs: definition.timeLimitMs,
  };
}

export function getModeDefinition(modeId) {
  return GAME_MODES[sanitizeGameMode(modeId)];
}
