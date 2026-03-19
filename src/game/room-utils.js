export const ROOM_MODE_IDS = ["sprint", "ultra"];
export const ROOM_FILTER_IDS = ["all", "sprint", "ultra"];
export const ROOM_STATUS_IDS = ["waiting", "ready", "playing", "finished", "expired"];
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CAPACITY = 2;

export function sanitizeRoomMode(modeId) {
  return ROOM_MODE_IDS.includes(modeId) ? modeId : ROOM_MODE_IDS[0];
}

export function sanitizeRoomFilter(filterId) {
  return ROOM_FILTER_IDS.includes(filterId) ? filterId : ROOM_FILTER_IDS[0];
}

export function sanitizeRoomCode(code) {
  return String(code ?? "")
    .replace(/\D+/g, "")
    .slice(0, ROOM_CODE_LENGTH);
}

export function isRoomJoinable(room) {
  return Boolean(room) && ["waiting", "ready"].includes(room.status) && Number(room.openSlots ?? 0) > 0 && !room.expired;
}

export function getRoomModeLabel(modeId) {
  return modeId === "ultra" ? "极限 120 秒" : "冲刺 40 行";
}

export function getRoomStatusCopy(room) {
  if (!room) {
    return "";
  }
  if (room.expired || room.status === "expired") {
    return "已过期";
  }
  if (room.status === "finished") {
    return "已结束";
  }
  if (room.status === "playing") {
    return "对战中";
  }
  if (room.status === "ready") {
    return "已就绪";
  }
  return Number(room.players?.length ?? 0) >= ROOM_CAPACITY ? "已满员" : "等待中";
}

export function summarizeRoomProgress(room) {
  if (!room) {
    return "";
  }
  const playerCount = Number(room.players?.length ?? 0);
  if (room.expired || room.status === "expired") {
    return "房间已过期";
  }
  if (room.status === "finished") {
    return `第 ${room.roundNumber ?? 1} 局已结束`;
  }
  if (room.status === "playing") {
    return `第 ${room.roundNumber ?? 1} 局进行中`;
  }
  return `${playerCount}/${ROOM_CAPACITY} 名玩家`;
}

function normalizeRoomResult(result = {}) {
  return {
    score: Number(result.score) || 0,
    lines: Number(result.lines) || 0,
    durationMs: Number(result.durationMs) || 0,
    completed:
      result.completed === true ||
      result.mode === "completed" ||
      result.resultReason === "target-lines" ||
      Number(result.lines) >= 40,
  };
}

export function compareRoomResults(modeId, leftResult, rightResult) {
  const mode = sanitizeRoomMode(modeId);
  const left = normalizeRoomResult(leftResult);
  const right = normalizeRoomResult(rightResult);

  if (mode === "sprint") {
    if (left.completed !== right.completed) {
      return left.completed ? -1 : 1;
    }
    if (left.completed && right.completed && left.durationMs !== right.durationMs) {
      return left.durationMs - right.durationMs;
    }
    if (left.lines !== right.lines) {
      return right.lines - left.lines;
    }
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    return left.durationMs - right.durationMs;
  }

  if (left.score !== right.score) {
    return right.score - left.score;
  }
  if (left.lines !== right.lines) {
    return right.lines - left.lines;
  }
  return left.durationMs - right.durationMs;
}

export function evaluateRoomWinner(modeId, results = []) {
  if (!Array.isArray(results) || results.length < 2) {
    return null;
  }

  const ordered = [...results].sort((left, right) => {
    const comparison = compareRoomResults(modeId, left, right);
    if (comparison !== 0) {
      return comparison;
    }
    return Number(left.slot ?? 0) - Number(right.slot ?? 0);
  });

  const first = ordered[0];
  const second = ordered[1];
  const comparison = compareRoomResults(modeId, first, second);

  return {
    winnerSlot: comparison === 0 ? null : Number(first.slot ?? 0),
    outcome: comparison === 0 ? "draw" : "win",
    ordered,
  };
}
