import {
  BOARD_COLS,
  BUFFER_ROWS,
  MOVE_REPEAT_DELAY,
  MOVE_REPEAT_INTERVAL,
  SOFT_DROP_INTERVAL,
  VISIBLE_ROWS,
} from "../game/constants.js";
import { RussianBlockApiClient } from "../api/client.js";
import { AudioManager } from "../game/audio.js";
import { TetrisEngine } from "../game/engine.js";
import { GAME_MODES, PLAYABLE_PHASE_ONE_MODES, buildGameConfig, getModeDefinition, sanitizeGameMode } from "../game/modes.js";
import { getPieceCells } from "../game/pieces.js";
import {
  getBestScoreForMode,
  getReplayForRun,
  loadProfile,
  recordRun,
  saveProfile,
} from "../game/progress-storage.js";
import { ReplayPlayer, ReplayRecorder, buildReplayClip, createRunId } from "../game/replay.js";
import { loadSettings, saveSettings } from "../game/storage.js";
import { getTheme, THEMES } from "../game/themes.js";

function formatScore(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTimer(durationMs) {
  if (durationMs === null || durationMs === undefined) {
    return "--:--";
  }
  return formatDuration(durationMs);
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"]/g, (token) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    }[token];
  });
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

function buildModeCardsMarkup() {
  return PLAYABLE_PHASE_ONE_MODES.map((modeId) => {
    const mode = GAME_MODES[modeId];
    return `
      <button type="button" class="theme-card mode-card" data-mode-card="${mode.id}" aria-pressed="false">
        <span class="theme-card-badge">${mode.name}</span>
        <strong>${mode.label}</strong>
        <span>${mode.description}</span>
      </button>
    `;
  }).join("");
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
    this.profile = loadProfile();
    this.theme = getTheme(this.settings.themeId);
    this.query = new URLSearchParams(window.location.search);
    this.audio = new AudioManager({ muted: this.settings.muted });
    this.engine = new TetrisEngine({ bestScore: this.settings.bestScore });
    this.apiClient = new RussianBlockApiClient(this.settings.apiBase);
    this.manualTimeControl = typeof window.advanceTime === "function";
    this.installPrompt = null;
    this.lastTimestamp = 0;
    this.currentLayout = null;
    this.activeGesture = null;
    this.pendingTouchTap = null;
    this.activeRecorder = null;
    this.lastReplay = null;
    this.lastRunSummary = null;
    this.replayPlayer = null;
    this.liveEngine = null;
    this.replayMeta = null;
    this.watchSession = null;
    this.selectedGameMode = sanitizeGameMode(this.settings.lastMode);
    this.selectedSeed = this.settings.lastSeed;
    this.statusMessage = "";
    this.activeRemoteSession = null;
    this.lastRemoteSubmission = null;
    this.remoteLeaderboard = null;
    this.remoteLeaderboardStatus = "idle";
    this.remoteLeaderboardError = "";

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
    this.shareCodeInput.value = this.query.get("code") ?? "";
    const hasSharedRoute =
      (this.query.get("play") === "challenge" && Boolean(this.query.get("code"))) ||
      (this.query.get("watch") === "replay" && Boolean(this.query.get("code"))) ||
      (this.query.get("play") === "puzzle" && Boolean(this.query.get("code")));
    if (hasSharedRoute) {
      this.statusMessage = "正在载入分享内容…";
      void this.bootstrapSharedRoute();
    } else if (this.query.get("autostart") === "1") {
      this.startGame({ gameMode: this.selectedGameMode, seed: this.selectedSeed });
      if (this.query.get("demo") === "1") {
        this.populateDemoBoard();
      }
    } else if (this.query.get("menu") !== "1" && this.settings.autoStartLastMode) {
      this.startGame({ gameMode: this.selectedGameMode, seed: this.selectedSeed });
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
    window.exportReplay = () => this.exportReplay();

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
              <p>经典俄罗斯方块，支持键盘、滑屏手势、离线缓存、模式切换和本地复盘。</p>
              <div class="theme-showcase">
                <span class="theme-showcase-label">模式选择</span>
                <strong id="mode-name"></strong>
                <p id="mode-description"></p>
              </div>
              <div class="theme-carousel" id="mode-carousel">
                ${buildModeCardsMarkup()}
              </div>
              <label class="seed-field" id="seed-field">
                <span class="theme-showcase-label">Challenge Seed</span>
                <input type="text" id="seed-input" placeholder="输入固定种子或留空自动生成" />
              </label>
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
              <div class="menu-summary" id="menu-summary"></div>
              <div class="menu-history">
                <div class="menu-history-head">
                  <span class="theme-showcase-label">最近战绩</span>
                  <button type="button" class="secondary-btn menu-mini-btn" id="replay-last-btn">回放上一局</button>
                </div>
                <div class="history-list" id="history-list"></div>
              </div>
              <div class="menu-history">
                <div class="menu-history-head">
                  <span class="theme-showcase-label">挑战与分享</span>
                </div>
                <label class="seed-field">
                  <span class="theme-showcase-label">挑战码 / 回放码</span>
                  <input type="text" id="share-code-input" placeholder="输入 code 后可直接挑战或观战" />
                </label>
                <div class="overlay-actions">
                  <button type="button" class="secondary-btn menu-mini-btn" id="play-challenge-btn">开始挑战</button>
                  <button type="button" class="secondary-btn menu-mini-btn" id="watch-shared-replay-btn">观看回放</button>
                  <button type="button" class="secondary-btn menu-mini-btn" id="load-daily-btn">今日挑战</button>
                </div>
              </div>
              <p class="overlay-hint" id="status-copy"></p>
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
              <span class="eyebrow" id="result-eyebrow">Game Over</span>
              <h2 id="result-title">堆到顶了</h2>
              <p id="gameover-copy">再来一局，刷新你的最高分。</p>
              <div class="result-grid" id="result-grid"></div>
              <div class="overlay-actions">
                <button type="button" class="primary-btn" id="retry-btn">再来一局</button>
                <button type="button" class="secondary-btn" id="menu-btn">回到首页</button>
                <button type="button" class="secondary-btn" id="replay-full-btn">回放本局</button>
                <button type="button" class="secondary-btn" id="replay-clip-btn">回放最后 8 秒</button>
                <button type="button" class="secondary-btn" id="share-run-btn">导出回放</button>
                <button type="button" class="secondary-btn" id="challenge-run-btn">生成挑战</button>
              </div>
            </div>
          </div>
          <div class="replay-banner replay-banner--hidden" id="replay-banner">
            <div>
              <strong id="replay-title">回放中</strong>
              <p id="replay-copy">正在播放最近一局。</p>
            </div>
            <div class="overlay-actions">
              <button type="button" class="secondary-btn menu-mini-btn" id="replay-restart-btn">重播</button>
              <button type="button" class="secondary-btn menu-mini-btn" id="exit-replay-btn">退出回放</button>
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
            <div class="settings-block">
              <label class="toggle-row">
                <span>自动开局</span>
                <input type="checkbox" id="autostart-toggle" />
              </label>
            </div>
            <div class="settings-block">
              <label class="toggle-row">
                <span>显示 Ghost</span>
                <input type="checkbox" id="ghost-toggle" />
              </label>
            </div>
            <button type="button" class="secondary-btn settings-install settings-install--hidden" id="install-btn">安装到主屏幕</button>
            <label class="seed-field settings-api">
              <span class="theme-showcase-label">API Base</span>
              <input type="text" id="api-base-input" placeholder="https://your-worker.example.workers.dev" />
            </label>
            <p class="settings-note">首次联网打开后会缓存资源，后续可以离线继续玩。主题、模式、Ghost 和 API 地址都会保存在本机。</p>
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
    this.resultEyebrow = this.root.querySelector("#result-eyebrow");
    this.resultTitle = this.root.querySelector("#result-title");
    this.resultGrid = this.root.querySelector("#result-grid");
    this.settingsPanel = this.root.querySelector("#settings-panel");
    this.muteToggle = this.root.querySelector("#mute-toggle");
    this.autostartToggle = this.root.querySelector("#autostart-toggle");
    this.ghostToggle = this.root.querySelector("#ghost-toggle");
    this.apiBaseInput = this.root.querySelector("#api-base-input");
    this.installButton = this.root.querySelector("#install-btn");
    this.pauseButton = this.root.querySelector("#pause-btn");
    this.menuThemeName = this.root.querySelector("#theme-name");
    this.menuThemeDescription = this.root.querySelector("#theme-description");
    this.menuModeName = this.root.querySelector("#mode-name");
    this.menuModeDescription = this.root.querySelector("#mode-description");
    this.seedField = this.root.querySelector("#seed-field");
    this.seedInput = this.root.querySelector("#seed-input");
    this.shareCodeInput = this.root.querySelector("#share-code-input");
    this.menuSummary = this.root.querySelector("#menu-summary");
    this.historyList = this.root.querySelector("#history-list");
    this.statusCopy = this.root.querySelector("#status-copy");
    this.replayBanner = this.root.querySelector("#replay-banner");
    this.replayTitle = this.root.querySelector("#replay-title");
    this.replayCopy = this.root.querySelector("#replay-copy");
    this.shareCardButton = document.createElement("button");
    this.shareCardButton.type = "button";
    this.shareCardButton.className = "secondary-btn";
    this.shareCardButton.id = "share-card-btn";
    this.shareCardButton.textContent = "分享成绩卡";
    this.root.querySelector("#share-run-btn").insertAdjacentElement("afterend", this.shareCardButton);
    this.watchPanel = document.createElement("section");
    this.watchPanel.id = "watch-panel";
    this.watchPanel.className = "watch-panel watch-panel--hidden";
    this.watchPanel.innerHTML = `
      <span class="eyebrow">Replay Watch</span>
      <strong id="watch-panel-title">Shared Replay</strong>
      <p id="watch-panel-copy"></p>
      <div class="watch-panel-grid" id="watch-panel-grid"></div>
      <div class="overlay-actions watch-panel-actions">
        <button type="button" class="primary-btn" id="watch-seed-btn">玩同一题</button>
        <button type="button" class="secondary-btn" id="watch-menu-btn">回到菜单</button>
      </div>
    `;
    this.replayBanner.insertAdjacentElement("afterend", this.watchPanel);
    this.watchPanelTitle = this.watchPanel.querySelector("#watch-panel-title");
    this.watchPanelCopy = this.watchPanel.querySelector("#watch-panel-copy");
    this.watchPanelGrid = this.watchPanel.querySelector("#watch-panel-grid");
    this.watchSeedButton = this.watchPanel.querySelector("#watch-seed-btn");
    this.watchMenuButton = this.watchPanel.querySelector("#watch-menu-btn");
    this.resultLeaderboard = document.createElement("section");
    this.resultLeaderboard.id = "result-leaderboard";
    this.resultLeaderboard.className = "leaderboard-panel leaderboard-panel--hidden";
    this.resultLeaderboard.innerHTML = `
      <div class="leaderboard-panel-head">
        <strong id="leaderboard-title">排行榜</strong>
        <span id="leaderboard-status"></span>
      </div>
      <div class="leaderboard-list" id="leaderboard-list"></div>
    `;
    this.resultGrid.insertAdjacentElement("afterend", this.resultLeaderboard);
    this.leaderboardTitle = this.resultLeaderboard.querySelector("#leaderboard-title");
    this.leaderboardStatus = this.resultLeaderboard.querySelector("#leaderboard-status");
    this.leaderboardList = this.resultLeaderboard.querySelector("#leaderboard-list");
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
    this.root.querySelector("#replay-last-btn").addEventListener("click", () => this.replayMostRecentRun());
    this.root.querySelector("#replay-full-btn").addEventListener("click", () => this.replayLastRun());
    this.root.querySelector("#replay-clip-btn").addEventListener("click", () => this.replayLastClip());
    this.root.querySelector("#share-run-btn").addEventListener("click", () => this.shareLastReplay());
    this.shareCardButton.addEventListener("click", () => void this.shareResultCard());
    this.root.querySelector("#challenge-run-btn").addEventListener("click", () => this.createChallengeFromLastRun());
    this.root.querySelector("#replay-restart-btn").addEventListener("click", () => this.restartReplay());
    this.root.querySelector("#exit-replay-btn").addEventListener("click", () => this.stopReplay());
    this.watchSeedButton.addEventListener("click", () => this.startGameFromWatchedReplay());
    this.watchMenuButton.addEventListener("click", () => {
      this.stopReplay();
      this.returnToMenu();
    });
    this.root.querySelector("#play-challenge-btn").addEventListener("click", () => this.openChallengeFromCode(this.shareCodeInput.value));
    this.root.querySelector("#watch-shared-replay-btn").addEventListener("click", () => this.openReplayFromCode(this.shareCodeInput.value));
    this.root.querySelector("#load-daily-btn").addEventListener("click", () => this.loadDailyChallenge());
    this.root.querySelector("#settings-btn").addEventListener("click", () => this.toggleSettings());
    this.pauseButton.addEventListener("click", () => this.togglePause());
    this.root.querySelector("#close-settings-btn").addEventListener("click", () => this.toggleSettings(false));

    this.root.querySelectorAll("[data-mode-card]").forEach((button) => {
      button.addEventListener("click", () => this.setSelectedMode(button.dataset.modeCard));
    });
    this.root.querySelectorAll("[data-theme-card]").forEach((button) => {
      button.addEventListener("click", () => this.setTheme(button.dataset.themeCard, { playFeedback: true }));
    });
    this.root.querySelectorAll("[data-theme-option]").forEach((button) => {
      button.addEventListener("click", () => this.setTheme(button.dataset.themeOption, { playFeedback: true }));
    });
    this.seedInput.addEventListener("input", () => {
      this.selectedSeed = this.seedInput.value.trim();
      this.settings.lastSeed = this.selectedSeed;
      this.persistSettings();
    });

    this.muteToggle.addEventListener("change", () => {
      this.settings.muted = this.muteToggle.checked;
      this.audio.setMuted(this.settings.muted);
      this.persistSettings();
    });
    this.autostartToggle.addEventListener("change", () => {
      this.settings.autoStartLastMode = this.autostartToggle.checked;
      this.persistSettings();
    });
    this.ghostToggle.addEventListener("change", () => {
      this.settings.ghostEnabled = this.ghostToggle.checked;
      this.persistSettings();
      this.render();
    });
    this.apiBaseInput.addEventListener("change", () => {
      this.settings.apiBase = this.apiBaseInput.value.trim();
      this.apiClient = new RussianBlockApiClient(this.settings.apiBase);
      this.persistSettings();
      this.statusMessage = this.apiClient.configured ? "分享 API 已更新。" : "当前处于纯本地模式。";
      this.updateUiState();
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

  setSelectedMode(modeId) {
    this.selectedGameMode = sanitizeGameMode(modeId);
    this.settings.lastMode = this.selectedGameMode;
    this.persistSettings();
    this.updateModeUi();
  }

  updateModeUi() {
    const mode = getModeDefinition(this.selectedGameMode);
    this.menuModeName.textContent = mode.label;
    this.menuModeDescription.textContent = mode.description;
    this.seedInput.value = this.selectedSeed;
    this.seedField.hidden = !mode.usesSeed;
    this.root.querySelectorAll("[data-mode-card]").forEach((button) => {
      const active = button.dataset.modeCard === this.selectedGameMode;
      button.setAttribute("aria-pressed", String(active));
    });
  }

  createGameConfig(overrides = {}) {
    return buildGameConfig({
      gameMode: overrides.gameMode ?? this.selectedGameMode,
      seed: overrides.seed ?? this.selectedSeed,
    });
  }

  setRemoteSession(context) {
    this.activeRemoteSession = context ? { ...context } : null;
    this.lastRemoteSubmission = null;
    this.remoteLeaderboard = null;
    this.remoteLeaderboardStatus = "idle";
    this.remoteLeaderboardError = "";
  }

  buildRemoteSubmissionPayload(runSummary, replayCode) {
    return {
      replayCode,
      nickname: null,
      score: runSummary.score,
      lines: runSummary.lines,
      durationMs: runSummary.durationMs,
    };
  }

  setWatchSession(session) {
    this.watchSession = session
      ? {
          ...session,
          replay: session.replay,
        }
      : null;
  }

  getBoardKeyFromContext(context) {
    if (!context) {
      return "";
    }
    return context.type === "daily" ? `daily:${context.date}` : context.code;
  }

  async refreshRemoteLeaderboard(context = this.activeRemoteSession) {
    if (!context || !this.apiClient.configured) {
      this.remoteLeaderboard = null;
      this.remoteLeaderboardStatus = "idle";
      this.remoteLeaderboardError = "";
      this.updateUiState();
      return;
    }

    const board = this.getBoardKeyFromContext(context);
    this.remoteLeaderboard = {
      context: { ...context },
      board,
      entries: this.remoteLeaderboard?.board === board ? this.remoteLeaderboard.entries : [],
    };
    this.remoteLeaderboardStatus = "loading";
    this.remoteLeaderboardError = "";
    this.updateUiState();

    try {
      const response = await this.apiClient.getLeaderboard(board);
      this.remoteLeaderboard = {
        context: { ...context },
        board,
        entries: Array.isArray(response.entries) ? response.entries : [],
      };
      this.remoteLeaderboardStatus = "ready";
    } catch (error) {
      this.remoteLeaderboard = {
        context: { ...context },
        board,
        entries: [],
      };
      this.remoteLeaderboardStatus = "error";
      this.remoteLeaderboardError = error instanceof Error ? error.message : "Failed to load leaderboard.";
    }

    this.updateUiState();
  }

  beginRecordingSession() {
    this.activeRecorder = new ReplayRecorder({
      themeId: this.theme.id,
      config: this.engine.sessionConfig,
      initialSnapshot: this.engine.exportSnapshot(),
    });
  }

  recordAction(type, payload) {
    if (!this.activeRecorder || this.replayPlayer || this.engine.mode !== "playing") {
      return;
    }
    this.activeRecorder.recordAction(type, this.engine.elapsedMs, payload);
  }

  captureRecorderMarker(reason = "interval") {
    if (!this.activeRecorder || this.replayPlayer) {
      return;
    }
    this.activeRecorder.captureMarker(this.engine.elapsedMs, this.engine.exportSnapshot(), reason);
  }

  buildRunSummary(replay) {
    const runId = createRunId();
    return {
      id: runId,
      gameMode: this.engine.sessionConfig.gameMode,
      label: getModeDefinition(this.engine.sessionConfig.gameMode).label,
      outcome: this.engine.mode === "completed" ? "completed" : "gameover",
      reason: this.engine.resultReason,
      score: this.engine.score,
      lines: this.engine.lines,
      level: this.engine.level,
      durationMs: this.engine.elapsedMs,
      seed: this.engine.sessionConfig.seed,
      combo: this.engine.bestCombo,
      b2b: this.engine.backToBack,
      themeId: this.theme.id,
      createdAt: new Date().toISOString(),
      replayId: replay.replayId,
    };
  }

  finalizeCurrentRun() {
    if (!this.activeRecorder) {
      return;
    }

    const replay = this.activeRecorder.finalize({
      durationMs: this.engine.elapsedMs,
      result: this.engine.serializeState(),
      finalSnapshot: this.engine.exportSnapshot(),
    });
    this.lastReplay = replay;
    this.lastRunSummary = this.buildRunSummary(replay);
    this.profile = recordRun(this.profile, this.lastRunSummary, replay);
    saveProfile(this.profile);
    this.activeRecorder = null;
    void this.submitRunIfNeeded(this.lastRunSummary, replay);
  }

  async submitRunIfNeeded(runSummary, replay) {
    if (!runSummary || !replay || !this.activeRemoteSession) {
      return;
    }
    if (this.lastRemoteSubmission?.runId === runSummary.id) {
      return;
    }

    const context = { ...this.activeRemoteSession };
    if (!this.apiClient.configured) {
      this.lastRemoteSubmission = {
        runId: runSummary.id,
        status: "error",
        context,
      };
      this.statusMessage = "分享 API 不可用，本局成绩未提交。";
      this.updateUiState();
      return;
    }

    this.lastRemoteSubmission = {
      runId: runSummary.id,
      status: "pending",
      context,
    };
    this.statusMessage =
      context.type === "daily"
        ? `正在提交今日挑战 ${context.date} 的成绩…`
        : `正在提交挑战 ${context.code} 的成绩…`;
    this.updateUiState();

    try {
      const replayResponse = await this.apiClient.uploadReplay(replay);
      const payload = this.buildRemoteSubmissionPayload(runSummary, replayResponse.code);
      if (context.type === "daily") {
        await this.apiClient.submitDaily(context.date, payload);
        this.statusMessage = `今日挑战 ${context.date} 成绩已提交。`;
      } else {
        await this.apiClient.submitChallenge(context.code, payload);
        this.statusMessage = `挑战 ${context.code} 成绩已提交。`;
      }
      this.lastRemoteSubmission = {
        runId: runSummary.id,
        status: "success",
        context,
        replayCode: replayResponse.code,
      };
      await this.refreshRemoteLeaderboard(context);
      return;
    } catch (error) {
      this.lastRemoteSubmission = {
        runId: runSummary.id,
        status: "error",
        context,
      };
      this.statusMessage = error instanceof Error ? error.message : "成绩提交失败。";
    }

    this.updateUiState();
  }

  exportReplay() {
    if (this.lastReplay) {
      return this.lastReplay;
    }

    if (!this.activeRecorder) {
      return null;
    }

    return this.activeRecorder.finalize({
      durationMs: this.engine.elapsedMs,
      result: this.engine.serializeState(),
      finalSnapshot: this.engine.exportSnapshot(),
    });
  }

  startReplay(
    replay,
    { startAtMs = 0, title = "本局回放", subtitle = "正在播放本地回放。", watchSession = null } = {}
  ) {
    if (!replay || this.replayPlayer) {
      return;
    }

    this.toggleSettings(false);
    this.clearPendingTouchTap();
    this.releaseGestureInput();
    this.liveEngine = this.engine;
    this.replayPlayer = new ReplayPlayer(replay, { startAtMs });
    this.engine = this.replayPlayer.engine;
    this.setWatchSession(watchSession);
    this.replayMeta = { replay, startAtMs, title, subtitle };
    this.replayTitle.textContent = title;
    this.replayCopy.textContent = subtitle;
    this.updateUiState();
    this.render();
  }

  stopReplay() {
    if (!this.replayPlayer || !this.liveEngine) {
      return;
    }

    this.engine = this.liveEngine;
    this.liveEngine = null;
    this.replayPlayer = null;
    this.replayMeta = null;
    this.setWatchSession(null);
    this.statusMessage = "";
    this.updateUiState();
    this.render();
  }

  startGameFromWatchedReplay() {
    const watchSession = this.watchSession;
    if (!watchSession?.replay) {
      return;
    }
    const replay = watchSession.replay;
    if (this.replayPlayer) {
      this.stopReplay();
    }
    this.startGame({
      gameMode: sanitizeGameMode(replay.mode),
      seed: replay.seed,
    });
    this.statusMessage = `已切换到 ${getModeDefinition(replay.mode).label} 同种子对局。`;
    this.updateUiState();
  }

  restartReplay() {
    if (!this.replayMeta) {
      return;
    }
    const { replay, startAtMs, title, subtitle } = this.replayMeta;
    this.stopReplay();
    this.startReplay(replay, { startAtMs, title, subtitle });
  }

  replayLastRun() {
    if (!this.lastReplay) {
      this.statusMessage = "当前还没有可回放的完整对局。";
      this.updateUiState();
      return;
    }
    this.startReplay(this.lastReplay, {
      title: "本局回放",
      subtitle: `${getModeDefinition(this.lastReplay.mode).label} · Seed ${this.lastReplay.seed}`,
    });
  }

  replayLastClip() {
    if (!this.lastReplay) {
      this.statusMessage = "当前还没有可回放的完整对局。";
      this.updateUiState();
      return;
    }
    const clip = buildReplayClip(this.lastReplay, 8000);
    this.startReplay(clip.replay, {
      startAtMs: clip.startAtMs,
      title: "最后 8 秒",
      subtitle: "快速回看刚刚出事的那一段。",
    });
  }

  replayMostRecentRun() {
    const latestRun = this.profile.runs[0];
    const replay = latestRun ? getReplayForRun(this.profile, latestRun.replayId) : null;
    if (!replay) {
      this.statusMessage = "最近战绩里还没有可回放的数据。";
      this.updateUiState();
      return;
    }

    this.startReplay(replay, {
      title: "最近一局",
      subtitle: `${latestRun.label} · ${formatScore(latestRun.score)} 分`,
    });
  }

  async shareLastReplay() {
    const replay = this.lastReplay;
    if (!replay) {
      this.statusMessage = "当前还没有可导出的回放。";
      this.updateUiState();
      return;
    }

    const localPayload = JSON.stringify(replay);
    if (!this.apiClient.configured) {
      await navigator.clipboard?.writeText(localPayload).catch(() => {});
      this.statusMessage = "分享 API 未配置，已尝试把回放 JSON 复制到剪贴板。";
      this.updateUiState();
      return;
    }

    try {
      const response = await this.apiClient.uploadReplay(replay);
      await navigator.clipboard?.writeText(response.url ?? response.code ?? "").catch(() => {});
      this.statusMessage = `已上传回放，分享码 ${response.code} 已尝试复制。`;
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : "上传回放失败。";
    }
    this.updateUiState();
  }

  getLatestResultForSharing() {
    return this.lastRunSummary ?? this.profile.runs[0] ?? null;
  }

  getSubmissionForRun(runSummary) {
    return runSummary && this.lastRemoteSubmission?.runId === runSummary.id ? this.lastRemoteSubmission : null;
  }

  drawShareCardStat(ctx, x, y, width, height, value, label) {
    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
    fillRoundedRect(ctx, x, y, width, height, 26);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    strokeRoundedRect(ctx, x, y, width, height, 26);
    ctx.fillStyle = this.theme.canvas.textPrimary;
    ctx.font = "700 56px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText(String(value), x + 28, y + 74);
    ctx.fillStyle = this.theme.canvas.textMuted;
    ctx.font = "600 24px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText(label, x + 28, y + height - 24);
    ctx.restore();
  }

  drawShareCardGem(ctx, x, y, size, pieceType) {
    const piece = this.theme.pieces[pieceType];
    const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
    gradient.addColorStop(0, piece.highlight);
    gradient.addColorStop(0.48, piece.fill);
    gradient.addColorStop(1, piece.shade);
    ctx.save();
    ctx.shadowColor = piece.glow;
    ctx.shadowBlur = 26;
    ctx.fillStyle = gradient;
    fillRoundedRect(ctx, x, y, size, size, size * 0.24);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = piece.edge;
    ctx.lineWidth = Math.max(3, size * 0.06);
    strokeRoundedRect(ctx, x + 3, y + 3, size - 6, size - 6, size * 0.2);
    ctx.fillStyle = piece.specular;
    fillRoundedRect(ctx, x + size * 0.16, y + size * 0.14, size * 0.42, size * 0.18, size * 0.08);
    ctx.restore();
  }

  async shareResultCard() {
    const runSummary = this.getLatestResultForSharing();
    if (!runSummary) {
      this.statusMessage = "先完成一局，才能生成成绩卡。";
      this.updateUiState();
      return;
    }

    try {
      const asset = await this.buildShareCardAsset(runSummary);
      const shareTitle = `${runSummary.label} ${formatScore(runSummary.score)} 分`;
      if (
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        typeof File === "function"
      ) {
        const file = new File([asset.blob], asset.fileName, { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: shareTitle,
            text: "Russian Block 成绩卡",
            files: [file],
          });
          this.statusMessage = "成绩卡已调起系统分享。";
          this.updateUiState();
          return;
        }
      }

      const objectUrl = URL.createObjectURL(asset.blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = asset.fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
      this.statusMessage = "成绩卡已导出为 PNG。";
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : "生成成绩卡失败。";
    }

    this.updateUiState();
  }

  async buildShareCardAsset(runSummary) {
    const width = 1200;
    const height = 1600;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Share card canvas is unavailable.");
    }

    const submission = this.getSubmissionForRun(runSummary);
    const pageUrl = `${window.location.origin}${window.location.pathname}`;
    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, this.theme.canvas.backgroundStart);
    background.addColorStop(1, this.theme.canvas.backgroundEnd);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalAlpha = 0.18;
    const halo = ctx.createRadialGradient(width * 0.18, height * 0.16, 10, width * 0.18, height * 0.16, 320);
    halo.addColorStop(0, this.theme.canvas.accent);
    halo.addColorStop(1, "transparent");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.16;
    const haloTwo = ctx.createRadialGradient(width * 0.82, height * 0.2, 10, width * 0.82, height * 0.2, 280);
    haloTwo.addColorStop(0, this.theme.canvas.statsAccent);
    haloTwo.addColorStop(1, "transparent");
    ctx.fillStyle = haloTwo;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    ctx.fillStyle = this.theme.ui.panel;
    fillRoundedRect(ctx, 72, 72, width - 144, height - 144, 56);
    ctx.strokeStyle = this.theme.ui.panelBorder;
    ctx.lineWidth = 2;
    strokeRoundedRect(ctx, 72, 72, width - 144, height - 144, 56);

    this.drawShareCardGem(ctx, 860, 128, 136, "T");
    this.drawShareCardGem(ctx, 930, 248, 92, "I");
    this.drawShareCardGem(ctx, 112, 1220, 118, "O");
    this.drawShareCardGem(ctx, 226, 1278, 84, "S");

    ctx.fillStyle = this.theme.canvas.textMuted;
    ctx.font = "700 28px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText(this.theme.preview.badge, 132, 146);

    ctx.fillStyle = this.theme.canvas.textPrimary;
    ctx.font = "700 82px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText("Russian Block", 128, 230);

    ctx.fillStyle = this.theme.canvas.accentSoft;
    ctx.font = "700 34px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText(runSummary.label, 132, 300);

    ctx.fillStyle = this.theme.canvas.textMuted;
    ctx.font = "600 28px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText(runSummary.outcome === "completed" ? "Completed Run" : "Score Run", 132, 344);

    ctx.fillStyle = this.theme.canvas.textMuted;
    ctx.font = "600 26px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText("Score", 132, 448);
    ctx.fillStyle = this.theme.canvas.textPrimary;
    ctx.font = "700 156px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText(formatScore(runSummary.score), 128, 590);

    this.drawShareCardStat(ctx, 128, 680, 292, 154, runSummary.lines, "Lines");
    this.drawShareCardStat(ctx, 454, 680, 292, 154, formatDuration(runSummary.durationMs), "Duration");
    this.drawShareCardStat(ctx, 780, 680, 292, 154, runSummary.combo, "Best Combo");

    this.drawShareCardStat(ctx, 128, 870, 438, 154, this.theme.name, "Theme");
    this.drawShareCardStat(ctx, 600, 870, 472, 154, runSummary.seed || "AUTO", "Seed");

    if (submission) {
      const badgeText =
        submission.context.type === "daily"
          ? `Daily ${submission.context.date}`
          : `Challenge ${submission.context.code}`;
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      fillRoundedRect(ctx, 128, 1080, 944, 94, 28);
      ctx.fillStyle = this.theme.canvas.accentSoft;
      ctx.font = "700 34px 'Trebuchet MS', 'Segoe UI', sans-serif";
      ctx.fillText(badgeText, 160, 1140);
      ctx.fillStyle = this.theme.canvas.textMuted;
      ctx.font = "600 24px 'Trebuchet MS', 'Segoe UI', sans-serif";
      ctx.fillText(
        submission.status === "success" ? "Submission synced" : "Submission pending",
        160,
        1108
      );
    }

    ctx.fillStyle = this.theme.canvas.textMuted;
    ctx.font = "600 28px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText("Play the same board in your browser", 132, 1340);
    ctx.fillStyle = this.theme.canvas.textPrimary;
    ctx.font = "700 34px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText(pageUrl, 132, 1398);

    ctx.fillStyle = this.theme.canvas.footer;
    ctx.font = "600 24px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText(
      `Best ${formatScore(this.engine.bestScore)} · Level ${runSummary.level} · ${new Date(runSummary.createdAt).toLocaleDateString("zh-CN")}`,
      132,
      1490
    );

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      throw new Error("Failed to export share card.");
    }

    return {
      blob,
      fileName: `russian-block-${runSummary.gameMode}-${runSummary.score}.png`,
    };
  }

  async createChallengeFromLastRun() {
    if (!this.lastReplay || !this.lastRunSummary) {
      this.statusMessage = "先完成一局，才能生成挑战。";
      this.updateUiState();
      return;
    }
    if (!this.apiClient.configured) {
      this.statusMessage = "请先在设置里配置 API Base。";
      this.updateUiState();
      return;
    }

    try {
      const replayResponse = await this.apiClient.uploadReplay(this.lastReplay);
      const challengeResponse = await this.apiClient.createChallenge({
        kind: "score_chase",
        mode: this.lastReplay.mode,
        seed: this.lastReplay.seed,
        replayCode: replayResponse.code,
        goal: {
          score: this.lastRunSummary.score,
          lines: this.lastRunSummary.lines,
          durationMs: this.lastRunSummary.durationMs,
        },
        title: `${this.lastRunSummary.label} 挑战`,
      });
      const url =
        challengeResponse.url ??
        `${window.location.origin}${window.location.pathname}?play=challenge&code=${challengeResponse.code}`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      this.statusMessage = `挑战已生成，链接已尝试复制。code: ${challengeResponse.code}`;
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : "生成挑战失败。";
    }
    this.updateUiState();
  }

  async openChallengeFromCode(code) {
    const normalizedCode = String(code ?? "").trim();
    if (!normalizedCode) {
      this.statusMessage = "先输入挑战码。";
      this.updateUiState();
      return;
    }
    if (!this.apiClient.configured) {
      this.statusMessage = "当前没有配置分享 API。";
      this.updateUiState();
      return;
    }

    try {
      const challenge = await this.apiClient.getChallenge(normalizedCode);
      this.shareCodeInput.value = normalizedCode;
      this.statusMessage = `已载入挑战 ${normalizedCode}。`;
      this.startGame({
        gameMode: sanitizeGameMode(challenge.mode ?? "seed_challenge"),
        seed: challenge.seed,
        remoteContext: {
          type: "challenge",
          code: normalizedCode,
          title: challenge.title ?? normalizedCode,
        },
      });
      this.statusMessage = `已载入挑战 ${normalizedCode}。`;
      this.updateUiState();
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : "载入挑战失败。";
      this.updateUiState();
    }
  }

  async openReplayFromCode(code) {
    const normalizedCode = String(code ?? "").trim();
    if (!normalizedCode) {
      this.statusMessage = "先输入回放码。";
      this.updateUiState();
      return;
    }
    if (!this.apiClient.configured) {
      this.statusMessage = "当前没有配置分享 API。";
      this.updateUiState();
      return;
    }

    try {
      const response = await this.apiClient.getReplay(normalizedCode);
      const replay = response.replay ?? response;
      this.lastReplay = replay;
      this.shareCodeInput.value = normalizedCode;
      this.statusMessage = `已载入回放 ${normalizedCode}。`;
      this.startReplay(replay, {
        title: `分享回放 ${normalizedCode}`,
        subtitle: `${getModeDefinition(replay.mode).label} · Seed ${replay.seed}`,
        watchSession: {
          code: normalizedCode,
          replay,
        },
      });
      this.updateUiState();
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : "载入回放失败。";
      this.updateUiState();
    }
  }

  async loadDailyChallenge() {
    if (!this.apiClient.configured) {
      this.statusMessage = "当前没有配置分享 API。";
      this.updateUiState();
      return;
    }

    try {
      const date = new Date().toISOString().slice(0, 10);
      const response = await this.apiClient.getDaily(date);
      const daily = response.challenge ?? response;
      this.statusMessage = `今日挑战 ${date} 已就绪。`;
      this.startGame({
        gameMode: sanitizeGameMode(daily.mode ?? "seed_challenge"),
        seed: daily.seed,
        remoteContext: {
          type: "daily",
          date,
          title: `今日挑战 ${date}`,
        },
      });
      this.statusMessage = `今日挑战 ${date} 已就绪。`;
      this.updateUiState();
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : "载入今日挑战失败。";
      this.updateUiState();
    }
  }

  async bootstrapSharedRoute() {
    const code = this.query.get("code") ?? "";
    const playMode = this.query.get("play");
    const watchMode = this.query.get("watch");
    if (playMode === "challenge" && code) {
      await this.openChallengeFromCode(code);
    } else if (watchMode === "replay" && code) {
      await this.openReplayFromCode(code);
    } else if (playMode === "puzzle" && code) {
      this.statusMessage = `残局路由 ${code} 已预留，等待后续题面系统接入。`;
      this.updateUiState();
    }
  }

  renderHistory() {
    const totalPlay = formatDuration(this.profile.stats.totalPlayMs);
    this.menuSummary.innerHTML = `
      <div class="summary-chip"><strong>${formatScore(this.profile.stats.bestScore)}</strong><span>全局最高分</span></div>
      <div class="summary-chip"><strong>${this.profile.stats.totalRuns}</strong><span>总局数</span></div>
      <div class="summary-chip"><strong>${totalPlay}</strong><span>总时长</span></div>
      <div class="summary-chip"><strong>${this.profile.stats.bestCombo}</strong><span>最佳连击</span></div>
    `;

    if (this.profile.runs.length === 0) {
      this.historyList.innerHTML = `<div class="history-empty">还没有战绩，先来一局。</div>`;
      return;
    }

    this.historyList.innerHTML = this.profile.runs
      .slice(0, 5)
      .map((run) => {
        return `
          <button type="button" class="history-row" data-history-replay="${run.replayId}">
            <strong>${safeText(run.label)}</strong>
            <span>${formatScore(run.score)} 分 · ${run.lines} 行 · ${formatDuration(run.durationMs)}</span>
          </button>
        `;
      })
      .join("");

    this.historyList.querySelectorAll("[data-history-replay]").forEach((button) => {
      button.addEventListener("click", () => {
        const replay = getReplayForRun(this.profile, button.dataset.historyReplay);
        if (replay) {
          this.startReplay(replay, {
            title: "历史回放",
            subtitle: `${getModeDefinition(replay.mode).label} · Seed ${replay.seed}`,
          });
        }
      });
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
    if (this.replayPlayer) {
      if (event.key.toLowerCase() === "escape") {
        event.preventDefault();
        this.stopReplay();
      }
      return;
    }

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
        this.recordAction("rotate_cw");
      }
    } else if (key === " " || key === "spacebar") {
      this.engine.hardDrop();
      this.audio.play("drop");
      this.recordAction("hard_drop");
    } else if (key === "c") {
      if (this.engine.holdCurrentPiece()) {
        this.audio.play("hold");
        this.recordAction("hold");
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
    if (this.replayPlayer) {
      return;
    }
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
        this.recordAction(direction === "left" ? "step_left" : "step_right");
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
      this.recordAction("soft_drop_step");
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
    if (this.replayPlayer || event.pointerType === "mouse" || this.engine.mode !== "playing" || this.isSettingsOpen()) {
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
        this.recordAction(direction < 0 ? "step_left" : "step_right");
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
      this.recordAction("soft_drop_step");
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
      this.recordAction("hard_drop");
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
          this.recordAction("hold");
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
        this.recordAction("rotate_cw");
      }
      this.afterStateChange();
    }, SINGLE_TAP_DELAY_MS);

    this.pendingTouchTap = pendingTap;
  }

  startGame(overrides = {}) {
    this.audio.unlock();
    this.toggleSettings(false);
    this.clearPendingTouchTap();
    this.releaseGestureInput();
    this.statusMessage = "";
    this.setRemoteSession(overrides.remoteContext ?? null);
    const config = this.createGameConfig(overrides);
    this.selectedGameMode = config.gameMode;
    this.selectedSeed = config.seed;
    this.engine.startNewGame(config);
    this.settings.lastMode = config.gameMode;
    this.settings.lastSeed = config.seed;
    this.beginRecordingSession();
    this.audio.play("click");
    this.afterStateChange();
    if (this.activeRemoteSession) {
      void this.refreshRemoteLeaderboard(this.activeRemoteSession);
    }
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
    if (this.replayPlayer) {
      this.stopReplay();
    }
    this.audio.unlock();
    this.toggleSettings(false);
    this.clearPendingTouchTap();
    this.releaseGestureInput();
    this.statusMessage = "";
    this.lastRemoteSubmission = null;
    this.engine.restart();
    this.beginRecordingSession();
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
    if (this.replayPlayer) {
      this.stopReplay();
    }
    this.toggleSettings(false);
    this.clearPendingTouchTap();
    this.releaseGestureInput();
    this.statusMessage = "";
    this.setRemoteSession(null);
    this.engine.resetToMenu();
    this.audio.play("click");
    this.afterStateChange();
  }

  togglePause() {
    if (this.replayPlayer || this.engine.mode === "menu" || this.engine.mode === "gameover" || this.engine.mode === "completed") {
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
    this.settings.lastMode = this.selectedGameMode;
    this.settings.lastSeed = this.selectedSeed;
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
        this.captureRecorderMarker(effect.tSpin ? "tspin" : "line-clear");
      } else if (effect.type === "completed") {
        this.audio.play("line-clear");
        this.captureRecorderMarker("completed");
        this.finalizeCurrentRun();
      } else if (effect.type === "gameover") {
        this.audio.play("gameover");
        this.captureRecorderMarker("gameover");
        this.finalizeCurrentRun();
      } else if (effect.type === "drop") {
        this.audio.play("drop");
      } else if (effect.type === "hold") {
        this.captureRecorderMarker("hold");
      }
    }
    this.persistSettings();
  }

  advanceTime(deltaMs) {
    if (this.replayPlayer) {
      this.replayPlayer.update(deltaMs);
      this.updateUiState();
      this.render();
      return;
    }

    this.tickInputs(deltaMs);
    this.engine.update(deltaMs);
    this.captureRecorderMarker();
    this.processEffects();
    this.updateUiState();
    this.render();
  }

  tickInputs(deltaMs) {
    if (this.replayPlayer || this.engine.mode !== "playing") {
      return;
    }

    const leftPressed = this.horizontalState.left.pressed;
    const rightPressed = this.horizontalState.right.pressed;

    if (leftPressed && !rightPressed) {
      this.updateRepeat(this.horizontalState.left, deltaMs, () => {
        if (this.engine.moveHorizontal(-1)) {
          this.audio.play("click");
          this.recordAction("step_left");
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
          this.recordAction("step_right");
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
        this.recordAction("soft_drop_step");
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
    this.autostartToggle.checked = this.settings.autoStartLastMode;
    this.ghostToggle.checked = this.settings.ghostEnabled;
    this.apiBaseInput.value = this.settings.apiBase ?? "";
    this.menuOverlay.classList.toggle("overlay--hidden", this.engine.mode !== "menu");
    this.pauseOverlay.classList.toggle("overlay--hidden", this.engine.mode !== "paused");
    this.gameOverOverlay.classList.toggle(
      "overlay--hidden",
      this.engine.mode !== "gameover" && this.engine.mode !== "completed"
    );
    this.pauseButton.hidden = this.engine.mode !== "playing" || Boolean(this.replayPlayer);
    this.replayBanner.classList.toggle("replay-banner--hidden", !this.replayPlayer);
    this.watchPanel.classList.toggle("watch-panel--hidden", !(this.replayPlayer && this.watchSession));
    this.updateModeUi();
    this.renderHistory();

    if (this.replayPlayer && this.watchSession?.replay) {
      const watchedReplay = this.watchSession.replay;
      this.watchPanelTitle.textContent = `回放码 ${this.watchSession.code}`;
      this.watchPanelCopy.textContent = `${getModeDefinition(watchedReplay.mode).label} · Seed ${watchedReplay.seed}`;
      this.watchPanelGrid.innerHTML = `
        <div class="watch-panel-chip"><strong>${formatScore(watchedReplay.result?.score ?? 0)}</strong><span>分数</span></div>
        <div class="watch-panel-chip"><strong>${watchedReplay.result?.lines ?? 0}</strong><span>消行</span></div>
        <div class="watch-panel-chip"><strong>${formatDuration(watchedReplay.durationMs ?? 0)}</strong><span>时长</span></div>
        <div class="watch-panel-chip"><strong>${safeText(getTheme(watchedReplay.themeId).name)}</strong><span>主题</span></div>
      `;
    } else {
      this.watchPanelTitle.textContent = "Shared Replay";
      this.watchPanelCopy.textContent = "";
      this.watchPanelGrid.innerHTML = "";
    }

    const latestRun = this.lastRunSummary ?? this.profile.runs[0] ?? null;
    const latestSubmission =
      latestRun && this.lastRemoteSubmission?.runId === latestRun.id ? this.lastRemoteSubmission : null;
    const leaderboardContext = latestSubmission?.context ?? this.activeRemoteSession;
    if (this.engine.mode === "completed") {
      this.resultEyebrow.textContent = "Completed";
      this.resultTitle.textContent = "挑战完成";
    } else {
      this.resultEyebrow.textContent = "Game Over";
      this.resultTitle.textContent = "堆到顶了";
    }
    this.gameOverCopy.textContent = `本局得分 ${formatScore(this.engine.score)}，最高分 ${formatScore(this.engine.bestScore)}。`;
    this.resultGrid.innerHTML = latestRun
      ? `
        <div class="result-chip"><strong>${safeText(latestRun.label)}</strong><span>模式</span></div>
        <div class="result-chip"><strong>${formatDuration(latestRun.durationMs)}</strong><span>时长</span></div>
        <div class="result-chip"><strong>${latestRun.lines}</strong><span>消行</span></div>
        <div class="result-chip"><strong>${latestRun.combo}</strong><span>最佳连击</span></div>
      `
      : "";
    if (latestSubmission) {
      this.resultGrid.innerHTML += `
        <div class="result-chip"><strong>${safeText(
          latestSubmission.context.type === "daily"
            ? latestSubmission.context.date
            : latestSubmission.context.code
        )}</strong><span>${latestSubmission.context.type === "daily" ? "今日挑战" : "挑战码"}</span></div>
        <div class="result-chip"><strong>${
          latestSubmission.status === "success"
            ? "已提交"
            : latestSubmission.status === "pending"
              ? "提交中"
              : "失败"
        }</strong><span>分享状态</span></div>
      `;
    }
    this.resultLeaderboard.classList.toggle("leaderboard-panel--hidden", !leaderboardContext);
    if (leaderboardContext) {
      this.leaderboardTitle.textContent =
        leaderboardContext.type === "daily"
          ? `今日挑战 ${leaderboardContext.date}`
          : `挑战榜 ${leaderboardContext.code}`;
      this.leaderboardStatus.textContent =
        this.remoteLeaderboardStatus === "loading"
          ? "刷新中"
          : this.remoteLeaderboardStatus === "error"
            ? "加载失败"
            : `${this.remoteLeaderboard?.entries?.length ?? 0} 条`;
      if (this.remoteLeaderboardStatus === "loading" && (this.remoteLeaderboard?.entries?.length ?? 0) === 0) {
        this.leaderboardList.innerHTML = `<div class="leaderboard-empty">正在刷新排行榜…</div>`;
      } else if (this.remoteLeaderboardStatus === "error") {
        this.leaderboardList.innerHTML = `<div class="leaderboard-empty">${safeText(
          this.remoteLeaderboardError || "排行榜暂时不可用。"
        )}</div>`;
      } else if ((this.remoteLeaderboard?.entries?.length ?? 0) === 0) {
        this.leaderboardList.innerHTML = `<div class="leaderboard-empty">还没有成绩，等你第一个上榜。</div>`;
      } else {
        this.leaderboardList.innerHTML = this.remoteLeaderboard.entries
          .slice(0, 5)
          .map((entry, index) => {
            const name = String(entry.nickname ?? "").trim() || "Anonymous";
            return `
              <div class="leaderboard-row">
                <span class="leaderboard-rank">#${index + 1}</span>
                <div class="leaderboard-copy">
                  <strong>${safeText(name)}</strong>
                  <span>${Number(entry.lines) || 0} lines · ${formatDuration(Number(entry.duration_ms ?? entry.durationMs) || 0)}</span>
                </div>
                <span class="leaderboard-score">${formatScore(Number(entry.score) || 0)}</span>
              </div>
            `;
          })
          .join("");
      }
    } else {
      this.leaderboardTitle.textContent = "排行榜";
      this.leaderboardStatus.textContent = "";
      this.leaderboardList.innerHTML = "";
    }
    this.statusCopy.textContent =
      this.statusMessage ||
      `当前模式最佳 ${formatScore(getBestScoreForMode(this.profile, this.selectedGameMode))} 分。`;
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

    if (this.settings.ghostEnabled) {
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
    const compact = rect.h < 150;
    const lines = compact
      ? [
          ["模式", getModeDefinition(this.engine.sessionConfig.gameMode).name],
          ["等级", String(this.engine.level)],
          ["消行", String(this.engine.lines)],
          ["连击", String(this.engine.combo)],
        ]
      : [
          ["模式", getModeDefinition(this.engine.sessionConfig.gameMode).name],
          ["状态", this.engine.mode === "paused" ? "暂停中" : this.engine.mode === "completed" ? "已完成" : this.engine.mode === "gameover" ? "结束" : this.engine.mode === "menu" ? "待开始" : "进行中"],
          ["最高分", formatScore(this.engine.bestScore)],
          ["等级", String(this.engine.level)],
          ["消行", String(this.engine.lines)],
          ["暂存", this.engine.holdPieceType ?? "-"],
          ["主题", this.theme.name],
          ["连击", String(this.engine.combo)],
          ["B2B", String(this.engine.backToBack)],
        ];

    ctx.save();
    ctx.fillStyle = this.theme.canvas.textMuted;
    ctx.font = "600 13px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText("当前分数", rect.x + 16, rect.y + 54);
    ctx.fillStyle = this.theme.canvas.textPrimary;
    ctx.font = "700 22px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillText(formatScore(this.engine.score), rect.x + 16, rect.y + 82);
    ctx.font = "500 12px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillStyle = this.theme.canvas.statsAccent;
    const timerLabel =
      this.engine.remainingMs !== null
        ? `剩余 ${formatTimer(this.engine.remainingMs)}`
        : `时长 ${formatTimer(this.engine.elapsedMs)}`;
    ctx.fillText(timerLabel, rect.x + 16, rect.y + 102);

    ctx.font = "500 14px 'Trebuchet MS', 'Segoe UI', sans-serif";
    ctx.fillStyle = this.theme.canvas.textMuted;
    lines.forEach(([label, value], index) => {
      const y = rect.y + 132 + index * (compact ? 18 : 20);
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
      this.replayPlayer
        ? "回放中 · Esc 退出回放"
        : this.engine.mode === "menu"
          ? `${getModeDefinition(this.selectedGameMode).label} 已就绪`
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
