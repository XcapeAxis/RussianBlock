import {
  BOARD_COLS,
  BOARD_ROWS,
  BUFFER_ROWS,
  LINE_CLEAR_POINTS,
  PREVIEW_COUNT,
  VISIBLE_ROWS,
} from "./constants.js";
import { createPiece, getKickCandidates, getPieceCells } from "./pieces.js";
import { RandomBag } from "./random-bag.js";

function createEmptyRow() {
  return Array.from({ length: BOARD_COLS }, () => null);
}

function createEmptyBoard() {
  return Array.from({ length: BOARD_ROWS }, createEmptyRow);
}

function clonePiece(piece) {
  return { ...piece };
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
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.activePiece = null;
    this.holdPieceType = null;
    this.canHold = true;
    this.gravityAccumulator = 0;
  }

  startNewGame() {
    this.board = createEmptyBoard();
    this.queue = [];
    this.effects = [];
    this.mode = "playing";
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.holdPieceType = null;
    this.canHold = true;
    this.gravityAccumulator = 0;

    while (this.queue.length < PREVIEW_COUNT + 1) {
      this.queue.push(this.randomBag.next());
    }

    this.spawnNextPiece();
  }

  restart() {
    this.startNewGame();
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

    this.gravityAccumulator += deltaMs;
    const interval = this.getGravityInterval();
    while (this.gravityAccumulator >= interval) {
      this.gravityAccumulator -= interval;
      if (!this.stepDown()) {
        break;
      }
    }
  }

  getGravityInterval() {
    return Math.max(110, 860 - (this.level - 1) * 62);
  }

  moveHorizontal(direction) {
    if (this.mode !== "playing" || !this.activePiece) {
      return false;
    }
    return this.tryMove(direction, 0);
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
        this.finishGame();
      }
    } else {
      this.holdPieceType = currentType;
      this.spawnNextPiece();
    }

    this.canHold = false;
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

    const cleared = this.clearCompletedLines();
    if (cleared > 0) {
      this.score += LINE_CLEAR_POINTS[cleared] * this.level;
      this.lines += cleared;
      this.level = Math.floor(this.lines / 10) + 1;
      this.effects.push({ type: "line-clear", cleared });
    } else {
      this.effects.push({ type: "drop" });
    }

    this.updateBestScore();
    this.canHold = true;
    this.gravityAccumulator = 0;
    this.spawnNextPiece();
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
      this.finishGame();
    }
  }

  finishGame() {
    this.mode = "gameover";
    this.updateBestScore();
    this.effects.push({ type: "gameover" });
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
    const rows = this.board
      .slice(BUFFER_ROWS)
      .map((row) => [...row]);

    for (const cell of this.getActiveCells()) {
      const visibleY = cell.y - BUFFER_ROWS;
      if (visibleY >= 0 && visibleY < VISIBLE_ROWS) {
        rows[visibleY][cell.x] = cell.type;
      }
    }

    return rows;
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
      coordinateSystem: "origin top-left; x increases right; y increases down",
      score: this.score,
      bestScore: this.bestScore,
      lines: this.lines,
      level: this.level,
      holdPiece: this.holdPieceType,
      nextQueue: this.queue.slice(0, PREVIEW_COUNT),
      activePiece,
      ghostY: this.activePiece ? this.getGhostY() - BUFFER_ROWS : null,
      board: this.getVisibleBoard().map((row) => row.map((cell) => cell ?? ".").join("")),
    };
  }
}
