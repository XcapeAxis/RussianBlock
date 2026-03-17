import {
  BOARD_COLS,
  BOARD_ROWS,
  BUFFER_ROWS,
  COMBO_STEP_POINTS,
  LINE_CLEAR_POINTS,
  LOCK_DELAY_MS,
  PREVIEW_COUNT,
  T_SPIN_POINTS,
  VISIBLE_ROWS,
} from "./constants.js";
import { buildGameConfig } from "./modes.js";
import { createPiece, getKickCandidates, getPieceCells } from "./pieces.js";
import { RandomBag } from "./random-bag.js";

function createEmptyRow() {
  return Array.from({ length: BOARD_COLS }, () => null);
}

function createEmptyBoard() {
  return Array.from({ length: BOARD_ROWS }, createEmptyRow);
}

function clonePiece(piece) {
  return piece ? { ...piece } : null;
}

function cloneBoard(board) {
  return board.map((row) => [...row]);
}

function getLevelFromLines(lines) {
  return Math.floor(lines / 10) + 1;
}

export class TetrisEngine {
  constructor({ bestScore = 0 } = {}) {
    this.bestScore = bestScore;
    this.randomBag = new RandomBag();
    this.resetToMenu();
  }

  resetToMenu() {
    this.board = createEmptyBoard();
    this.queue = [];
    this.effects = [];
    this.mode = "menu";
    this.resultReason = "";
    this.sessionConfig = buildGameConfig();
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.elapsedMs = 0;
    this.remainingMs = null;
    this.combo = 0;
    this.bestCombo = 0;
    this.backToBack = 0;
    this.activePiece = null;
    this.holdPieceType = null;
    this.canHold = true;
    this.gravityAccumulator = 0;
    this.lockAccumulator = 0;
    this.lastRotation = null;
    this.lastClear = {
      cleared: 0,
      tSpin: false,
      combo: 0,
      backToBack: 0,
      points: 0,
    };
  }

  startNewGame(config = {}) {
    this.sessionConfig = buildGameConfig(config);
    this.randomBag.setSeed(this.sessionConfig.seed);
    this.board = createEmptyBoard();
    this.queue = [];
    this.effects = [];
    this.mode = "playing";
    this.resultReason = "";
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.elapsedMs = 0;
    this.remainingMs = this.sessionConfig.timeLimitMs;
    this.combo = 0;
    this.bestCombo = 0;
    this.backToBack = 0;
    this.activePiece = null;
    this.holdPieceType = null;
    this.canHold = true;
    this.gravityAccumulator = 0;
    this.lockAccumulator = 0;
    this.lastRotation = null;
    this.lastClear = {
      cleared: 0,
      tSpin: false,
      combo: 0,
      backToBack: 0,
      points: 0,
    };

    while (this.queue.length < PREVIEW_COUNT + 1) {
      this.queue.push(this.randomBag.next());
    }

    this.spawnNextPiece();
  }

  restart() {
    this.startNewGame(this.sessionConfig);
  }

  togglePause() {
    if (this.mode === "playing") {
      this.mode = "paused";
    } else if (this.mode === "paused") {
      this.mode = "playing";
    }
    return this.mode;
  }

  update(deltaMs) {
    if (this.mode !== "playing" || !this.activePiece) {
      return;
    }

    this.elapsedMs += deltaMs;
    if (this.remainingMs !== null) {
      this.remainingMs = Math.max(0, this.sessionConfig.timeLimitMs - this.elapsedMs);
      if (this.remainingMs === 0) {
        this.finishGame("completed", "time-limit");
        return;
      }
    }

    this.gravityAccumulator += deltaMs;
    const interval = this.getGravityInterval();
    while (this.gravityAccumulator >= interval) {
      this.gravityAccumulator -= interval;
      if (!this.tryMove(0, 1)) {
        break;
      }
    }

    if (this.isGrounded()) {
      this.lockAccumulator += deltaMs;
      if (this.lockAccumulator >= LOCK_DELAY_MS) {
        this.lockPiece();
      }
    } else {
      this.lockAccumulator = 0;
    }
  }

  getGravityInterval() {
    return Math.max(110, 860 - (this.level - 1) * 62);
  }

  moveHorizontal(direction) {
    if (this.mode !== "playing" || !this.activePiece) {
      return false;
    }
    const moved = this.tryMove(direction, 0);
    if (moved) {
      this.resetLockDelay();
      this.lastRotation = null;
    }
    return moved;
  }

  softDropStep() {
    if (this.mode !== "playing" || !this.activePiece) {
      return false;
    }
    if (this.tryMove(0, 1)) {
      this.score += 1;
      this.updateBestScore();
      return true;
    }
    this.lockPiece();
    return false;
  }

  stepDown() {
    if (!this.activePiece) {
      return false;
    }
    if (this.tryMove(0, 1)) {
      return true;
    }
    this.lockPiece();
    return false;
  }

  hardDrop() {
    if (this.mode !== "playing" || !this.activePiece) {
      return 0;
    }

    let distance = 0;
    while (this.tryMove(0, 1)) {
      distance += 1;
    }

    this.score += distance * 2;
    this.updateBestScore();
    this.lockPiece();
    return distance;
  }

  rotate(direction) {
    if (this.mode !== "playing" || !this.activePiece) {
      return false;
    }

    const piece = this.activePiece;
    const nextRotation = (piece.rotation + direction + 4) % 4;
    for (const [kickX, kickY] of getKickCandidates(piece.type)) {
      const targetX = piece.x + kickX;
      const targetY = piece.y + kickY;
      if (!this.collides(piece.type, targetX, targetY, nextRotation)) {
        piece.rotation = nextRotation;
        piece.x = targetX;
        piece.y = targetY;
        this.lastRotation = {
          type: piece.type,
          x: piece.x,
          y: piece.y,
          rotation: piece.rotation,
          usedKick: kickX !== 0 || kickY !== 0,
        };
        this.resetLockDelay();
        return true;
      }
    }

    return false;
  }

  holdCurrentPiece() {
    if (this.mode !== "playing" || !this.activePiece || !this.canHold) {
      return false;
    }

    const currentType = this.activePiece.type;
    if (this.holdPieceType) {
      const nextType = this.holdPieceType;
      this.holdPieceType = currentType;
      this.activePiece = createPiece(nextType);
      if (this.collides(nextType, this.activePiece.x, this.activePiece.y, this.activePiece.rotation)) {
        this.finishGame("gameover", "top-out");
      }
    } else {
      this.holdPieceType = currentType;
      this.spawnNextPiece();
    }

    this.canHold = false;
    this.lastRotation = null;
    this.effects.push({ type: "hold" });
    return true;
  }

  tryMove(deltaX, deltaY) {
    if (!this.activePiece) {
      return false;
    }

    const targetX = this.activePiece.x + deltaX;
    const targetY = this.activePiece.y + deltaY;
    if (this.collides(this.activePiece.type, targetX, targetY, this.activePiece.rotation)) {
      return false;
    }

    this.activePiece.x = targetX;
    this.activePiece.y = targetY;
    if (deltaY > 0) {
      this.lastRotation = null;
    }
    return true;
  }

  collides(type, pieceX, pieceY, rotation) {
    return getPieceCells(type, rotation).some(([cellX, cellY]) => {
      const x = pieceX + cellX;
      const y = pieceY + cellY;
      if (x < 0 || x >= BOARD_COLS || y >= BOARD_ROWS) {
        return true;
      }
      if (y < 0) {
        return false;
      }
      return this.board[y][x] !== null;
    });
  }

  isGrounded() {
    return (
      Boolean(this.activePiece) &&
      this.collides(this.activePiece.type, this.activePiece.x, this.activePiece.y + 1, this.activePiece.rotation)
    );
  }

  resetLockDelay() {
    if (this.isGrounded()) {
      this.lockAccumulator = 0;
    }
  }

  lockPiece() {
    if (!this.activePiece) {
      return;
    }

    const piece = clonePiece(this.activePiece);
    for (const [cellX, cellY] of getPieceCells(piece.type, piece.rotation)) {
      const x = piece.x + cellX;
      const y = piece.y + cellY;
      if (y < 0) {
        continue;
      }
      this.board[y][x] = piece.type;
    }

    const tSpin = this.isTSpin(piece);
    const cleared = this.clearCompletedLines();
    const points = this.applyScoring(cleared, tSpin);

    if (cleared > 0) {
      this.lines += cleared;
      this.level = getLevelFromLines(this.lines);
      this.effects.push({
        type: "line-clear",
        cleared,
        tSpin,
        combo: this.combo,
        backToBack: this.backToBack,
        points,
      });
    } else {
      this.combo = 0;
      this.lastClear = {
        cleared: 0,
        tSpin: false,
        combo: 0,
        backToBack: this.backToBack,
        points: 0,
      };
      this.effects.push({ type: "drop" });
    }

    this.updateBestScore();
    this.canHold = true;
    this.gravityAccumulator = 0;
    this.lockAccumulator = 0;
    this.lastRotation = null;

    if (this.sessionConfig.targetLines && this.lines >= this.sessionConfig.targetLines) {
      this.finishGame("completed", "target-lines");
      return;
    }

    this.spawnNextPiece();
  }

  applyScoring(cleared, tSpin) {
    if (cleared === 0) {
      return 0;
    }

    const basePoints = tSpin ? T_SPIN_POINTS[cleared] ?? 0 : LINE_CLEAR_POINTS[cleared] ?? 0;
    const specialClear = tSpin || cleared === 4;
    let points = basePoints * this.level;

    this.combo = this.combo > 0 ? this.combo + 1 : 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    if (this.combo > 1) {
      points += (this.combo - 1) * COMBO_STEP_POINTS * this.level;
    }

    if (specialClear) {
      this.backToBack = this.backToBack > 0 ? this.backToBack + 1 : 1;
      if (this.backToBack > 1) {
        points += Math.floor(basePoints * 0.5 * this.level);
      }
    } else {
      this.backToBack = 0;
    }

    this.score += points;
    this.lastClear = {
      cleared,
      tSpin,
      combo: this.combo,
      backToBack: this.backToBack,
      points,
    };
    return points;
  }

  isTSpin(piece) {
    if (piece.type !== "T" || !this.lastRotation) {
      return false;
    }

    const centerX = piece.x + 1;
    const centerY = piece.y + 1;
    const corners = [
      [centerX - 1, centerY - 1],
      [centerX + 1, centerY - 1],
      [centerX - 1, centerY + 1],
      [centerX + 1, centerY + 1],
    ];

    const occupiedCorners = corners.filter(([x, y]) => {
      if (x < 0 || x >= BOARD_COLS || y >= BOARD_ROWS) {
        return true;
      }
      if (y < 0) {
        return false;
      }
      return this.board[y][x] !== null;
    });

    return occupiedCorners.length >= 3;
  }

  clearCompletedLines() {
    let cleared = 0;
    const remaining = this.board.filter((row) => {
      const full = row.every(Boolean);
      if (full) {
        cleared += 1;
      }
      return !full;
    });

    while (remaining.length < BOARD_ROWS) {
      remaining.unshift(createEmptyRow());
    }

    this.board = remaining;
    return cleared;
  }

  spawnNextPiece() {
    while (this.queue.length < PREVIEW_COUNT + 1) {
      this.queue.push(this.randomBag.next());
    }

    const nextType = this.queue.shift();
    this.activePiece = createPiece(nextType);
    while (this.queue.length < PREVIEW_COUNT) {
      this.queue.push(this.randomBag.next());
    }

    if (this.collides(nextType, this.activePiece.x, this.activePiece.y, this.activePiece.rotation)) {
      this.finishGame("gameover", "top-out");
    }
  }

  finishGame(nextMode = "gameover", reason = "top-out") {
    this.mode = nextMode;
    this.resultReason = reason;
    this.updateBestScore();
    this.effects.push({ type: nextMode, reason });
  }

  updateBestScore() {
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
    }
  }

  getGhostY() {
    if (!this.activePiece) {
      return null;
    }
    let ghostY = this.activePiece.y;
    while (!this.collides(this.activePiece.type, this.activePiece.x, ghostY + 1, this.activePiece.rotation)) {
      ghostY += 1;
    }
    return ghostY;
  }

  getActiveCells({ ghost = false } = {}) {
    if (!this.activePiece) {
      return [];
    }

    const targetY = ghost ? this.getGhostY() : this.activePiece.y;
    return getPieceCells(this.activePiece.type, this.activePiece.rotation).map(([cellX, cellY]) => ({
      x: this.activePiece.x + cellX,
      y: targetY + cellY,
      type: this.activePiece.type,
    }));
  }

  drainEffects() {
    const next = [...this.effects];
    this.effects.length = 0;
    return next;
  }

  getVisibleBoard() {
    const rows = this.board.slice(BUFFER_ROWS).map((row) => [...row]);

    for (const cell of this.getActiveCells()) {
      const visibleY = cell.y - BUFFER_ROWS;
      if (visibleY >= 0 && visibleY < VISIBLE_ROWS) {
        rows[visibleY][cell.x] = cell.type;
      }
    }

    return rows;
  }

  exportSnapshot() {
    return {
      board: cloneBoard(this.board),
      queue: [...this.queue],
      mode: this.mode,
      resultReason: this.resultReason,
      score: this.score,
      bestScore: this.bestScore,
      lines: this.lines,
      level: this.level,
      elapsedMs: this.elapsedMs,
      remainingMs: this.remainingMs,
      combo: this.combo,
      bestCombo: this.bestCombo,
      backToBack: this.backToBack,
      activePiece: clonePiece(this.activePiece),
      holdPieceType: this.holdPieceType,
      canHold: this.canHold,
      gravityAccumulator: this.gravityAccumulator,
      lockAccumulator: this.lockAccumulator,
      lastRotation: this.lastRotation ? { ...this.lastRotation } : null,
      lastClear: { ...this.lastClear },
      sessionConfig: { ...this.sessionConfig },
      randomBag: this.randomBag.exportState(),
    };
  }

  importSnapshot(snapshot) {
    this.board = cloneBoard(snapshot.board);
    this.queue = [...snapshot.queue];
    this.mode = snapshot.mode;
    this.resultReason = snapshot.resultReason ?? "";
    this.score = snapshot.score;
    this.bestScore = snapshot.bestScore;
    this.lines = snapshot.lines;
    this.level = snapshot.level;
    this.elapsedMs = snapshot.elapsedMs;
    this.remainingMs = snapshot.remainingMs;
    this.combo = snapshot.combo;
    this.bestCombo = snapshot.bestCombo;
    this.backToBack = snapshot.backToBack;
    this.activePiece = clonePiece(snapshot.activePiece);
    this.holdPieceType = snapshot.holdPieceType;
    this.canHold = snapshot.canHold;
    this.gravityAccumulator = snapshot.gravityAccumulator;
    this.lockAccumulator = snapshot.lockAccumulator;
    this.lastRotation = snapshot.lastRotation ? { ...snapshot.lastRotation } : null;
    this.lastClear = { ...snapshot.lastClear };
    this.sessionConfig = { ...snapshot.sessionConfig };
    this.randomBag.importState(snapshot.randomBag);
    this.effects = [];
  }

  serializeState() {
    const activePiece = this.activePiece
      ? {
          type: this.activePiece.type,
          x: this.activePiece.x,
          y: this.activePiece.y - BUFFER_ROWS,
          rotation: this.activePiece.rotation,
        }
      : null;

    return {
      mode: this.mode,
      resultReason: this.resultReason,
      gameMode: this.sessionConfig.gameMode,
      seed: this.sessionConfig.seed,
      coordinateSystem: "origin top-left; x increases right; y increases down",
      score: this.score,
      bestScore: this.bestScore,
      lines: this.lines,
      level: this.level,
      elapsedMs: this.elapsedMs,
      remainingMs: this.remainingMs,
      targetLines: this.sessionConfig.targetLines,
      combo: this.combo,
      bestCombo: this.bestCombo,
      backToBack: this.backToBack,
      lastClear: { ...this.lastClear },
      holdPiece: this.holdPieceType,
      nextQueue: this.queue.slice(0, PREVIEW_COUNT),
      activePiece,
      ghostY: this.activePiece ? this.getGhostY() - BUFFER_ROWS : null,
      board: this.getVisibleBoard().map((row) => row.map((cell) => cell ?? ".").join("")),
    };
  }
}
