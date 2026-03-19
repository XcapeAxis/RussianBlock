export const GAME_MODES = {
  marathon: {
    id: "marathon",
    name: "马拉松",
    label: "经典马拉松",
    description: "经典无尽得分模式，重力会不断加快，坚持越久分数越高。",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: false,
  },
  sprint: {
    id: "sprint",
    name: "冲刺 40 行",
    label: "40 行冲刺",
    description: "以最快速度消除 40 行。",
    targetLines: 40,
    timeLimitMs: null,
    usesSeed: false,
  },
  ultra: {
    id: "ultra",
    name: "极限 120 秒",
    label: "120 秒极限",
    description: "在两分钟内尽可能拿到更高分数。",
    targetLines: null,
    timeLimitMs: 120000,
    usesSeed: false,
  },
  seed_challenge: {
    id: "seed_challenge",
    name: "固定种子",
    label: "固定种子挑战",
    description: "反复挑战同一个种子，优化自己的路线和节奏。",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: true,
  },
  ghost_race: {
    id: "ghost_race",
    name: "影子挑战",
    label: "影子挑战",
    description: "与回放影子同种子竞速，支持冲刺和极限模式。",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: false,
  },
  puzzle: {
    id: "puzzle",
    name: "残局",
    label: "残局模式",
    description: "预留给未来的手工残局挑战。",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: true,
  },
  boss: {
    id: "boss",
    name: "首领",
    label: "首领模式",
    description: "预留给未来的实验型首领玩法。",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: false,
  },
  gravity_shift: {
    id: "gravity_shift",
    name: "重力反转",
    label: "重力反转",
    description: "实验生存模式，每 18 秒上下重力翻转一次。",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: false,
  },
  dual_board: {
    id: "dual_board",
    name: "双棋盘",
    label: "双棋盘模式",
    description: "预留给未来的双棋盘实验玩法。",
    targetLines: null,
    timeLimitMs: null,
    usesSeed: false,
  },
  rhythm: {
    id: "rhythm",
    name: "节奏",
    label: "节奏模式",
    description: "预留给未来的音乐节奏玩法。",
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
  const label = gameMode === "ghost_race" ? `${definition.label} / ${duelDefinition.name}` : definition.label;
  const description =
    gameMode === "ghost_race"
      ? `${definition.description} 当前规则：${duelDefinition.name}。`
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
