import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { buildProject } from "./build.mjs";
import { startStaticServer } from "./static-server.mjs";
import { TetrisEngine } from "../src/game/engine.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDir = path.join(rootDir, "output", "web-game");
const testDistDir = path.join(rootDir, "output", ".tmp-test-dist");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getServerUrl(server) {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine the test server address.");
  }
  return `http://127.0.0.1:${address.port}`;
}

function runEngineSmokeTests() {
  const engine = new TetrisEngine({ bestScore: 0 });
  engine.startNewGame();

  const initialX = engine.activePiece.x;
  assert(engine.moveHorizontal(-1), "Expected active piece to move left");
  assert(engine.activePiece.x === initialX - 1, "Active piece x should decrease after moving left");

  const rotated = engine.rotate(1);
  assert(rotated, "Expected active piece to rotate");

  const holdType = engine.activePiece.type;
  engine.holdCurrentPiece();
  assert(engine.holdPieceType === holdType, "Hold should store the current piece");

  engine.togglePause();
  assert(engine.mode === "paused", "Engine should enter paused mode");
  engine.togglePause();
  assert(engine.mode === "playing", "Engine should resume from pause");

  engine.hardDrop();
  assert(engine.score > 0, "Hard drop should award score");

  engine.restart();
  assert(engine.mode === "playing", "Restart should start a fresh game");

  const snapshot = engine.serializeState();
  assert(snapshot.board.length === 20, "Serialized board should expose 20 visible rows");
  assert(Array.isArray(snapshot.nextQueue) && snapshot.nextQueue.length >= 3, "Serialized queue should include previews");
}

async function runDesktopSkillClient(baseUrl) {
  const codeHome = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  const clientScript = path.join(codeHome, "skills", "develop-web-game", "scripts", "web_game_playwright_client.js");
  const bootstrapScript = path.join(rootDir, "scripts", "playwright-bootstrap.mjs");
  const actionsFile = path.join(rootDir, "test", "game-actions.json");
  if (!fs.existsSync(clientScript)) {
    console.log("Skipping desktop Playwright skill loop because the skill client script is unavailable.");
    return;
  }

  const skillScriptsDir = path.dirname(clientScript);
  const linkedNodeModules = path.join(skillScriptsDir, "node_modules");
  const localNodeModules = path.join(rootDir, "node_modules");
  if (fs.existsSync(localNodeModules) && !fs.existsSync(linkedNodeModules)) {
    fs.symlinkSync(localNodeModules, linkedNodeModules, "junction");
  }

  fs.mkdirSync(screenshotDir, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(bootstrapScript).href,
        clientScript,
        "--url",
        baseUrl,
        "--actions-file",
        actionsFile,
        "--click-selector",
        "#start-btn",
        "--iterations",
        "1",
        "--pause-ms",
        "200",
        "--screenshot-dir",
        screenshotDir,
      ],
      {
        cwd: rootDir,
        stdio: "inherit",
      }
    );

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Playwright client exited with code ${code}`));
      }
    });
  });
}

async function dispatchTouchSequence(page, steps, pointerId) {
  await page.evaluate(
    async ({ pointerId: currentPointerId, currentSteps }) => {
      const target = document.querySelector("#game-canvas");
      if (!target) {
        throw new Error("Canvas was not found for the touch gesture test.");
      }

      const wait = (time) => new Promise((resolve) => window.setTimeout(resolve, time));
      for (const step of currentSteps) {
        const event = new PointerEvent(step.type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: currentPointerId,
          pointerType: "touch",
          isPrimary: true,
          buttons: step.type === "pointerup" || step.type === "pointercancel" ? 0 : 1,
          clientX: step.x,
          clientY: step.y,
        });
        target.dispatchEvent(event);
        if (step.waitMs) {
          await wait(step.waitMs);
        }
      }
    },
    { pointerId, currentSteps: steps }
  );
}

async function getBoardGeometry(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#game-canvas");
    if (!canvas) {
      throw new Error("Canvas was not found.");
    }

    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const portrait = width < height * 0.85;

    let boardX;
    let boardY;
    let boardWidth;
    let boardHeight;
    let cellSize;

    if (portrait) {
      const topBand = Math.max(108, height * 0.17);
      cellSize = Math.min((width - 44) / 10, (height - topBand - 28) / 20);
      boardWidth = cellSize * 10;
      boardHeight = cellSize * 20;
      boardX = (width - boardWidth) / 2;
      boardY = topBand;
    } else {
      const sidePanelWidth = Math.min(216, width * 0.22);
      cellSize = Math.min((width - sidePanelWidth * 2 - 88) / 10, (height - 50) / 20);
      boardWidth = cellSize * 10;
      boardHeight = cellSize * 20;
      boardX = (width - boardWidth) / 2;
      boardY = (height - boardHeight) / 2;
    }

    return {
      left: rect.left + boardX,
      top: rect.top + boardY,
      width: boardWidth,
      height: boardHeight,
      cellSize,
    };
  });
}

function boardPoint(geometry, xRatio, yRatio) {
  return {
    x: geometry.left + geometry.width * xRatio,
    y: geometry.top + geometry.height * yRatio,
  };
}

async function runMobileGestureLoop(baseUrl, playwright) {
  const { chromium, devices } = playwright;
  const browser = await chromium.launch({ headless: true });
  const device = devices["Pixel 7"] ?? devices["Pixel 5"];
  const context = await browser.newContext({
    ...device,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  const consoleErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  try {
    await page.goto(`${baseUrl}?autostart=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(150);

    const touchControlsCount = await page.locator(".touch-controls").count();
    assert(touchControlsCount === 0, "Touch button controls should be removed from the mobile layout");

    const geometry = await getBoardGeometry(page);
    let pointerId = 100;
    const nextPointerId = () => {
      pointerId += 1;
      return pointerId;
    };
    const getState = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));

    const rotationStart = await getState();
    const tapPoint = boardPoint(geometry, 0.52, 0.16);
    await dispatchTouchSequence(
      page,
      [
        { type: "pointerdown", x: tapPoint.x, y: tapPoint.y, waitMs: 12 },
        { type: "pointerup", x: tapPoint.x, y: tapPoint.y, waitMs: 0 },
      ],
      nextPointerId()
    );
    await page.waitForTimeout(240);
    const afterRotate = await getState();
    assert(
      afterRotate.activePiece.rotation !== rotationStart.activePiece.rotation,
      "Single tap should rotate the active piece"
    );

    const beforeHold = await getState();
    const holdPoint = boardPoint(geometry, 0.56, 0.18);
    await dispatchTouchSequence(
      page,
      [
        { type: "pointerdown", x: holdPoint.x, y: holdPoint.y, waitMs: 10 },
        { type: "pointerup", x: holdPoint.x, y: holdPoint.y, waitMs: 80 },
      ],
      nextPointerId()
    );
    await dispatchTouchSequence(
      page,
      [
        { type: "pointerdown", x: holdPoint.x, y: holdPoint.y, waitMs: 10 },
        { type: "pointerup", x: holdPoint.x, y: holdPoint.y, waitMs: 10 },
      ],
      nextPointerId()
    );
    await page.waitForTimeout(80);
    const afterHold = await getState();
    assert(afterHold.holdPiece === beforeHold.activePiece.type, "Double tap should hold the active piece");

    const beforeSwipe = await getState();
    const swipeStart = boardPoint(geometry, 0.44, 0.2);
    const swipeEnd = { x: swipeStart.x + geometry.cellSize * 2.1, y: swipeStart.y + 3 };
    await dispatchTouchSequence(
      page,
      [
        { type: "pointerdown", x: swipeStart.x, y: swipeStart.y, waitMs: 12 },
        { type: "pointermove", x: swipeStart.x + geometry.cellSize * 0.9, y: swipeStart.y + 2, waitMs: 16 },
        { type: "pointermove", x: swipeEnd.x, y: swipeEnd.y, waitMs: 16 },
        { type: "pointerup", x: swipeEnd.x, y: swipeEnd.y, waitMs: 20 },
      ],
      nextPointerId()
    );
    const afterSwipe = await getState();
    assert(afterSwipe.activePiece.x > beforeSwipe.activePiece.x, "Horizontal swipe should move the piece to the right");

    const beforeSoftDrop = await getState();
    const softDropStart = boardPoint(geometry, 0.48, 0.16);
    const softDropMove = { x: softDropStart.x, y: softDropStart.y + geometry.cellSize * 1.3 };
    const softDropPointerId = nextPointerId();
    await dispatchTouchSequence(
      page,
      [
        { type: "pointerdown", x: softDropStart.x, y: softDropStart.y, waitMs: 16 },
        { type: "pointermove", x: softDropMove.x, y: softDropMove.y, waitMs: 16 },
      ],
      softDropPointerId
    );
    await page.evaluate(() => window.advanceTime(280));
    await dispatchTouchSequence(
      page,
      [{ type: "pointerup", x: softDropMove.x, y: softDropMove.y, waitMs: 20 }],
      softDropPointerId
    );
    const afterSoftDrop = await getState();
    assert(
      afterSoftDrop.score > beforeSoftDrop.score || afterSoftDrop.activePiece.y > beforeSoftDrop.activePiece.y,
      "Downward drag should trigger soft drop"
    );

    const beforeHardDrop = await getState();
    const hardDropStart = boardPoint(geometry, 0.52, 0.16);
    const hardDropEnd = { x: hardDropStart.x, y: hardDropStart.y + geometry.cellSize * 3.2 };
    const hardDropPointerId = nextPointerId();
    await dispatchTouchSequence(
      page,
      [
        { type: "pointerdown", x: hardDropStart.x, y: hardDropStart.y, waitMs: 6 },
        { type: "pointermove", x: hardDropEnd.x, y: hardDropEnd.y, waitMs: 6 },
        { type: "pointerup", x: hardDropEnd.x, y: hardDropEnd.y, waitMs: 60 },
      ],
      hardDropPointerId
    );
    const afterHardDrop = await getState();
    assert(afterHardDrop.score > beforeHardDrop.score, "Fast downward flick should hard drop the piece");

    await page.locator("#pause-btn").click();
    const pausedState = await getState();
    assert(pausedState.mode === "paused", "Pause button should pause the game");
    const pausedRotation = pausedState.activePiece.rotation;
    await dispatchTouchSequence(
      page,
      [
        { type: "pointerdown", x: tapPoint.x, y: tapPoint.y, waitMs: 10 },
        { type: "pointerup", x: tapPoint.x, y: tapPoint.y, waitMs: 0 },
      ],
      nextPointerId()
    );
    await page.waitForTimeout(240);
    const pausedAfterTap = await getState();
    assert(pausedAfterTap.activePiece.rotation === pausedRotation, "Board gestures should be disabled while paused");
    await page.locator("#resume-btn").click();

    const beforeSettings = await getState();
    await page.locator("#settings-btn").click();
    await page.waitForTimeout(40);
    await dispatchTouchSequence(
      page,
      [
        { type: "pointerdown", x: tapPoint.x, y: tapPoint.y, waitMs: 10 },
        { type: "pointerup", x: tapPoint.x, y: tapPoint.y, waitMs: 0 },
      ],
      nextPointerId()
    );
    await page.waitForTimeout(240);
    const duringSettings = await getState();
    assert(
      duringSettings.activePiece.rotation === beforeSettings.activePiece.rotation,
      "Board gestures should be disabled while the settings panel is open"
    );
    await page.locator("#close-settings-btn").click();

    await page.screenshot({ path: path.join(screenshotDir, "mobile-gesture.png"), fullPage: false });
    fs.writeFileSync(path.join(screenshotDir, "mobile-state.json"), JSON.stringify(await getState(), null, 2));

    if (consoleErrors.length > 0) {
      throw new Error(`Mobile Playwright loop produced console errors:\n${consoleErrors.join("\n")}`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

async function tryRunPlaywrightLoop(baseUrl) {
  let playwright;
  try {
    await import("./playwright-bootstrap.mjs");
    playwright = await import("playwright");
  } catch {
    console.log("Skipping Playwright browser loops because the playwright package is not installed.");
    return;
  }

  fs.mkdirSync(screenshotDir, { recursive: true });
  await runDesktopSkillClient(baseUrl);
  await runMobileGestureLoop(baseUrl, playwright);
}

buildProject({ outDir: testDistDir });
runEngineSmokeTests();
const server = await startStaticServer({ rootDir: testDistDir, port: 0 });
try {
  const baseUrl = getServerUrl(server);
  await tryRunPlaywrightLoop(baseUrl);
  console.log("Game smoke tests passed.");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
