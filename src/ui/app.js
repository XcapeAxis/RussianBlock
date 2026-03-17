import {
  BOARD_COLS,
  BUFFER_ROWS,
  MOVE_REPEAT_DELAY,
  MOVE_REPEAT_INTERVAL,
  SOFT_DROP_INTERVAL,
  VISIBLE_ROWS,
} from "../game/constants.js";
import { AudioManager } from "../game/audio.js";
import { TetrisEngine } from "../game/engine.js";
import { getPieceCells } from "../game/pieces.js";
import { loadSettings, saveSettings } from "../game/storage.js";
import { getTheme, THEMES } from "../game/themes.js";

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

function clipRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.clip();
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

function buildThemeCardsMarkup() {
  return THEMES.map(
    (theme) => `
      <button type="button" class="theme-card" data-theme-card="${theme.id}" aria-pressed="false">
        <div class="theme-card-swatch" style="background: linear-gradient(135deg, ${theme.preview.stops});"></div>
        <span class="theme-card-badge">${theme.preview.badge}</span>
        <strong>${theme.name}</strong>
        <span>${theme.description}</span>
      </button>
    `
  ).join("");
}

function buildThemeChipsMarkup() {
  return THEMES.map(
    (theme) => `
      <button type="button" class="theme-chip" data-theme-option="${theme.id}" aria-pressed="false">
        <span class="theme-chip-dot" style="background: linear-gradient(135deg, ${theme.preview.stops});"></span>
        <span class="theme-chip-copy">
          <strong>${theme.name}</strong>
          <span>${theme.preview.badge}</span>
        </span>
      </button>
    `
  ).join("");
}

function applyCssVariables(styleTarget, theme) {
  const entries = {
    "--bg-0": theme.ui.bg0,
    "--bg-1": theme.ui.bg1,
    "--panel": theme.ui.panel,
    "--panel-border": theme.ui.panelBorder,
    "--text": theme.ui.text,
    "--muted": theme.ui.muted,
    "--accent": theme.ui.accent,
    "--accent-soft": theme.ui.accentSoft,
    "--chip": theme.ui.chip,
    "--button-from": theme.ui.buttonFrom,
    "--button-to": theme.ui.buttonTo,
    "--button-alt": theme.ui.buttonAlt,
    "--shadow": theme.ui.shadow,
    "--stage-from": theme.ui.stageFrom,
    "--stage-to": theme.ui.stageTo,
    "--stage-glow": theme.ui.stageGlow,
    "--stage-border": theme.ui.stageBorder,
    "--overlay-scrim": theme.ui.overlayScrim,
  };

  styleTarget.setProperty("color-scheme", theme.ui.colorScheme);
  Object.entries(entries).forEach(([name, value]) => {
    styleTarget.setProperty(name, value);
  });
}

const SINGLE_TAP_DELAY_MS = 180;
const DOUBLE_TAP_WINDOW_MS = 220;
const DOUBLE_TAP_DISTANCE_PX = 24;
const TAP_SLOP_PX = 18;
const HORIZONTAL_GESTURE_RATIO = 0.6;
const SOFT_DROP_GESTURE_RATIO = 0.75;
const HARD_DROP_GESTURE_RATIO = 5.4;
const HARD_DROP_MIN_VELOCITY = 2.25;
const HARD_DROP_VERTICAL_DOMINANCE = 2.2;
const HARD_DROP_MAX_DURATION_MS = 240;
const HARD_DROP_MAX_LATERAL_DRIFT_RATIO = 0.45;

function distanceBetweenPoints(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class RussianBlockApp {
  constructor(root) {
    this.root = root;
    this.settings = loadSettings();
    this.theme = getTheme(this.settings.themeId);
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
    this.applyTheme();
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
              <div class="theme-showcase">
                <span class="theme-showcase-label">当前皮肤</span>
                <strong id="theme-name"></strong>
                <p id="theme-description"></p>
              </div>
              <div class="theme-carousel" id="theme-carousel">
                ${buildThemeCardsMarkup()}
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
            <div class="settings-block">
              <span class="settings-label">主题</span>
              <div class="settings-theme-grid">
                ${buildThemeChipsMarkup()}
              </div>
            </div>
            <div class="settings-block">
              <label class="toggle-row">
                <span>静音</span>
                <input type="checkbox" id="mute-toggle" />
              </label>
            </div>
            <button type="button" class="secondary-btn settings-install settings-install--hidden" id="install-btn">安装到主屏幕</button>
            <p class="settings-note">首次联网打开后会缓存资源，后续可以离线继续玩。主题会和最高分、静音设置一起保存在本机。</p>
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
    this.menuThemeName = this.root.querySelector("#theme-name");
    this.menuThemeDescription = this.root.querySelector("#theme-description");
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

    this.root.querySelectorAll("[data-theme-card]").forEach((button) => {
      button.addEventListener("click", () => this.setTheme(button.dataset.themeCard, { playFeedback: true }));
    });
    this.root.querySelectorAll("[data-theme-option]").forEach((button) => {
      button.addEventListener("click", () => this.setTheme(button.dataset.themeOption, { playFeedback: true }));
    });

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

  setTheme(themeId, { playFeedback = false } = {}) {
    const nextTheme = getTheme(themeId);
    const changed = nextTheme.id !== this.theme.id;
    this.theme = nextTheme;
    this.settings.themeId = nextTheme.id;
    this.applyTheme();
    this.persistSettings();
    if (playFeedback && changed) {
      this.audio.play("click");
    }
    this.render();
  }

  applyTheme() {
    applyCssVariables(document.documentElement.style, this.theme);
    this.stage.dataset.themeId = this.theme.id;
    this.menuThemeName.textContent = `${this.theme.name}主题`;
    this.menuThemeDescription.textContent = this.theme.description;

    this.root.querySelectorAll("[data-theme-card]").forEach((button) => {
      const active = button.dataset.themeCard === this.theme.id;
      button.setAttribute("aria-pressed", String(active));
    });
    this.root.querySelectorAll("[data-theme-option]").forEach((button) => {
      const active = button.dataset.themeOption === this.theme.id;
      button.setAttribute("aria-pressed", String(active));
    });
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
      startTime: now,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastMoveTime: now,
      lastVelocityY: 0,
      maxAbsDeltaX: 0,
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
    gesture.maxAbsDeltaX = Math.max(gesture.maxAbsDeltaX, Math.abs(totalX));

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
    gesture.lastVelocityY = stepY / deltaTime;
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
    const gestureDuration = now - gesture.startTime;
    const shouldHardDrop =
      event.type === "pointerup" &&
      !gesture.hardDropped &&
      totalY >= gesture.cellSize * HARD_DROP_GESTURE_RATIO &&
      totalY > Math.abs(totalX) * HARD_DROP_VERTICAL_DOMINANCE &&
      gesture.lastVelocityY >= HARD_DROP_MIN_VELOCITY &&
      gestureDuration <= HARD_DROP_MAX_DURATION_MS &&
      gesture.maxAbsDeltaX <= gesture.cellSize * HARD_DROP_MAX_LATERAL_DRIFT_RATIO;

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
    this.toggleSettings(false);
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
    this.toggleSettings(false);
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
    this.toggleSettings(false);
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
    this.settings.themeId = this.theme.id;
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
    gradient.addColorStop(0, this.theme.canvas.backgroundStart);
    gradient.addColorStop(1, this.theme.canvas.backgroundEnd);
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
    const { scene, primary, secondary } = this.theme.backdrop;

    ctx.save();
    if (scene === "classic") {
      ctx.globalAlpha = 0.22;
      for (let index = 0; index < 18; index += 1) {
        const size = 28 + (index % 4) * 14;
        const x = (index * 97) % width;
        const y = (index * 151) % height;
        ctx.fillStyle = primary[index % primary.length];
        fillRoundedRect(ctx, x, y, size, size, 8);
      }
    } else if (scene === "ocean") {
      primary.forEach((color, index) => {
        const bubbleX = ((index + 1) * width) / (primary.length + 1);
        const bubbleY = height * (0.18 + index * 0.2);
        const radius = 70 + index * 22;
        const bubble = ctx.createRadialGradient(bubbleX, bubbleY, 6, bubbleX, bubbleY, radius);
        bubble.addColorStop(0, color);
        bubble.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = bubble;
        ctx.beginPath();
        ctx.arc(bubbleX, bubbleY, radius, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.lineWidth = 3;
      secondary.forEach((color, index) => {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(-40, height * (0.24 + index * 0.16));
        ctx.bezierCurveTo(width * 0.2, height * (0.1 + index * 0.18), width * 0.62, height * (0.34 + index * 0.16), width + 40, height * (0.18 + index * 0.18));
        ctx.stroke();
      });
    } else if (scene === "gem") {
      primary.forEach((color, index) => {
        const centerX = width * (0.18 + index * 0.22);
        const centerY = height * (0.2 + (index % 2) * 0.28);
        const size = 58 + index * 12;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY - size);
        ctx.lineTo(centerX + size * 0.72, centerY - size * 0.18);
        ctx.lineTo(centerX + size * 0.44, centerY + size * 0.7);
        ctx.lineTo(centerX - size * 0.42, centerY + size * 0.72);
        ctx.lineTo(centerX - size * 0.78, centerY - size * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = secondary[index % secondary.length];
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    } else if (scene === "starlight") {
      primary.forEach((color, index) => {
        const starX = ((index + 1) * width) / (primary.length + 1);
        const starY = height * (0.16 + (index % 2) * 0.26);
        const glow = ctx.createRadialGradient(starX, starY, 0, starX, starY, 90);
        glow.addColorStop(0, color);
        glow.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(starX, starY, 90, 0, Math.PI * 2);
        ctx.fill();
      });

      for (let index = 0; index < 28; index += 1) {
        const x = ((index * 71) % width) + 12;
        const y = ((index * 97) % height) + 10;
        const size = index % 5 === 0 ? 4 : 2;
        ctx.strokeStyle = secondary[index % secondary.length];
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - size, y);
        ctx.lineTo(x + size, y);
        ctx.moveTo(x, y - size);
        ctx.lineTo(x, y + size);
        ctx.stroke();
      }
    } else if (scene === "aurora") {
      primary.forEach((color, index) => {
        const ribbon = ctx.createLinearGradient(width * 0.1, 0, width * 0.9, height);
        ribbon.addColorStop(0, "rgba(255,255,255,0)");
        ribbon.addColorStop(0.3, color);
        ribbon.addColorStop(0.7, secondary[index % secondary.length]);
        ribbon.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = ribbon;
        ctx.lineWidth = 28 - index * 4;
        ctx.beginPath();
        ctx.moveTo(width * (0.18 + index * 0.15), -20);
        ctx.bezierCurveTo(width * (0.02 + index * 0.15), height * 0.34, width * (0.28 + index * 0.12), height * 0.62, width * (0.12 + index * 0.18), height + 20);
        ctx.stroke();
      });
    } else if (scene === "lava") {
      primary.forEach((color, index) => {
        const emberX = width * (0.14 + index * 0.22);
        const emberY = height * (0.22 + (index % 2) * 0.26);
        const radius = 54 + index * 20;
        const ember = ctx.createRadialGradient(emberX, emberY, 0, emberX, emberY, radius);
        ember.addColorStop(0, color);
        ember.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = ember;
        ctx.beginPath();
        ctx.arc(emberX, emberY, radius, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.strokeStyle = secondary[1];
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(width * 0.08, height * 0.7);
      ctx.lineTo(width * 0.24, height * 0.58);
      ctx.lineTo(width * 0.34, height * 0.66);
      ctx.lineTo(width * 0.48, height * 0.52);
      ctx.lineTo(width * 0.62, height * 0.62);
      ctx.lineTo(width * 0.8, height * 0.48);
      ctx.lineTo(width * 0.92, height * 0.56);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPanels(ctx, layout) {
    ctx.save();
    ctx.shadowBlur = 28;
    ctx.shadowColor = this.theme.canvas.shellGlow;
    ctx.fillStyle = this.theme.canvas.shell;
    fillRoundedRect(
      ctx,
      layout.boardX - 12,
      layout.boardY - 12,
      layout.boardWidth + 24,
      layout.boardHeight + 24,
      28
    );
    ctx.shadowBlur = 0;
    ctx.strokeStyle = this.theme.canvas.shellBorder;
    ctx.lineWidth = 1.5;
    strokeRoundedRect(
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
    ctx.fillStyle = this.theme.canvas.board;
    fillRoundedRect(ctx, layout.boardX, layout.boardY, layout.boardWidth, layout.boardHeight, 24);
    ctx.strokeStyle = this.theme.canvas.boardBorder;
    ctx.lineWidth = 1.25;
    strokeRoundedRect(ctx, layout.boardX, layout.boardY, layout.boardWidth, layout.boardHeight, 24);

    const boardHighlight = ctx.createLinearGradient(layout.boardX, layout.boardY, layout.boardX, layout.boardY + layout.boardHeight);
    boardHighlight.addColorStop(0, this.theme.canvas.shellGlow);
    boardHighlight.addColorStop(0.22, "rgba(255,255,255,0)");
    ctx.fillStyle = boardHighlight;
    fillRoundedRect(ctx, layout.boardX, layout.boardY, layout.boardWidth, layout.boardHeight, 24);

    for (let row = 0; row < VISIBLE_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        const x = layout.boardX + col * layout.cellSize;
        const y = layout.boardY + row * layout.cellSize;
        ctx.fillStyle = this.theme.canvas.boardGrid;
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
      ctx.strokeStyle = this.theme.canvas.ghost;
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
      ctx.fillStyle = this.theme.canvas.pauseCurtain;
      fillRoundedRect(ctx, layout.boardX, layout.boardY, layout.boardWidth, layout.boardHeight, 24);
    }

    ctx.restore();
  }

  drawCell(ctx, boardX, boardY, cellSize, col, row, type) {
    const x = boardX + col * cellSize;
    const y = boardY + row * cellSize;
    const style = this.theme.pieces[type];
    const pad = Math.max(2, cellSize * 0.08);
    const innerX = x + pad;
    const innerY = y + pad;
    const innerSize = cellSize - pad * 2;
    const radius = Math.max(5, cellSize * 0.2);
    const seed = type.charCodeAt(0) + col * 7 + row * 13;

    ctx.save();
    clipRoundedRect(ctx, innerX, innerY, innerSize, innerSize, radius);

    const bodyGradient = ctx.createLinearGradient(innerX, innerY, innerX + innerSize, innerY + innerSize);
    bodyGradient.addColorStop(0, style.highlight);
    bodyGradient.addColorStop(0.45, style.fill);
    bodyGradient.addColorStop(1, style.shade);
    ctx.fillStyle = bodyGradient;
    fillRoundedRect(ctx, innerX, innerY, innerSize, innerSize, radius);

    const glowGradient = ctx.createRadialGradient(
      innerX + innerSize * 0.34,
      innerY + innerSize * 0.26,
      innerSize * 0.04,
      innerX + innerSize * 0.5,
      innerY + innerSize * 0.52,
      innerSize * 0.82
    );
    glowGradient.addColorStop(0, style.specular);
    glowGradient.addColorStop(0.38, style.glow);
    glowGradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = glowGradient;
    fillRoundedRect(ctx, innerX, innerY, innerSize, innerSize, radius);
    ctx.globalCompositeOperation = "source-over";

    if (style.material === "classic") {
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      fillRoundedRect(ctx, innerX + innerSize * 0.16, innerY + innerSize * 0.12, innerSize * 0.66, Math.max(6, innerSize * 0.16), Math.max(4, innerSize * 0.12));
      ctx.strokeStyle = style.specular;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = Math.max(1.2, innerSize * 0.05);
      ctx.beginPath();
      ctx.moveTo(innerX + innerSize * 0.2, innerY + innerSize * 0.72);
      ctx.lineTo(innerX + innerSize * 0.78, innerY + innerSize * 0.24);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (style.material === "ocean") {
      const wash = ctx.createLinearGradient(innerX, innerY, innerX, innerY + innerSize);
      wash.addColorStop(0, "rgba(255,255,255,0.22)");
      wash.addColorStop(0.45, "rgba(255,255,255,0.04)");
      wash.addColorStop(1, "rgba(0,0,0,0.1)");
      ctx.fillStyle = wash;
      fillRoundedRect(ctx, innerX, innerY, innerSize, innerSize, radius);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      for (let index = 0; index < 3; index += 1) {
        const bubbleX = innerX + innerSize * (0.28 + ((seed + index) % 4) * 0.12);
        const bubbleY = innerY + innerSize * (0.24 + index * 0.18);
        const bubbleSize = Math.max(2.4, innerSize * (0.06 + index * 0.01));
        ctx.beginPath();
        ctx.arc(bubbleX, bubbleY, bubbleSize, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (style.material === "gem") {
      ctx.strokeStyle = style.specular;
      ctx.globalAlpha = 0.46;
      ctx.lineWidth = Math.max(1.2, innerSize * 0.045);
      ctx.beginPath();
      ctx.moveTo(innerX + innerSize * 0.12, innerY + innerSize * 0.22);
      ctx.lineTo(innerX + innerSize * 0.48, innerY + innerSize * 0.08);
      ctx.lineTo(innerX + innerSize * 0.88, innerY + innerSize * 0.22);
      ctx.moveTo(innerX + innerSize * 0.12, innerY + innerSize * 0.22);
      ctx.lineTo(innerX + innerSize * 0.34, innerY + innerSize * 0.88);
      ctx.lineTo(innerX + innerSize * 0.62, innerY + innerSize * 0.12);
      ctx.lineTo(innerX + innerSize * 0.88, innerY + innerSize * 0.22);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (style.material === "starlight") {
      ctx.fillStyle = "rgba(4, 8, 22, 0.22)";
      fillRoundedRect(ctx, innerX, innerY + innerSize * 0.52, innerSize, innerSize * 0.48, radius);
      ctx.fillStyle = style.specular;
      for (let index = 0; index < 3; index += 1) {
        const starX = innerX + innerSize * (0.22 + ((seed + index) % 5) * 0.14);
        const starY = innerY + innerSize * (0.22 + index * 0.18);
        const starSize = Math.max(1.4, innerSize * 0.04);
        ctx.fillRect(starX - starSize, starY, starSize * 2, 1.2);
        ctx.fillRect(starX, starY - starSize, 1.2, starSize * 2);
      }
    } else if (style.material === "aurora") {
      ctx.globalAlpha = 0.52;
      for (let index = 0; index < 3; index += 1) {
        ctx.strokeStyle = index % 2 === 0 ? style.specular : style.glow;
        ctx.lineWidth = Math.max(1.4, innerSize * 0.06);
        ctx.beginPath();
        ctx.moveTo(innerX + innerSize * (0.18 + index * 0.18), innerY - innerSize * 0.02);
        ctx.bezierCurveTo(
          innerX + innerSize * (0.02 + index * 0.16),
          innerY + innerSize * 0.36,
          innerX + innerSize * (0.34 + index * 0.12),
          innerY + innerSize * 0.64,
          innerX + innerSize * (0.16 + index * 0.2),
          innerY + innerSize * 1.02
        );
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (style.material === "lava") {
      ctx.fillStyle = "rgba(255, 210, 87, 0.08)";
      fillRoundedRect(ctx, innerX, innerY + innerSize * 0.6, innerSize, innerSize * 0.4, radius);
      ctx.shadowBlur = 10;
      ctx.shadowColor = style.glow;
      ctx.strokeStyle = style.specular;
      ctx.lineWidth = Math.max(1.3, innerSize * 0.05);
      ctx.beginPath();
      ctx.moveTo(innerX + innerSize * 0.18, innerY + innerSize * 0.24);
      ctx.lineTo(innerX + innerSize * 0.46, innerY + innerSize * 0.44);
      ctx.lineTo(innerX + innerSize * 0.36, innerY + innerSize * 0.68);
      ctx.lineTo(innerX + innerSize * 0.72, innerY + innerSize * 0.82);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
    ctx.save();
    ctx.strokeStyle = style.edge;
    ctx.lineWidth = Math.max(1.2, cellSize * 0.05);
    strokeRoundedRect(ctx, innerX, innerY, innerSize, innerSize, radius);
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
    ctx.shadowBlur = 16;
    ctx.shadowColor = this.theme.canvas.panelGlow;
    ctx.fillStyle = this.theme.canvas.panel;
    fillRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 20);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = this.theme.canvas.panelBorder;
    ctx.lineWidth = 1.5;
    strokeRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 20);
    ctx.fillStyle = this.theme.canvas.accentSoft;
    ctx.font = "600 14px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText(title.toUpperCase(), rect.x + 18, rect.y + 28);
    ctx.fillStyle = this.theme.canvas.statsAccent;
    fillRoundedRect(ctx, rect.x + 18, rect.y + 36, 42, 3, 2);
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
    ctx.fillStyle = this.theme.canvas.emptyText;
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
      ["主题", this.theme.name],
    ];

    ctx.save();
    ctx.fillStyle = this.theme.canvas.textMuted;
    ctx.font = "600 13px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText("当前分数", rect.x + 16, rect.y + 54);
    ctx.fillStyle = this.theme.canvas.textPrimary;
    ctx.font = "700 22px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText(formatScore(this.engine.score), rect.x + 16, rect.y + 82);

    ctx.font = "500 14px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillStyle = this.theme.canvas.textMuted;
    lines.forEach(([label, value], index) => {
      const y = rect.y + 116 + index * 22;
      ctx.fillText(label, rect.x + 16, y);
      ctx.fillStyle = this.theme.canvas.textPrimary;
      ctx.textAlign = "right";
      ctx.fillText(value, rect.x + rect.w - 16, y);
      ctx.textAlign = "left";
      ctx.fillStyle = this.theme.canvas.textMuted;
    });
    ctx.restore();
  }

  drawFooter(ctx, layout) {
    const footerText =
      this.engine.mode === "menu"
        ? `${this.theme.name}主题已就绪，可添加到主屏幕`
        : layout.portrait
          ? "滑动移动 单击旋转 双击 Hold"
          : "P 暂停  R 重开  F 全屏";
    ctx.save();
    ctx.fillStyle = this.theme.canvas.footer;
    ctx.font = "500 13px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(footerText, this.viewport.width / 2, layout.footerY);
    ctx.restore();
  }
}
