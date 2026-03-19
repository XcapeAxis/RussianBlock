import { getModeDefinition, sanitizeGameMode } from "./modes.js";

export const GHOST_DUEL_SUPPORTED_MODES = ["sprint", "ultra"];

export function sanitizeGhostDuelMode(modeId) {
  const sanitized = sanitizeGameMode(modeId);
  return GHOST_DUEL_SUPPORTED_MODES.includes(sanitized) ? sanitized : "sprint";
}

export function resolveGhostReplayMode(replay) {
  const candidates = [
    replay?.duelMode,
    replay?.ghostSummary?.duelMode,
    replay?.config?.duelMode,
    replay?.mode,
    replay?.config?.gameMode,
  ];

  for (const candidate of candidates) {
    const mode = sanitizeGhostDuelMode(candidate);
    if (GHOST_DUEL_SUPPORTED_MODES.includes(mode) && sanitizeGameMode(candidate) === mode) {
      return mode;
    }
  }

  return null;
}

export function isGhostReplaySupported(replay) {
  return Boolean(resolveGhostReplayMode(replay));
}

export function buildGhostDuelLabel(modeId) {
  const mode = getModeDefinition(sanitizeGhostDuelMode(modeId));
  return `影子挑战 / ${mode.name}`;
}

function isCompletedSprint(summary) {
  return (
    String(summary?.outcome ?? "") === "completed" ||
    String(summary?.reason ?? "") === "target-lines" ||
    Number(summary?.lines) >= 40
  );
}

export function compareRunsForMode(modeId, left, right) {
  const mode = sanitizeGhostDuelMode(modeId);
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }

  if (mode === "sprint") {
    const leftCompleted = isCompletedSprint(left);
    const rightCompleted = isCompletedSprint(right);
    if (leftCompleted !== rightCompleted) {
      return leftCompleted ? 1 : -1;
    }
    if (leftCompleted && rightCompleted) {
      const durationGap = (Number(right.durationMs) || 0) - (Number(left.durationMs) || 0);
      if (durationGap !== 0) {
        return durationGap;
      }
    }
    const lineGap = (Number(left.lines) || 0) - (Number(right.lines) || 0);
    if (lineGap !== 0) {
      return lineGap;
    }
    const scoreGap = (Number(left.score) || 0) - (Number(right.score) || 0);
    if (scoreGap !== 0) {
      return scoreGap;
    }
    const durationGap = (Number(right.durationMs) || 0) - (Number(left.durationMs) || 0);
    if (durationGap !== 0) {
      return durationGap;
    }
    return 0;
  }

  const scoreGap = (Number(left.score) || 0) - (Number(right.score) || 0);
  if (scoreGap !== 0) {
    return scoreGap;
  }
  const lineGap = (Number(left.lines) || 0) - (Number(right.lines) || 0);
  if (lineGap !== 0) {
    return lineGap;
  }
  return (Number(right.durationMs) || 0) - (Number(left.durationMs) || 0);
}

export function evaluateGhostRaceResult(modeId, playerSummary, ghostSummary) {
  const duelMode = sanitizeGhostDuelMode(modeId);
  const comparison = compareRunsForMode(duelMode, playerSummary, ghostSummary);
  const outcome = comparison > 0 ? "win" : comparison < 0 ? "lose" : "draw";

  if (duelMode === "sprint") {
    const playerCompleted = isCompletedSprint(playerSummary);
    const ghostCompleted = isCompletedSprint(ghostSummary);
    if (playerCompleted || ghostCompleted) {
      return {
        outcome,
        metric: "time",
        playerValue: Number(playerSummary?.durationMs) || 0,
        ghostValue: Number(ghostSummary?.durationMs) || 0,
      };
    }
    return {
      outcome,
      metric: "lines",
      playerValue: Number(playerSummary?.lines) || 0,
      ghostValue: Number(ghostSummary?.lines) || 0,
    };
  }

  if ((Number(playerSummary?.score) || 0) !== (Number(ghostSummary?.score) || 0)) {
    return {
      outcome,
      metric: "score",
      playerValue: Number(playerSummary?.score) || 0,
      ghostValue: Number(ghostSummary?.score) || 0,
    };
  }

  if ((Number(playerSummary?.lines) || 0) !== (Number(ghostSummary?.lines) || 0)) {
    return {
      outcome,
      metric: "lines",
      playerValue: Number(playerSummary?.lines) || 0,
      ghostValue: Number(ghostSummary?.lines) || 0,
    };
  }

  return {
    outcome,
    metric: "time",
    playerValue: Number(playerSummary?.durationMs) || 0,
    ghostValue: Number(ghostSummary?.durationMs) || 0,
  };
}

export function pickHighlightMarker(replay) {
  const markers = Array.isArray(replay?.markers) ? replay.markers : [];
  const priorities = [
    (marker) => marker?.reason === "tspin",
    (marker) => marker?.reason === "line-clear" && Number(marker?.meta?.cleared) >= 4,
    (marker) => marker?.reason === "completed",
    (marker) => marker?.reason === "gameover",
    (marker) => marker?.reason === "line-clear",
    (marker) => marker?.reason === "start",
  ];

  for (const isMatch of priorities) {
    const match = [...markers].reverse().find(isMatch);
    if (match) {
      return {
        at: Math.max(0, Number(match.at) || 0),
        reason: String(match.reason ?? "start"),
      };
    }
  }

  return {
    at: Math.max(0, Number(replay?.durationMs) || 0),
    reason: "start",
  };
}
