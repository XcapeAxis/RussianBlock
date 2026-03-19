import { TetrisEngine } from "./engine.js";

export const REPLAY_VERSION = 1;
const MARKER_INTERVAL_MS = 2400;

export function createReplayId() {
  return `replay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createRunId() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function applyReplayAction(engine, action) {
  switch (action.type) {
    case "step_left":
      engine.moveHorizontal(-1);
      break;
    case "step_right":
      engine.moveHorizontal(1);
      break;
    case "rotate_cw":
      engine.rotate(1);
      break;
    case "hard_drop":
      engine.hardDrop();
      break;
    case "hold":
      engine.holdCurrentPiece();
      break;
    case "soft_drop_step":
      engine.softDropStep();
      break;
    case "pause_toggle":
      engine.togglePause();
      break;
    default:
      break;
  }
}

export class ReplayRecorder {
  constructor({ themeId, config, initialSnapshot }) {
    this.replayId = createReplayId();
    this.themeId = themeId;
    this.config = { ...config };
    this.actions = [];
    this.markers = [
      {
        at: 0,
        reason: "start",
        snapshot: initialSnapshot,
      },
    ];
    this.lastMarkerAt = 0;
  }

  recordAction(type, at, payload) {
    this.actions.push({
      at: Math.max(0, Math.floor(at)),
      type,
      ...(payload ? { payload } : {}),
    });
  }

  captureMarker(at, snapshot, reason = "interval", meta = null) {
    const timestamp = Math.max(0, Math.floor(at));
    if (timestamp - this.lastMarkerAt < MARKER_INTERVAL_MS && reason === "interval") {
      return;
    }
    this.markers.push({
      at: timestamp,
      reason,
      snapshot,
      ...(meta ? { meta: { ...meta } } : {}),
    });
    this.lastMarkerAt = timestamp;
  }

  finalize({ durationMs, result, finalSnapshot }) {
    this.captureMarker(durationMs, finalSnapshot, "final");
    return {
      version: REPLAY_VERSION,
      replayId: this.replayId,
      createdAt: new Date().toISOString(),
      themeId: this.themeId,
      seed: this.config.seed,
      mode: this.config.gameMode,
      config: { ...this.config },
      durationMs: Math.max(0, Math.floor(durationMs)),
      result: { ...result },
      inputs: [...this.actions],
      markers: [...this.markers],
    };
  }
}

export class ReplayPlayer {
  constructor(replay, { startAtMs = 0 } = {}) {
    this.replay = replay;
    this.engine = new TetrisEngine({ bestScore: replay.result?.bestScore ?? 0 });
    this.elapsedMs = 0;
    this.inputIndex = 0;
    this.finished = false;
    this.seek(startAtMs);
  }

  seek(targetMs) {
    const boundedTarget = Math.max(0, Math.min(targetMs, this.replay.durationMs));
    const marker = this.findMarker(boundedTarget);

    if (marker) {
      this.engine.importSnapshot(marker.snapshot);
      this.elapsedMs = marker.at;
      this.inputIndex = this.findInputIndex(marker.at);
    } else {
      this.engine.startNewGame(this.replay.config);
      this.elapsedMs = 0;
      this.inputIndex = 0;
    }

    this.fastForwardTo(boundedTarget);
    this.finished = boundedTarget >= this.replay.durationMs;
  }

  findMarker(targetMs) {
    let candidate = null;
    for (const marker of this.replay.markers ?? []) {
      if (marker.at <= targetMs) {
        candidate = marker;
      } else {
        break;
      }
    }
    return candidate;
  }

  findInputIndex(atMs) {
    const inputs = this.replay.inputs ?? [];
    let index = 0;
    while (index < inputs.length && inputs[index].at < atMs) {
      index += 1;
    }
    return index;
  }

  fastForwardTo(targetMs) {
    while (this.inputIndex < (this.replay.inputs?.length ?? 0) && this.replay.inputs[this.inputIndex].at <= targetMs) {
      const action = this.replay.inputs[this.inputIndex];
      this.engine.update(action.at - this.elapsedMs);
      this.elapsedMs = action.at;
      applyReplayAction(this.engine, action);
      this.inputIndex += 1;
    }

    if (targetMs > this.elapsedMs) {
      this.engine.update(targetMs - this.elapsedMs);
      this.elapsedMs = targetMs;
    }
  }

  update(deltaMs) {
    if (this.finished) {
      return;
    }

    const nextTime = Math.min(this.replay.durationMs, this.elapsedMs + deltaMs);
    this.fastForwardTo(nextTime);
    this.finished = nextTime >= this.replay.durationMs;
  }
}

export function buildReplayClip(replay, windowMs) {
  return {
    replay,
    startAtMs: Math.max(0, replay.durationMs - windowMs),
  };
}
