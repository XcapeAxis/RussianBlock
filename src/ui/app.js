import {
  BOARD_COLS,
  BUFFER_ROWS,
  COLORS,
  MOVE_REPEAT_DELAY,
  MOVE_REPEAT_INTERVAL,
  SOFT_DROP_INTERVAL,
  VISIBLE_ROWS,
} from "../game/constants.js";
import { AudioManager } from "../game/audio.js";
import { TetrisEngine } from "../game/engine.js";
import { PIECES, getPieceCells } from "../game/pieces.js";
import { loadSettings, saveSettings } from "../game/storage.js";

function formatScore(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function fillRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}

function strokeRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.stroke();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createHoldState() {
  return {
    pressed: false,
    elapsed: 0,
    repeatElapsed: 0,
  };
}

const SINGLE_TAP_DELAY_MS = 180;
const DOUBLE_TAP_WINDOW_MS = 220;
const DOUBLE_TAP_DISTANCE_PX = 24;
const TAP_SLOP_PX = 18;
const HORIZONTAL_GESTURE_RATIO = 0.6;
const SOFT_DROP_GESTURE_RATIO = 0.75;
const HARD_DROP_GESTURE_RATIO = 4.2;
const HARD_DROP_MIN_VELOCITY = 1.85;
const HARD_DROP_VERTICAL_DOMINANCE = 1.6;

function distanceBetweenPoints(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class RussianBlockApp {
  constructor(root) {
    this.root = root;
    this.settings = loadSettings();
    this.query = new URLSearchParams(window.location.search);
    this.audio = new AudioManager({ muted: this.settings.muted });
    this.engine = new TetrisEngine({ bestScore: this.settings.bestScore });
    this.manualTimeControl = typeof window.advanceTime === "function";
    this.installPrompt = null;
    this.lastTimestamp = 0;
    this.currentLayout = null;
    this.activeGesture = null;
    this.pendingTouchTap = null;

    this.horizontalState = {
      left: createHoldState(),
      right: createHoldState(),
    };
    this.softDropState = createHoldState();

    this.renderFrame = this.renderFrame.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleBoardPointerDown = this.handleBoardPointerDown.bind(this);
    this.handleBoardPointerMove = this.handleBoardPointerMove.bind(this);
    this.handleBoardPointerEnd = this.handleBoardPointerEnd.bind(this);

    this.buildDom();
    this.bindEvents();
    if (this.query.get("autostart") === "1") {
      this.startGame();
      if (this.query.get("demo") === "1") {
        this.populateDemoBoard();
      }
    }
    this.updateUiState();
    this.resizeCanvas();
    this.render();

    if (!this.manualTimeControl) {
      requestAnimationFrame(this.renderFrame);
    }

    window.render_game_to_text = () => JSON.stringify(this.engine.serializeState());
    window.advanceTime = (ms) => {
      this.advanceTime(ms);
    };

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  buildDom() {
    this.root.innerHTML = `
      <div class="app-shell">
        <div class="stage" id="stage">
          <canvas id="game-canvas" aria-label="Russian Block"></canvas>
          <div class="top-actions">
            <button type="button" class="ui-chip" id="settings-btn">设置</button>
            <button type="button" class="ui-chip ui-chip--accent" id="pause-btn">暂停</button>
          </div>
          <div class="overlay" id="menu-overlay">
            <div class="overlay-card">
              <span class="eyebrow">Windows / Android Web + PWA</span>
              <h1>Russian Block</h1>
              <p>经典俄罗斯方块，支持键盘、滑屏手势、离线缓存和本地最高分。</p>
              <div class="overlay-actions">
                <button type="button" class="primary-btn" id="start-btn">开始游戏</button>
                <button type="button" class="secondary-btn" id="fullscreen-btn">全屏</button>
              </div>
              <p class="overlay-hint">触屏：左右滑移动，单击旋转，下拖软降，下甩硬降，双击 Hold。键盘：A/D 移动，W 旋转，Space 硬降，C Hold。</p>
            </div>
          </div>
          <div class="overlay overlay--hidden" id="pause-overlay">
            <div class="overlay-card overlay-card--compact">
              <span class="eyebrow">Paused</span>
              <h2>已暂停</h2>
              <div class="overlay-actions">
                <button type="button" class="primary-btn" id="resume-btn">继续</button>
                <button type="button" class="secondary-btn" id="restart-btn">重新开始</button>
              </div>
              <p class="overlay-hint overlay-hint--compact">恢复后继续滑动操作：左右滑移动，单击旋转，下拖软降，下甩硬降。</p>
            </div>
          </div>
          <div class="overlay overlay--hidden" id="gameover-overlay">
            <div class="overlay-card overlay-card--compact">
              <span class="eyebrow">Game Over</span>
              <h2>堆到顶了</h2>
              <p id="gameover-copy">再来一局，刷新你的最高分。</p>
              <div class="overlay-actions">
                <button type="button" class="primary-btn" id="retry-btn">再来一局</button>
                <button type="button" class="secondary-btn" id="menu-btn">回到首页</button>
              </div>
            </div>
          </div>
          <aside class="settings-panel settings-panel--hidden" id="settings-panel">
            <div class="settings-header">
              <h2>设置</h2>
              <button type="button" class="icon-btn" id="close-settings-btn">关闭</button>
            </div>
            <label class="toggle-row">
              <span>静音</span>
              <input type="checkbox" id="mute-toggle" />
            </label>
            <button type="button" class="secondary-btn settings-install settings-install--hidden" id="install-btn">安装到主屏幕</button>
            <p class="settings-note">首次联网打开后会缓存资源，后续可以离线继续玩。</p>
          </aside>
        </div>
      </div>
    `;

    this.canvas = this.root.querySelector("#game-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.stage = this.root.querySelector("#stage");
    this.menuOverlay = this.root.querySelector("#menu-overlay");
    this.pauseOverlay = this.root.querySelector("#pause-overlay");
    this.gameOverOverlay = this.root.querySelector("#gameover-overlay");
    this.gameOverCopy = this.root.querySelector("#gameover-copy");
    this.settingsPanel = this.root.querySelector("#settings-panel");
    this.muteToggle = this.root.querySelector("#mute-toggle");
    this.installButton = this.root.querySelector("#install-btn");
    this.pauseButton = this.root.querySelector("#pause-btn");
  }

  bindEvents() {
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);

    document.addEventListener("fullscreenchange", () => {
      this.resizeCanvas();
    });

    this.root.querySelector("#start-btn").addEventListener("click", () => this.startGame());
    this.root.querySelector("#fullscreen-btn").addEventListener("click", () => this.toggleFullscreen());
    this.root.querySelector("#resume-btn").addEventListener("click", () => this.resumeGame());
    this.root.querySelector("#restart-btn").addEventListener("click", () => this.restartGame());
    this.root.querySelector("#retry-btn").addEventListener("click", () => this.restartGame());
    this.root.querySelector("#menu-btn").addEventListener("click", () => this.returnToMenu());
    this.root.querySelector("#settings-btn").addEventListener("click", () => this.toggleSettings());
    this.pauseButton.addEventListener("click", () => this.togglePause());
    this.root.querySelector("#close-settings-btn").addEventListener("click", () => this.toggleSettings(false));

    this.muteToggle.addEventListener("change", () => {
      this.settings.muted = this.muteToggle.checked;
      this.audio.setMuted(this.settings.muted);
      this.persistSettings();
    });

    this.installButton.addEventListener("click", async () => {
      if (!this.installPrompt) {
        return;
      }
      await this.installPrompt.prompt();
      this.installPrompt = null;
      this.installButton.classList.add("settings-install--hidden");
    });

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      this.installPrompt = event;
      this.installButton.classList.remove("settings-install--hidden");
    });

    this.canvas.addEventListener("pointerdown", this.handleBoardPointerDown);
    this.canvas.addEventListener("pointermove", this.handleBoardPointerMove);
    this.canvas.addEventListener("pointerup", this.handleBoardPointerEnd);
    this.canvas.addEventListener("pointercancel", this.handleBoardPointerEnd);
  }

  handleResize() {
    this.resizeCanvas();
    this.render();
  }

  resizeCanvas() {
    const { width, height } = this.stage.getBoundingClientRect();
    const safeWidth = Math.max(320, Math.floor(width));
    const safeHeight = Math.max(420, Math.floor(height));
    const pixelRatio = window.devicePixelRatio || 1;

    this.canvas.width = safeWidth * pixelRatio;
    this.canvas.height = safeHeight * pixelRatio;
    this.canvas.style.width = `${safeWidth}px`;
    this.canvas.style.height = `${safeHeight}px`;
    this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    this.viewport = { width: safeWidth, height: safeHeight };
  }

  handleKeyDown(event) {
    const key = event.key.toLowerCase();
    const controlKeys = new Set([
      "arrowleft",
      "arrowright",
      "arrowdown",
      "arrowup",
      " ",
      "a",
      "d",
      "s",
      "w",
      "c",
      "p",
      "r",
      "f",
      "escape",
    ]);

    if (controlKeys.has(key)) {
      event.preventDefault();
    }

    if (key === "a" || key === "arrowleft") {
      this.setHorizontalState("left", true);
      return;
    }
    if (key === "d" || key === "arrowright") {
      this.setHorizontalState("right", true);
      return;
    }
    if (key === "s" || key === "arrowdown") {
      this.setSoftDrop(true);
      return;
    }

    if (event.repeat) {
      return;
    }

    this.audio.unlock();

    if (key === "w" || key === "arrowup") {
      if (this.engine.rotate(1)) {
        this.audio.play("click");
      }
    } else if (key === " " || key === "spacebar") {
      this.engine.hardDrop();
      this.audio.play("drop");
    } else if (key === "c") {
      if (this.engine.holdCurrentPiece()) {
        this.audio.play("hold");
      }
    } else if (key === "p" || key === "escape") {
      this.togglePause();
    } else if (key === "r") {
      this.restartGame();
    } else if (key === "f") {
      this.toggleFullscreen();
    }

    this.afterStateChange();
  }

  handleKeyUp(event) {
    const key = event.key.toLowerCase();
    if (key === "a" || key === "arrowleft") {
      this.setHorizontalState("left", false);
    } else if (key === "d" || key === "arrowright") {
      this.setHorizontalState("right", false);
    } else if (key === "s" || key === "arrowdown") {
      this.setSoftDrop(false);
    }
  }

  setHorizontalState(direction, pressed) {
    const state = this.horizontalState[direction];
    if (pressed && !state.pressed) {
      state.pressed = true;
      state.elapsed = 0;
      state.repeatElapsed = 0;
      if (this.engine.moveHorizontal(direction === "left" ? -1 : 1)) {
        this.audio.play("click");
      }
      this.afterStateChange();
      return;
    }

    if (!pressed) {
      state.pressed = false;
      state.elapsed = 0;
      state.repeatElapsed = 0;
    }
  }

  setSoftDrop(pressed) {
    if (pressed && !this.softDropState.pressed) {
      this.softDropState.pressed = true;
      this.softDropState.elapsed = 0;
      this.softDropState.repeatElapsed = 0;
      this.engine.softDropStep();
      this.afterStateChange();
      return;
    }

    if (!pressed) {
      this.softDropState.pressed = false;
      this.softDropState.elapsed = 0;
      this.softDropState.repeatElapsed = 0;
    }
  }

  isSettingsOpen() {
    return !this.settingsPanel.classList.contains("settings-panel--hidden");
  }

  clearPendingTouchTap() {
    if (!this.pendingTouchTap) {
      return;
    }
    window.clearTimeout(this.pendingTouchTap.timerId);
    this.pendingTouchTap = null;
  }

  flushPendingTouchTap() {
    if (!this.pendingTouchTap) {
      return false;
    }
    window.clearTimeout(this.pendingTouchTap.timerId);
    this.pendingTouchTap = null;
    if (this.engine.rotate(1)) {
      this.audio.play("click");
      this.afterStateChange();
      return true;
    }
    this.afterStateChange();
    return false;
  }

  releaseGestureInput() {
    if (this.activeGesture?.softDropActive) {
      this.setSoftDrop(false);
      this.afterStateChange();
    }
    this.activeGesture = null;
  }

  getBoardClientRect() {
    if (!this.currentLayout) {
      return null;
    }

    const canvasRect = this.canvas.getBoundingClientRect();
    return {
      left: canvasRect.left + this.currentLayout.boardX,
      top: canvasRect.top + this.currentLayout.boardY,
      width: this.currentLayout.boardWidth,
      height: this.currentLayout.boardHeight,
      cellSize: this.currentLayout.cellSize,
    };
  }

  canStartBoardGesture(event) {
    if (event.pointerType === "mouse" || this.engine.mode !== "playing" || this.isSettingsOpen()) {
      return false;
    }

    const boardRect = this.getBoardClientRect();
    if (!boardRect) {
      return false;
    }

    return (
      event.clientX >= boardRect.left &&
      event.clientX <= boardRect.left + boardRect.width &&
      event.clientY >= boardRect.top &&
      event.clientY <= boardRect.top + boardRect.height
    );
  }

  handleBoardPointerDown(event) {
    if (!this.canStartBoardGesture(event)) {
      return;
    }

    event.preventDefault();
    this.audio.unlock();
    this.releaseGestureInput();

    const boardRect = this.getBoardClientRect();
    const now = performance.now();
    this.activeGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastMoveTime: now,
      lastVelocityY: 0,
      horizontalCarry: 0,
      movedHorizontally: false,
      softDropActive: false,
      softDropTriggered: false,
      hardDropped: false,
      resolvedPendingTap: false,
      cellSize: boardRect.cellSize,
    };

    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {}
  }

  handleBoardPointerMove(event) {
    const gesture = this.activeGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();

    const now = performance.now();
    const stepX = event.clientX - gesture.lastX;
    const stepY = event.clientY - gesture.lastY;
    const totalX = event.clientX - gesture.startX;
    const totalY = event.clientY - gesture.startY;
    const travelDistance = Math.hypot(totalX, totalY);

    if (!gesture.resolvedPendingTap && this.pendingTouchTap && travelDistance > TAP_SLOP_PX) {
      this.flushPendingTouchTap();
      gesture.resolvedPendingTap = true;
    }

    let changed = false;
    const horizontalThreshold = gesture.cellSize * HORIZONTAL_GESTURE_RATIO;
    gesture.horizontalCarry += stepX;

    while (Math.abs(gesture.horizontalCarry) >= horizontalThreshold) {
      const direction = Math.sign(gesture.horizontalCarry);
      if (this.engine.moveHorizontal(direction)) {
        this.audio.play("click");
        gesture.movedHorizontally = true;
        changed = true;
      }
      gesture.horizontalCarry -= horizontalThreshold * direction;
    }

    if (
      !gesture.softDropActive &&
      !gesture.hardDropped &&
      totalY >= gesture.cellSize * SOFT_DROP_GESTURE_RATIO &&
      totalY > Math.abs(totalX)
    ) {
      this.setSoftDrop(true);
      gesture.softDropActive = true;
      gesture.softDropTriggered = true;
      changed = true;
    }

    const deltaTime = Math.max(1, now - gesture.lastMoveTime);
    const velocityY = stepY / deltaTime;
    gesture.lastVelocityY = velocityY;

    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    gesture.lastMoveTime = now;

    if (changed) {
      this.afterStateChange();
    }
  }

  handleBoardPointerEnd(event) {
    const gesture = this.activeGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {}

    const totalX = event.clientX - gesture.startX;
    const totalY = event.clientY - gesture.startY;
    const travelDistance = Math.hypot(totalX, totalY);
    const now = performance.now();
    const shouldHardDrop =
      event.type === "pointerup" &&
      !gesture.hardDropped &&
      totalY >= gesture.cellSize * HARD_DROP_GESTURE_RATIO &&
      totalY > Math.abs(totalX) * HARD_DROP_VERTICAL_DOMINANCE &&
      gesture.lastVelocityY >= HARD_DROP_MIN_VELOCITY;

    if (gesture.softDropActive) {
      this.setSoftDrop(false);
      this.afterStateChange();
    }

    this.activeGesture = null;

    if (shouldHardDrop) {
      this.clearPendingTouchTap();
      this.engine.hardDrop();
      this.audio.play("drop");
      this.afterStateChange();
      return;
    }

    const shouldTap =
      event.type === "pointerup" &&
      !gesture.hardDropped &&
      !gesture.movedHorizontally &&
      !gesture.softDropTriggered &&
      travelDistance <= TAP_SLOP_PX;

    if (!shouldTap) {
      return;
    }

    const tap = {
      x: event.clientX,
      y: event.clientY,
      time: now,
    };

    if (this.pendingTouchTap) {
      const withinWindow = tap.time - this.pendingTouchTap.time <= DOUBLE_TAP_WINDOW_MS;
      const withinDistance = distanceBetweenPoints(this.pendingTouchTap, tap) <= DOUBLE_TAP_DISTANCE_PX;
      if (withinWindow && withinDistance) {
        this.clearPendingTouchTap();
        if (this.engine.holdCurrentPiece()) {
          this.audio.play("hold");
        }
        this.afterStateChange();
        return;
      }

      this.flushPendingTouchTap();
    }

    const pendingTap = {
      ...tap,
      timerId: 0,
    };
    pendingTap.timerId = window.setTimeout(() => {
      if (this.pendingTouchTap !== pendingTap) {
        return;
      }
      this.pendingTouchTap = null;
      if (this.engine.rotate(1)) {
        this.audio.play("click");
      }
      this.afterStateChange();
    }, SINGLE_TAP_DELAY_MS);

    this.pendingTouchTap = pendingTap;
  }

  startGame() {
    this.audio.unlock();
    this.clearPendingTouchTap();
    this.releaseGestureInput();
    this.engine.startNewGame();
    this.audio.play("click");
    this.afterStateChange();
  }

  populateDemoBoard() {
    const scripts = [
      { moves: -3, rotate: 1 },
      { moves: 2, rotate: 0 },
      { moves: -1, rotate: 1 },
      { moves: 3, rotate: 0 },
      { moves: 0, rotate: 1 },
    ];

    for (const step of scripts) {
      if (this.engine.mode !== "playing") {
        break;
      }
      for (let turn = 0; turn < step.rotate; turn += 1) {
        this.engine.rotate(1);
      }
      const direction = Math.sign(step.moves);
      for (let count = 0; count < Math.abs(step.moves); count += 1) {
        this.engine.moveHorizontal(direction);
      }
      this.engine.hardDrop();
    }
    this.processEffects();
  }

  restartGame() {
    this.audio.unlock();
    this.clearPendingTouchTap();
    this.releaseGestureInput();
    this.engine.restart();
    this.audio.play("click");
    this.afterStateChange();
  }

  resumeGame() {
    if (this.engine.mode === "paused") {
      this.engine.togglePause();
      this.audio.play("click");
      this.afterStateChange();
    }
  }

  returnToMenu() {
    this.clearPendingTouchTap();
    this.releaseGestureInput();
    this.engine.resetToMenu();
    this.audio.play("click");
    this.afterStateChange();
  }

  togglePause() {
    if (this.engine.mode === "menu" || this.engine.mode === "gameover") {
      return;
    }
    this.clearPendingTouchTap();
    this.releaseGestureInput();
    this.engine.togglePause();
    this.audio.play("click");
    this.afterStateChange();
  }

  toggleSettings(force) {
    const shouldOpen =
      typeof force === "boolean"
        ? force
        : this.settingsPanel.classList.contains("settings-panel--hidden");
    this.settingsPanel.classList.toggle("settings-panel--hidden", !shouldOpen);
  }

  async toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await this.stage.requestFullscreen?.();
  }

  persistSettings() {
    this.settings.bestScore = this.engine.bestScore;
    saveSettings(this.settings);
  }

  afterStateChange() {
    this.processEffects();
    this.updateUiState();
    this.render();
  }

  processEffects() {
    for (const effect of this.engine.drainEffects()) {
      if (effect.type === "line-clear") {
        this.audio.play("line-clear");
      } else if (effect.type === "gameover") {
        this.audio.play("gameover");
      } else if (effect.type === "drop") {
        this.audio.play("drop");
      }
    }
    this.persistSettings();
  }

  advanceTime(deltaMs) {
    this.tickInputs(deltaMs);
    this.engine.update(deltaMs);
    this.processEffects();
    this.updateUiState();
    this.render();
  }

  tickInputs(deltaMs) {
    if (this.engine.mode !== "playing") {
      return;
    }

    const leftPressed = this.horizontalState.left.pressed;
    const rightPressed = this.horizontalState.right.pressed;

    if (leftPressed && !rightPressed) {
      this.updateRepeat(this.horizontalState.left, deltaMs, () => {
        if (this.engine.moveHorizontal(-1)) {
          this.audio.play("click");
        }
      });
    } else {
      this.horizontalState.left.elapsed = 0;
      this.horizontalState.left.repeatElapsed = 0;
    }

    if (rightPressed && !leftPressed) {
      this.updateRepeat(this.horizontalState.right, deltaMs, () => {
        if (this.engine.moveHorizontal(1)) {
          this.audio.play("click");
        }
      });
    } else {
      this.horizontalState.right.elapsed = 0;
      this.horizontalState.right.repeatElapsed = 0;
    }

    if (this.softDropState.pressed) {
      this.softDropState.elapsed += deltaMs;
      this.softDropState.repeatElapsed += deltaMs;
      while (this.softDropState.repeatElapsed >= SOFT_DROP_INTERVAL) {
        this.softDropState.repeatElapsed -= SOFT_DROP_INTERVAL;
        this.engine.softDropStep();
      }
    } else {
      this.softDropState.elapsed = 0;
      this.softDropState.repeatElapsed = 0;
    }
  }

  updateRepeat(state, deltaMs, callback) {
    state.elapsed += deltaMs;
    if (state.elapsed < MOVE_REPEAT_DELAY) {
      return;
    }

    state.repeatElapsed += deltaMs;
    while (state.repeatElapsed >= MOVE_REPEAT_INTERVAL) {
      state.repeatElapsed -= MOVE_REPEAT_INTERVAL;
      callback();
    }
  }

  renderFrame(timestamp) {
    if (!this.lastTimestamp) {
      this.lastTimestamp = timestamp;
    }
    const deltaMs = clamp(timestamp - this.lastTimestamp, 0, 50);
    this.lastTimestamp = timestamp;
    this.advanceTime(deltaMs);
    requestAnimationFrame(this.renderFrame);
  }

  updateUiState() {
    this.muteToggle.checked = this.settings.muted;
    this.menuOverlay.classList.toggle("overlay--hidden", this.engine.mode !== "menu");
    this.pauseOverlay.classList.toggle("overlay--hidden", this.engine.mode !== "paused");
    this.gameOverOverlay.classList.toggle("overlay--hidden", this.engine.mode !== "gameover");
    this.pauseButton.hidden = this.engine.mode !== "playing";
    this.gameOverCopy.textContent = `本局得分 ${formatScore(this.engine.score)}，最高分 ${formatScore(this.engine.bestScore)}。`;
  }

  render() {
    if (!this.viewport) {
      return;
    }

    const { width, height } = this.viewport;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#0b1730");
    gradient.addColorStop(1, "#102033");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    this.drawBackdrop(ctx, width, height);

    const layout = this.getLayout(width, height);
    this.currentLayout = layout;
    this.drawPanels(ctx, layout);
    this.drawBoard(ctx, layout);
    this.drawSidePanels(ctx, layout);
    this.drawFooter(ctx, layout);
  }

  getLayout(width, height) {
    const portrait = width < height * 0.85;
    if (portrait) {
      const topBand = Math.max(156, height * 0.22);
      const headerY = 56;
      const panelHeight = topBand - headerY - 12;
      const cellSize = Math.min((width - 44) / BOARD_COLS, (height - topBand - 28) / VISIBLE_ROWS);
      const boardWidth = cellSize * BOARD_COLS;
      const boardHeight = cellSize * VISIBLE_ROWS;
      return {
        portrait,
        boardX: (width - boardWidth) / 2,
        boardY: topBand,
        boardWidth,
        boardHeight,
        cellSize,
        holdPanel: { x: 16, y: headerY, w: 92, h: panelHeight },
        nextPanel: { x: width - 108, y: headerY, w: 92, h: panelHeight },
        statsPanel: { x: width / 2 - 88, y: headerY + 4, w: 176, h: panelHeight - 8 },
        footerY: height - 18,
      };
    }

    const sidePanelWidth = Math.min(216, width * 0.22);
    const cellSize = Math.min((width - sidePanelWidth * 2 - 88) / BOARD_COLS, (height - 50) / VISIBLE_ROWS);
    const boardWidth = cellSize * BOARD_COLS;
    const boardHeight = cellSize * VISIBLE_ROWS;
    const boardX = (width - boardWidth) / 2;
    const boardY = (height - boardHeight) / 2;
    return {
      portrait,
      boardX,
      boardY,
      boardWidth,
      boardHeight,
      cellSize,
      holdPanel: { x: boardX - sidePanelWidth - 22, y: boardY + 6, w: sidePanelWidth, h: 190 },
      nextPanel: { x: boardX + boardWidth + 22, y: boardY + 6, w: sidePanelWidth, h: 262 },
      statsPanel: { x: boardX + boardWidth + 22, y: boardY + 282, w: sidePanelWidth, h: 200 },
      footerY: height - 20,
    };
  }

  drawBackdrop(ctx, width, height) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    for (let index = 0; index < 18; index += 1) {
      const size = 28 + (index % 4) * 14;
      const x = (index * 97) % width;
      const y = (index * 151) % height;
      ctx.fillStyle = index % 2 === 0 ? "#163453" : "#18425f";
      fillRoundedRect(ctx, x, y, size, size, 8);
    }
    ctx.restore();
  }

  drawPanels(ctx, layout) {
    ctx.save();
    ctx.fillStyle = "rgba(4, 9, 17, 0.34)";
    fillRoundedRect(
      ctx,
      layout.boardX - 12,
      layout.boardY - 12,
      layout.boardWidth + 24,
      layout.boardHeight + 24,
      28
    );
    ctx.restore();
  }

  drawBoard(ctx, layout) {
    ctx.save();
    ctx.fillStyle = COLORS.board;
    fillRoundedRect(ctx, layout.boardX, layout.boardY, layout.boardWidth, layout.boardHeight, 24);

    for (let row = 0; row < VISIBLE_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        const x = layout.boardX + col * layout.cellSize;
        const y = layout.boardY + row * layout.cellSize;
        ctx.fillStyle = COLORS.boardGrid;
        fillRoundedRect(
          ctx,
          x + 1.4,
          y + 1.4,
          layout.cellSize - 2.8,
          layout.cellSize - 2.8,
          Math.max(5, layout.cellSize * 0.16)
        );
      }
    }

    for (const cell of this.engine.getActiveCells({ ghost: true })) {
      const row = cell.y - BUFFER_ROWS;
      if (row < 0 || row >= VISIBLE_ROWS) {
        continue;
      }
      const x = layout.boardX + cell.x * layout.cellSize;
      const y = layout.boardY + row * layout.cellSize;
      ctx.strokeStyle = COLORS.ghost;
      ctx.lineWidth = Math.max(2, layout.cellSize * 0.08);
      strokeRoundedRect(
        ctx,
        x + 4,
        y + 4,
        layout.cellSize - 8,
        layout.cellSize - 8,
        Math.max(5, layout.cellSize * 0.16)
      );
    }

    for (let row = BUFFER_ROWS; row < this.engine.board.length; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        const type = this.engine.board[row][col];
        if (type) {
          this.drawCell(ctx, layout.boardX, layout.boardY, layout.cellSize, col, row - BUFFER_ROWS, type);
        }
      }
    }

    for (const cell of this.engine.getActiveCells()) {
      const row = cell.y - BUFFER_ROWS;
      if (row >= 0 && row < VISIBLE_ROWS) {
        this.drawCell(ctx, layout.boardX, layout.boardY, layout.cellSize, cell.x, row, cell.type);
      }
    }

    if (this.engine.mode === "paused") {
      ctx.fillStyle = "rgba(4, 8, 15, 0.48)";
      fillRoundedRect(ctx, layout.boardX, layout.boardY, layout.boardWidth, layout.boardHeight, 24);
    }

    ctx.restore();
  }

  drawCell(ctx, boardX, boardY, cellSize, col, row, type) {
    const x = boardX + col * cellSize;
    const y = boardY + row * cellSize;
    const color = PIECES[type].color;

    ctx.save();
    ctx.fillStyle = color;
    fillRoundedRect(ctx, x + 2, y + 2, cellSize - 4, cellSize - 4, Math.max(5, cellSize * 0.2));
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    fillRoundedRect(
      ctx,
      x + 5,
      y + 4,
      cellSize - 12,
      Math.max(6, cellSize * 0.18),
      Math.max(4, cellSize * 0.12)
    );
    ctx.strokeStyle = "rgba(0, 0, 0, 0.22)";
    ctx.lineWidth = 1.5;
    strokeRoundedRect(ctx, x + 2, y + 2, cellSize - 4, cellSize - 4, Math.max(5, cellSize * 0.2));
    ctx.restore();
  }

  drawSidePanels(ctx, layout) {
    this.drawInfoPanel(ctx, layout.holdPanel, "Hold");
    this.drawInfoPanel(ctx, layout.nextPanel, "Next");
    this.drawInfoPanel(ctx, layout.statsPanel, "Stats");

    if (this.engine.holdPieceType) {
      this.drawPreviewPiece(ctx, this.engine.holdPieceType, layout.holdPanel);
    } else {
      this.drawEmptyPreviewCopy(ctx, layout.holdPanel, "暂存为空");
    }

    this.drawNextQueue(ctx, layout.nextPanel);
    this.drawStats(ctx, layout.statsPanel);
  }

  drawInfoPanel(ctx, rect, title) {
    ctx.save();
    ctx.fillStyle = COLORS.panel;
    fillRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 20);
    ctx.strokeStyle = COLORS.panelBorder;
    ctx.lineWidth = 1.5;
    strokeRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 20);
    ctx.fillStyle = COLORS.textMuted;
    ctx.font = "600 14px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText(title.toUpperCase(), rect.x + 18, rect.y + 28);
    ctx.restore();
  }

  drawPreviewPiece(ctx, pieceType, rect, offsetY = 0) {
    const cells = getPieceCells(pieceType, 0);
    const cellSize = Math.min(22, rect.w / 5);
    const minX = Math.min(...cells.map(([x]) => x));
    const maxX = Math.max(...cells.map(([x]) => x));
    const minY = Math.min(...cells.map(([, y]) => y));
    const maxY = Math.max(...cells.map(([, y]) => y));
    const width = (maxX - minX + 1) * cellSize;
    const height = (maxY - minY + 1) * cellSize;
    const startX = rect.x + (rect.w - width) / 2 - minX * cellSize;
    const startY = rect.y + rect.h / 2 - height / 2 - minY * cellSize + offsetY;

    for (const [cellX, cellY] of cells) {
      this.drawCell(ctx, startX, startY, cellSize, cellX, cellY, pieceType);
    }
  }

  drawEmptyPreviewCopy(ctx, rect, copy) {
    ctx.save();
    ctx.fillStyle = COLORS.textMuted;
    ctx.font = "500 14px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(copy, rect.x + rect.w / 2, rect.y + rect.h / 2 + 10);
    ctx.restore();
  }

  drawNextQueue(ctx, rect) {
    const nextItems = this.engine.queue.slice(0, 3);
    nextItems.forEach((pieceType, index) => {
      const previewRect = {
        x: rect.x + 12,
        y: rect.y + 38 + index * 72,
        w: rect.w - 24,
        h: 64,
      };
      this.drawPreviewPiece(ctx, pieceType, previewRect, -14);
    });
  }

  drawStats(ctx, rect) {
    const lines = [
      [
        "模式",
        this.engine.mode === "menu"
          ? "待开始"
          : this.engine.mode === "paused"
            ? "暂停中"
            : this.engine.mode === "gameover"
              ? "结束"
              : "进行中",
      ],
      ["最高分", formatScore(this.engine.bestScore)],
      ["等级", String(this.engine.level)],
      ["消行", String(this.engine.lines)],
      ["暂存", this.engine.holdPieceType ?? "-"],
    ];

    ctx.save();
    ctx.fillStyle = COLORS.textPrimary;
    ctx.font = "600 13px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillStyle = COLORS.textMuted;
    ctx.fillText("当前分数", rect.x + 16, rect.y + 54);
    ctx.fillStyle = COLORS.textPrimary;
    ctx.font = "700 22px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText(formatScore(this.engine.score), rect.x + 16, rect.y + 82);

    ctx.font = "500 14px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillStyle = COLORS.textMuted;
    lines.forEach(([label, value], index) => {
      const y = rect.y + 116 + index * 24;
      ctx.fillText(label, rect.x + 16, y);
      ctx.fillStyle = COLORS.textPrimary;
      ctx.textAlign = "right";
      ctx.fillText(value, rect.x + rect.w - 16, y);
      ctx.textAlign = "left";
      ctx.fillStyle = COLORS.textMuted;
    });
    ctx.restore();
  }

  drawFooter(ctx, layout) {
    const footerText =
      this.engine.mode === "menu"
        ? "Android 支持添加到主屏幕"
        : layout.portrait
          ? "滑动移动 单击旋转 双击 Hold"
          : "P 暂停  R 重开  F 全屏";
    ctx.save();
    ctx.fillStyle = "rgba(243, 246, 251, 0.72)";
    ctx.font = "500 13px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(footerText, this.viewport.width / 2, layout.footerY);
    ctx.restore();
  }
}
