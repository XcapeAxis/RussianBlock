import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { buildProject } from "./build.mjs";
import { startStaticServer } from "./static-server.mjs";
import { TetrisEngine } from "../src/game/engine.js";
import { getPieceCells } from "../src/game/pieces.js";
import { evaluateRoomWinner } from "../src/game/room-utils.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDir = path.join(rootDir, "output", "web-game");
const testDistDir = path.join(rootDir, "output", ".tmp-test-dist");
const UNSAFE_BROWSER_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 77, 79, 87, 95, 101, 102, 103, 104, 109,
  110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530,
  531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060,
  5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

async function startMockApiServer(appBaseUrl) {
  const state = {
    replayUploads: [],
    replayMap: {},
    challengeCreates: [],
    challengeSubmissions: [],
    dailySubmissions: [],
    rooms: {},
    roomSequence: 0,
  };

  const buildRoomSeed = (code, roundNumber) => `room-${code}-${roundNumber}`;
  const nextRoomCode = () => String(420000 + state.roomSequence++).padStart(6, "0");
  const nextPlayerToken = (slot) => `P${state.roomSequence}-${slot}`;
  const syncRoomStatus = (room) => {
    if (!room) {
      return room;
    }
    if (room.status === "playing" && Object.keys(room.results ?? {}).length >= 2) {
      room.status = "finished";
      return room;
    }
    if (room.status === "playing") {
      return room;
    }
    if (room.status === "finished") {
      return room;
    }
    if (room.players.length < 2) {
      room.status = "waiting";
      return room;
    }
    room.status = room.players.every((player) => player.ready) ? "ready" : "waiting";
    return room;
  };
  const serializeRoom = (room, viewerToken = "") => {
    if (!room) {
      return null;
    }
    syncRoomStatus(room);
    const results = Object.values(room.results ?? {}).map((entry) => ({
      slot: entry.slot,
      nickname: entry.nickname,
      replayCode: entry.replayCode ?? null,
      score: entry.score ?? 0,
      lines: entry.lines ?? 0,
      durationMs: entry.durationMs ?? 0,
    }));
    const winner = evaluateRoomWinner(room.mode, results);
    const viewer = room.players.find((player) => player.playerToken === viewerToken) ?? null;
    return {
      code: room.code,
      mode: room.mode,
      seed: room.seed,
      status: room.status,
      isPublic: room.isPublic,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      roundNumber: room.roundNumber,
      startedAt: room.startedAt ?? null,
      finishedAt: room.finishedAt ?? null,
      inviteUrl: `${appBaseUrl}?play=room&code=${room.code}`,
      openSlots: Math.max(0, 2 - room.players.length),
      players: room.players.map((player) => ({
        slot: player.slot,
        nickname: player.nickname,
        ready: player.ready,
        isHost: player.playerToken === room.hostToken,
      })),
      viewer: viewer
        ? {
            slot: viewer.slot,
            nickname: viewer.nickname,
            ready: viewer.ready,
            isHost: viewer.playerToken === room.hostToken,
            playerToken: viewer.playerToken,
          }
        : null,
      results,
      winnerSlot: winner?.winnerSlot ?? null,
      outcome: winner?.outcome ?? (results.length >= 2 ? "draw" : "pending"),
      expired: false,
    };
  };

  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      sendJson(response, 404, { error: "Missing URL" });
      return;
    }

    if (request.method === "OPTIONS") {
      sendJson(response, 200, { ok: true });
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");
    const segments = url.pathname.split("/").filter(Boolean);

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "replays" && segments.length === 2) {
      const body = await readRequestBody(request);
      const code = `R${state.replayUploads.length + 1}`;
      state.replayUploads.push(body.replay ?? null);
      state.replayMap[code] = body.replay ?? null;
      sendJson(response, 200, {
        code,
        url: `${appBaseUrl}?watch=replay&code=${code}`,
        summary: body.replay
          ? {
              replayId: body.replay.replayId,
              mode: body.replay.mode,
              seed: body.replay.seed,
              durationMs: body.replay.durationMs,
              result: body.replay.result ?? {},
            }
          : null,
      });
      return;
    }

    if (request.method === "GET" && segments[0] === "api" && segments[1] === "replays" && segments.length === 3) {
      const replay = state.replayMap[segments[2]];
      if (!replay) {
        sendJson(response, 404, { error: "Replay not found" });
        return;
      }
      sendJson(response, 200, {
        code: segments[2],
        replay,
        summary: replay
          ? {
              replayId: replay.replayId,
              mode: replay.mode,
              seed: replay.seed,
              durationMs: replay.durationMs,
              result: replay.result ?? {},
            }
          : null,
      });
      return;
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "challenges" && segments.length === 2) {
      const body = await readRequestBody(request);
      const code = `CGEN${state.challengeCreates.length + 1}`;
      state.challengeCreates.push({
        code,
        ...body,
      });
      sendJson(response, 200, {
        code,
        url: `${appBaseUrl}?play=challenge&code=${code}`,
        challenge: body,
      });
      return;
    }

    if (request.method === "GET" && segments[0] === "api" && segments[1] === "challenges" && segments.length === 3) {
      sendJson(response, 200, {
        code: segments[2],
        mode: "ultra",
        seed: "shared-ultra-seed",
        title: "Mock challenge",
        goal: {
          score: 1200,
          lines: 12,
          durationMs: 120000,
        },
        replayCode: "R1",
      });
      return;
    }

    if (
      request.method === "POST" &&
      segments[0] === "api" &&
      segments[1] === "challenges" &&
      segments[2] &&
      segments[3] === "submissions"
    ) {
      const body = await readRequestBody(request);
      state.challengeSubmissions.push({
        code: segments[2],
        ...body,
      });
      sendJson(response, 200, { ok: true, challengeCode: segments[2] });
      return;
    }

    if (request.method === "GET" && segments[0] === "api" && segments[1] === "daily" && segments.length === 3) {
      sendJson(response, 200, {
        date: segments[2],
        challenge: {
          mode: "ultra",
          seed: `daily-ultra-${segments[2]}`,
          title: `Daily Challenge ${segments[2]}`,
          goal: {
            score: 2000,
            lines: 10,
            durationMs: 120000,
          },
        },
      });
      return;
    }

    if (
      request.method === "POST" &&
      segments[0] === "api" &&
      segments[1] === "daily" &&
      segments[2] &&
      segments[3] === "submissions"
    ) {
      const body = await readRequestBody(request);
      state.dailySubmissions.push({
        date: segments[2],
        ...body,
      });
      sendJson(response, 200, { ok: true, date: segments[2] });
      return;
    }

    if (request.method === "GET" && segments[0] === "api" && segments[1] === "leaderboards" && segments[2]) {
      const board = decodeURIComponent(segments[2]);
      const source =
        board.startsWith("daily:") ? state.dailySubmissions : state.challengeSubmissions;
      const entries = source
        .filter((entry) => (board.startsWith("daily:") ? `daily:${entry.date}` : entry.code) === board)
        .map((entry) => ({
          nickname: entry.nickname ?? null,
          score: entry.score ?? 0,
          lines: entry.lines ?? 0,
          duration_ms: entry.durationMs ?? 0,
          replay_code: entry.replayCode ?? null,
        }))
        .sort((left, right) => (right.score - left.score) || (left.duration_ms - right.duration_ms));
      const replayCode = url.searchParams.get("replayCode");
      const currentEntry = replayCode
        ? source.find((entry) => String(entry.replayCode ?? "") === replayCode)
        : null;
      const currentRank = currentEntry
        ? {
            rank:
              entries.findIndex((entry) => String(entry.replay_code ?? "") === replayCode) + 1 ||
              entries.length + 1,
            replayCode,
            score: currentEntry.score ?? 0,
            durationMs: currentEntry.durationMs ?? 0,
            nickname: currentEntry.nickname ?? null,
          }
        : null;
      sendJson(response, 200, { board, entries, total: entries.length, currentRank });
      return;
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "rooms" && segments.length === 2) {
      const body = await readRequestBody(request);
      const code = nextRoomCode();
      const createdAt = new Date().toISOString();
      const playerToken = nextPlayerToken(1);
      state.rooms[code] = {
        code,
        mode: body.mode === "ultra" ? "ultra" : "sprint",
        seed: buildRoomSeed(code, 1),
        isPublic: body.isPublic !== false,
        status: "waiting",
        roundNumber: 1,
        createdAt,
        updatedAt: createdAt,
        startedAt: null,
        finishedAt: null,
        hostToken: playerToken,
        players: [
          {
            playerToken,
            slot: 1,
            nickname: body.nickname ?? "Host",
            ready: false,
          },
        ],
        results: {},
      };
      sendJson(response, 200, {
        room: serializeRoom(state.rooms[code], playerToken),
        playerToken,
      });
      return;
    }

    if (request.method === "GET" && segments[0] === "api" && segments[1] === "rooms" && segments[2] === "public") {
      const filter = url.searchParams.get("filter") ?? "all";
      const rooms = Object.values(state.rooms)
        .filter((room) => (filter === "all" ? true : room.mode === filter))
        .map((room) => serializeRoom(room))
        .filter((room) => room && ["waiting", "ready"].includes(room.status) && room.openSlots > 0);
      sendJson(response, 200, { rooms });
      return;
    }

    if (request.method === "GET" && segments[0] === "api" && segments[1] === "rooms" && segments.length === 3) {
      const room = state.rooms[segments[2]];
      if (!room) {
        sendJson(response, 404, { error: "Room not found" });
        return;
      }
      sendJson(response, 200, {
        room: serializeRoom(room, url.searchParams.get("playerToken") ?? ""),
      });
      return;
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "rooms" && segments[3] === "join") {
      const room = state.rooms[segments[2]];
      const body = await readRequestBody(request);
      if (!room) {
        sendJson(response, 404, { error: "Room not found" });
        return;
      }
      const existing = room.players.find((player) => player.playerToken === String(body.playerToken ?? "").trim());
      if (existing) {
        existing.nickname = body.nickname ?? existing.nickname;
        room.updatedAt = new Date().toISOString();
        sendJson(response, 200, {
          room: serializeRoom(room, existing.playerToken),
          playerToken: existing.playerToken,
        });
        return;
      }
      if (room.players.length >= 2 || ["playing", "finished", "expired"].includes(room.status)) {
        sendJson(response, 409, { error: "Room is not joinable." });
        return;
      }
      const playerToken = nextPlayerToken(room.players.length + 1);
      room.players.push({
        playerToken,
        slot: room.players.some((player) => player.slot === 1) ? 2 : 1,
        nickname: body.nickname ?? `Player ${room.players.length + 1}`,
        ready: false,
      });
      room.updatedAt = new Date().toISOString();
      syncRoomStatus(room);
      sendJson(response, 200, {
        room: serializeRoom(room, playerToken),
        playerToken,
      });
      return;
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "rooms" && segments[3] === "leave") {
      const room = state.rooms[segments[2]];
      const body = await readRequestBody(request);
      if (!room) {
        sendJson(response, 404, { error: "Room not found" });
        return;
      }
      room.players = room.players.filter((player) => player.playerToken !== String(body.playerToken ?? ""));
      room.updatedAt = new Date().toISOString();
      if (room.players.length === 0) {
        delete state.rooms[segments[2]];
        sendJson(response, 200, { ok: true, deleted: true });
        return;
      }
      if (!room.players.some((player) => player.playerToken === room.hostToken)) {
        room.hostToken = room.players[0].playerToken;
      }
      room.players.forEach((player) => {
        player.ready = false;
      });
      room.status = "waiting";
      sendJson(response, 200, { ok: true, room: serializeRoom(room, room.hostToken) });
      return;
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "rooms" && segments[3] === "start") {
      const room = state.rooms[segments[2]];
      const body = await readRequestBody(request);
      const playerToken = String(body.playerToken ?? "");
      if (!room) {
        sendJson(response, 404, { error: "Room not found" });
        return;
      }
      const player = room.players.find((entry) => entry.playerToken === playerToken);
      if (!player) {
        sendJson(response, 404, { error: "Player not found in room." });
        return;
      }
      if (String(body.action ?? "start") === "ready") {
        player.ready = body.ready !== false;
        room.updatedAt = new Date().toISOString();
        syncRoomStatus(room);
        sendJson(response, 200, { room: serializeRoom(room, playerToken) });
        return;
      }
      if (playerToken !== room.hostToken) {
        sendJson(response, 403, { error: "Only the host can start the room." });
        return;
      }
      if (room.players.length < 2 || !room.players.every((entry) => entry.ready)) {
        sendJson(response, 409, { error: "Both players must be ready." });
        return;
      }
      room.status = "playing";
      room.startedAt = new Date().toISOString();
      room.finishedAt = null;
      room.updatedAt = room.startedAt;
      sendJson(response, 200, { room: serializeRoom(room, playerToken) });
      return;
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "rooms" && segments[3] === "submit") {
      const room = state.rooms[segments[2]];
      const body = await readRequestBody(request);
      const playerToken = String(body.playerToken ?? "");
      if (!room) {
        sendJson(response, 404, { error: "Room not found" });
        return;
      }
      const player = room.players.find((entry) => entry.playerToken === playerToken);
      if (!player) {
        sendJson(response, 404, { error: "Player not found in room." });
        return;
      }
      const summary = body.summary ?? {};
      room.results[player.slot] = {
        slot: player.slot,
        nickname: body.nickname ?? player.nickname,
        replayCode: body.replayCode ?? null,
        score: summary.score ?? body.score ?? 0,
        lines: summary.lines ?? body.lines ?? 0,
        durationMs: summary.durationMs ?? body.durationMs ?? 0,
      };
      room.updatedAt = new Date().toISOString();
      if (Object.keys(room.results).length >= 2) {
        room.status = "finished";
        room.finishedAt = room.updatedAt;
      }
      sendJson(response, 200, { room: serializeRoom(room, playerToken) });
      return;
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "rooms" && segments[3] === "rematch") {
      const room = state.rooms[segments[2]];
      const body = await readRequestBody(request);
      const playerToken = String(body.playerToken ?? "");
      if (!room) {
        sendJson(response, 404, { error: "Room not found" });
        return;
      }
      if (!room.players.some((player) => player.playerToken === playerToken)) {
        sendJson(response, 404, { error: "Player not found in room." });
        return;
      }
      room.roundNumber += 1;
      room.seed = buildRoomSeed(room.code, room.roundNumber);
      room.status = "waiting";
      room.results = {};
      room.startedAt = null;
      room.finishedAt = null;
      room.updatedAt = new Date().toISOString();
      room.players.forEach((player) => {
        player.ready = false;
      });
      sendJson(response, 200, { room: serializeRoom(room, playerToken) });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    state,
    baseUrl: getServerUrl(server),
  };
}

async function startBrowserSafeServer(rootDir) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const server = await startStaticServer({ rootDir, port: 0 });
    const address = server.address();
    const port = address && typeof address !== "string" ? address.port : null;
    if (port !== null && !UNSAFE_BROWSER_PORTS.has(port)) {
      return server;
    }
    await new Promise((resolve) => server.close(resolve));
  }

  throw new Error("Unable to allocate a browser-safe test server port.");
}

async function waitForCondition(predicate, timeoutMs, description) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
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

  engine.startNewGame({ gameMode: "ultra", seed: "smoke-ultra" });
  engine.update(120000);
  assert(engine.mode === "completed", "Ultra mode should complete when the timer expires");

  engine.startNewGame({ gameMode: "sprint", seed: "smoke-sprint" });
  engine.lines = 39;
  engine.level = 4;
  engine.board[23] = [null, null, null, null, "J", "L", "O", "S", "T", "Z"];
  engine.activePiece = { type: "I", rotation: 0, x: 0, y: 22 };
  engine.hardDrop();
  assert(engine.mode === "completed", "Sprint mode should complete after reaching the target line count");

  engine.startNewGame({ gameMode: "gravity_shift", seed: "smoke-gravity" });
  engine.update(17000);
  assert(engine.serializeState().gravityShift.warning === true, "Gravity Shift should warn shortly before a flip");
  engine.update(1000);
  assert(engine.serializeState().gravityDirection === -1, "Gravity Shift should flip upward after 18 seconds");
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
        `${baseUrl}?menu=1`,
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
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Playwright desktop skill loop timed out after 90 seconds"));
    }, 90000);

    child.on("exit", (code) => {
      clearTimeout(timeout);
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
      const topBand = Math.max(156, height * 0.22);
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

function countGridColumns(template) {
  return String(template ?? "")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token && token !== "none").length;
}

function buildPieceCells(activePiece, y) {
  if (!activePiece || y === null || y === undefined) {
    return [];
  }

  return getPieceCells(activePiece.type, activePiece.rotation).map(([dx, dy]) => ({
    x: activePiece.x + dx,
    y: y + dy,
  }));
}

function buildOccupiedCellSet(board, activePiece) {
  const occupied = new Set();
  if (Array.isArray(board)) {
    board.forEach((row, rowIndex) => {
      [...String(row ?? "")].forEach((cell, colIndex) => {
        if (cell && cell !== ".") {
          occupied.add(`${colIndex},${rowIndex}`);
        }
      });
    });
  }
  for (const cell of buildPieceCells(activePiece, activePiece?.y ?? null)) {
    occupied.add(`${cell.x},${cell.y}`);
  }
  return occupied;
}

function findEmptyNeighborCell(board, occupied, ghostCells, originCell) {
  const ghostSet = new Set(ghostCells.map((cell) => `${cell.x},${cell.y}`));
  const candidates = [
    { x: originCell.x - 1, y: originCell.y },
    { x: originCell.x + 1, y: originCell.y },
    { x: originCell.x, y: originCell.y - 1 },
    { x: originCell.x, y: originCell.y + 1 },
    { x: originCell.x - 2, y: originCell.y },
    { x: originCell.x + 2, y: originCell.y },
  ];
  for (const cell of candidates) {
    if (cell.x < 0 || cell.x >= 10 || cell.y < 0 || cell.y >= 20) {
      continue;
    }
    const key = `${cell.x},${cell.y}`;
    if (ghostSet.has(key) || occupied.has(key)) {
      continue;
    }
    if (String(board?.[cell.y] ?? "")[cell.x] === ".") {
      return cell;
    }
  }
  return null;
}

function colorDistance(left, right) {
  return (
    Math.abs(left[0] - right[0]) +
    Math.abs(left[1] - right[1]) +
    Math.abs(left[2] - right[2])
  ) / 3;
}

async function sampleCanvasCell(page, layout, cell, xRatio, yRatio) {
  return page.evaluate(
    ({ layoutInfo, boardCell, pointXRatio, pointYRatio }) => {
      const canvas = document.querySelector("#game-canvas");
      if (!canvas) {
        throw new Error("Canvas was not found for ghost sampling.");
      }
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        throw new Error("Canvas 2D context was not available for ghost sampling.");
      }

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const sampleX = Math.round((layoutInfo.boardX + (boardCell.x + pointXRatio) * layoutInfo.cellSize) * scaleX);
      const sampleY = Math.round((layoutInfo.boardY + (boardCell.y + pointYRatio) * layoutInfo.cellSize) * scaleY);
      return [...context.getImageData(sampleX, sampleY, 1, 1).data];
    },
    { layoutInfo: layout, boardCell: cell, pointXRatio: xRatio, pointYRatio: yRatio }
  );
}

async function measureGhostContrast(page, state, target = "main", { includeEdge = true, aggregate = "max" } = {}) {
  const source =
    target === "ghost"
      ? {
          board: state.ghost?.board,
          activePiece: state.ghost?.activePiece,
          ghostY: state.ghost?.ghostY,
          layout: state.layout?.ghostBoard,
        }
      : {
          board: state.board,
          activePiece: state.activePiece,
          ghostY: state.ghostY,
          layout: state.layout?.board,
        };

  if (!source.layout) {
    throw new Error(`Missing ${target} board layout in render_game_to_text output.`);
  }

  const ghostCells = buildPieceCells(source.activePiece, source.ghostY).filter(
    (cell) => cell.x >= 0 && cell.x < 10 && cell.y >= 0 && cell.y < 20
  );
  if (ghostCells.length === 0) {
    throw new Error(`Missing ${target} ghost cells for regression sampling.`);
  }

  const occupied = buildOccupiedCellSet(source.board, source.activePiece);
  const contrasts = [];
  for (const cell of ghostCells) {
    const neighbor = findEmptyNeighborCell(source.board, occupied, ghostCells, cell);
    if (!neighbor) {
      continue;
    }

    const sampleJobs = [
      sampleCanvasCell(page, source.layout, cell, 0.5, 0.5),
      sampleCanvasCell(page, source.layout, neighbor, 0.5, 0.5),
    ];
    if (includeEdge) {
      sampleJobs.splice(1, 0, sampleCanvasCell(page, source.layout, cell, 0.18, 0.18));
    }
    const samples = await Promise.all(sampleJobs);
    const ghostFill = samples[0];
    const ghostEdge = includeEdge ? samples[1] : null;
    const emptyFill = samples[samples.length - 1];
    contrasts.push(
      includeEdge ? Math.max(colorDistance(ghostFill, emptyFill), colorDistance(ghostEdge, emptyFill)) : colorDistance(ghostFill, emptyFill)
    );
  }

  if (contrasts.length === 0) {
    throw new Error(`Unable to collect ${target} ghost contrast samples.`);
  }

  if (aggregate === "average") {
    return contrasts.reduce((sum, value) => sum + value, 0) / contrasts.length;
  }

  return Math.max(...contrasts);
}

async function getRect(page, selector) {
  return page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  });
}

async function getDesktopMenuMetrics(page) {
  return page.evaluate(() => {
    const countColumns = (template) =>
      String(template ?? "")
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token && token !== "none").length;
    const card = document.querySelector("#menu-overlay .overlay-card");
    const singleGrid = document.querySelector(".menu-layout-grid--single");
    const modeCarousel = document.querySelector("#mode-carousel");
    const themeCarousel = document.querySelector("#theme-carousel");
    if (!card || !singleGrid || !modeCarousel || !themeCarousel) {
      throw new Error("Desktop menu metrics could not find required nodes.");
    }

    return {
      cardWidth: card.getBoundingClientRect().width,
      singleColumns: countColumns(getComputedStyle(singleGrid).gridTemplateColumns),
      modeColumns: countColumns(getComputedStyle(modeCarousel).gridTemplateColumns),
      themeColumns: countColumns(getComputedStyle(themeCarousel).gridTemplateColumns),
      modeOverflow: modeCarousel.scrollWidth - modeCarousel.clientWidth,
      themeOverflow: themeCarousel.scrollWidth - themeCarousel.clientWidth,
    };
  });
}

async function getRoomMenuMetrics(page) {
  return page.evaluate(() => {
    const countColumns = (template) =>
      String(template ?? "")
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token && token !== "none").length;
    const roomGrid = document.querySelector(".menu-layout-grid--rooms");
    const columns = roomGrid?.querySelectorAll(".menu-layout-column") ?? [];
    const roomLobby = document.querySelector("#room-lobby");
    if (!roomGrid || columns.length < 2) {
      throw new Error("Room layout metrics could not find the desktop room grid.");
    }

    const leftRect = columns[0].getBoundingClientRect();
    const rightRect = columns[1].getBoundingClientRect();
    const lobbyRect = roomLobby?.getBoundingClientRect() ?? null;
    return {
      roomGridColumns: countColumns(getComputedStyle(roomGrid).gridTemplateColumns),
      leftX: leftRect.x,
      rightX: rightRect.x,
      roomLobbyWidth: lobbyRect?.width ?? 0,
    };
  });
}

function attachConsoleCapture(page, consoleErrors) {
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
}

async function getActiveThemeId(page) {
  return page.locator("#stage").evaluate((element) => element.dataset.themeId);
}

async function runThemeLoop(baseUrl, playwright) {
  const { chromium } = playwright;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  attachConsoleCapture(page, consoleErrors);
  const getState = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));

  try {
    await page.goto(`${baseUrl}?menu=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(120);
    const desktopMenuMetrics = await getDesktopMenuMetrics(page);
    assert(desktopMenuMetrics.cardWidth >= 980, `Desktop menu card should be wide, got ${desktopMenuMetrics.cardWidth}`);
    assert(desktopMenuMetrics.singleColumns >= 2, "Single menu layout should split into two desktop columns");
    assert(desktopMenuMetrics.modeColumns >= 2, "Mode cards should switch to a desktop grid");
    assert(desktopMenuMetrics.themeColumns >= 2, "Theme cards should switch to a desktop grid");
    assert(desktopMenuMetrics.modeOverflow <= 12, "Mode cards should not rely on desktop horizontal scrolling");
    assert(desktopMenuMetrics.themeOverflow <= 12, "Theme cards should not rely on desktop horizontal scrolling");
    await page.screenshot({ path: path.join(screenshotDir, "menu-desktop-wide.png"), fullPage: false });

    await page.goto(`${baseUrl}?autostart=1&demo=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(140);
    assert((await getActiveThemeId(page)) === "classic", "Default theme should be classic");
    let state = await getState();
    assert(state.mode === "playing", "Classic theme screenshot run should enter a playable game");
    await page.locator("#settings-btn").click();
    await page.waitForTimeout(70);
    const settingsRect = await getRect(page, "#settings-panel");
    assert(settingsRect.width >= 400, `Desktop settings panel should be wider, got ${settingsRect.width}`);
    await page.locator("#close-settings-btn").click();
    await page.waitForTimeout(50);
    await page.locator("#pause-btn").click();
    await page.waitForTimeout(50);
    const pauseRect = await getRect(page, "#pause-overlay .overlay-card");
    assert(pauseRect.width >= 740, `Pause overlay should use the wider desktop card, got ${pauseRect.width}`);
    await page.locator("#resume-btn").click();
    await page.waitForTimeout(50);
    assert(state.settings?.ghostEnabled === true, "Classic theme run should keep ghost enabled");
    assert(state.ghostY !== null, "Classic theme run should expose a landing ghost position");
    const classicGhostContrast = await measureGhostContrast(page, state, "main");
    assert(classicGhostContrast >= 16, `Classic theme ghost should remain visible, got contrast ${classicGhostContrast}`);
    await page.screenshot({ path: path.join(screenshotDir, "ghost-visible-desktop.png"), fullPage: false });
    await page.screenshot({ path: path.join(screenshotDir, "theme-classic.png"), fullPage: false });

    await page.locator("#settings-btn").click();
    await page.waitForTimeout(60);
    await page.locator("#ghost-toggle").uncheck();
    await page.waitForTimeout(90);
    state = await getState();
    assert(state.settings?.ghostEnabled === false, "Ghost toggle should disable landing ghost rendering");
    const hiddenGhostContrast = await measureGhostContrast(page, state, "main", { includeEdge: false, aggregate: "average" });
    assert(hiddenGhostContrast <= 10, `Disabled ghost should not remain visible, got contrast ${hiddenGhostContrast}`);
    await page.locator("#ghost-toggle").check();
    await page.waitForTimeout(90);
    state = await getState();
    const restoredGhostContrast = await measureGhostContrast(page, state, "main");
    assert(restoredGhostContrast >= 16, "Re-enabling ghost should restore landing ghost visibility");
    await page.locator("#close-settings-btn").click();
    await page.waitForTimeout(40);

    await page.goto(`${baseUrl}?menu=1`, { waitUntil: "networkidle" });
    await page.locator('[data-theme-card="ocean"]').click();
    await page.waitForTimeout(80);
    assert((await getActiveThemeId(page)) === "ocean", "Theme card selection should switch to ocean");

    await page.goto(`${baseUrl}?autostart=1&demo=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(140);
    assert((await getActiveThemeId(page)) === "ocean", "Selected theme should persist into gameplay");
    const oceanState = await getState();
    assert(oceanState.mode === "playing", "Ocean theme should keep the game playable");
    assert((await measureGhostContrast(page, oceanState, "main")) >= 16, "Ocean theme ghost should remain visible");
    await page.screenshot({ path: path.join(screenshotDir, "theme-ocean.png"), fullPage: false });

    const beforeSettingsTheme = await getState();
    await page.locator("#settings-btn").click();
    await page.waitForTimeout(60);
    await page.locator('[data-theme-option="gem"]').click();
    await page.waitForTimeout(120);
    const afterSettingsTheme = await getState();
    assert((await getActiveThemeId(page)) === "gem", "Settings theme switch should update the active theme");
    assert(
      afterSettingsTheme.mode === beforeSettingsTheme.mode &&
        afterSettingsTheme.score === beforeSettingsTheme.score &&
        afterSettingsTheme.lines === beforeSettingsTheme.lines,
      "Theme switching in settings should not reset the running game"
    );
    assert((await measureGhostContrast(page, afterSettingsTheme, "main")) >= 16, "Gem theme ghost should remain visible");
    await page.locator("#close-settings-btn").click();
    await page.waitForTimeout(40);
    await page.screenshot({ path: path.join(screenshotDir, "theme-gem.png"), fullPage: false });

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(80);
    assert((await getActiveThemeId(page)) === "gem", "Theme selection should persist after reload");

    if (consoleErrors.length > 0) {
      throw new Error(`Theme Playwright loop produced console errors:\n${consoleErrors.join("\n")}`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
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
  attachConsoleCapture(page, consoleErrors);

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
    await page.waitForFunction(
      (expectedType) => {
        const state = JSON.parse(window.render_game_to_text());
        return state.holdPiece === expectedType;
      },
      beforeHold.activePiece.type
    );
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
    const hardDropEnd = { x: hardDropStart.x, y: hardDropStart.y + geometry.cellSize * 5.9 };
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

    const beforeOffAxisDrop = await getState();
    const offAxisStart = boardPoint(geometry, 0.5, 0.16);
    const offAxisEnd = {
      x: offAxisStart.x + geometry.cellSize * 0.75,
      y: offAxisStart.y + geometry.cellSize * 5.9,
    };
    const offAxisPointerId = nextPointerId();
    await dispatchTouchSequence(
      page,
      [
        { type: "pointerdown", x: offAxisStart.x, y: offAxisStart.y, waitMs: 6 },
        { type: "pointermove", x: offAxisEnd.x, y: offAxisEnd.y, waitMs: 6 },
        { type: "pointerup", x: offAxisEnd.x, y: offAxisEnd.y, waitMs: 30 },
      ],
      offAxisPointerId
    );
    const afterOffAxisDrop = await getState();
    assert(
      afterOffAxisDrop.activePiece.type === beforeOffAxisDrop.activePiece.type,
      "A diagonal downward swipe should stay in soft drop and must not trigger hard drop"
    );
    const mobileGhostState = await getState();
    assert(mobileGhostState.ghostY !== null, "Mobile gameplay should expose a landing ghost position");
    const mobileGhostContrast = await measureGhostContrast(page, mobileGhostState, "main");
    assert(mobileGhostContrast >= 16, `Mobile gameplay should keep the landing ghost visible, got contrast ${mobileGhostContrast}`);
    await page.screenshot({ path: path.join(screenshotDir, "ghost-visible-mobile.png"), fullPage: false });

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

async function runSharingFlowLoop(baseUrl, playwright) {
  const { chromium } = playwright;
  const mockApi = await startMockApiServer(baseUrl);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    locale: "zh-CN",
    viewport: { width: 1536, height: 864 },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  attachConsoleCapture(page, consoleErrors);
  await page.addInitScript((apiBase) => {
    window.localStorage.setItem(
      "russian-block-settings",
      JSON.stringify({
        bestScore: 0,
        muted: false,
        themeId: "classic",
        lastMode: "marathon",
        lastSeed: "starter-seed",
        autoStartLastMode: false,
        ghostEnabled: true,
        devApiBase: apiBase,
        nickname: "Axis",
      })
    );
    window.__clipboardWrites = [];
    window.__openedUrls = [];
    window.__downloadClicks = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(text) {
          window.__clipboardWrites.push(String(text));
          return Promise.resolve();
        },
      },
    });
    window.open = (url) => {
      window.__openedUrls.push(String(url));
      return { closed: false };
    };
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patchedAnchorClick() {
      if (this.download) {
        window.__downloadClicks.push({
          download: String(this.download),
          href: String(this.href),
        });
      }
      return originalAnchorClick.call(this);
    };
  }, mockApi.baseUrl);

  try {
    const getState = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
    const getSpectateProgress = () => page.locator("#spectate-progress").evaluate((element) => Number(element.value));
    const setSpectateProgress = (value) =>
      page.locator("#spectate-progress").evaluate((element, nextValue) => {
        element.value = String(nextValue);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
    const expectedLocalDate = (() => {
      const current = new Date();
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, "0");
      const day = String(current.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    })();
    let state;

    await page.goto(`${baseUrl}?play=challenge&code=CDEMO1`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "playing");
    state = await getState();
    assert(state.gameMode === "ultra", "Challenge route should start the configured challenge mode");
    assert(state.seed === "shared-ultra-seed", "Challenge route should load the shared seed");
    await page.evaluate(() => window.advanceTime(120000));
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "completed");
    await waitForCondition(() => mockApi.state.challengeSubmissions.length === 1, 3000, "challenge submission");
    assert(mockApi.state.replayUploads.length === 1, "Challenge completion should upload a replay before submission");
    assert(
      mockApi.state.challengeSubmissions[0].code === "CDEMO1",
      "Challenge submission should target the active challenge code"
    );
    assert(
      mockApi.state.challengeSubmissions[0].replayCode === "R1",
      "Challenge submission should include the uploaded replay code"
    );
    assert(
      mockApi.state.challengeSubmissions[0].nickname === "Axis",
      "Challenge submission should include the stored nickname"
    );
    await expectResultText(page, /已提交/);
    const resultRect = await getRect(page, "#gameover-overlay .overlay-card");
    assert(resultRect.width >= 760, `Result overlay should use the wider desktop card, got ${resultRect.width}`);
    await page.waitForFunction(
      () => {
        const target = document.querySelector("#leaderboard-list");
        const resultGrid = document.querySelector("#result-grid");
        return Boolean(
          target &&
            resultGrid &&
            /#1/.test(target.textContent ?? "") &&
            /Axis/.test(target.textContent ?? "") &&
            /Goal (reached|missed)/.test(resultGrid.textContent ?? "") &&
            /Target/.test(resultGrid.textContent ?? "")
        );
      }
    );
    await page.screenshot({ path: path.join(screenshotDir, "sharing-challenge-result.png"), fullPage: false });
    await page.locator("#replay-full-btn").click();
    await page.waitForFunction(() => {
      const banner = document.querySelector("#replay-banner");
      const panel = document.querySelector("#watch-panel");
      const progress = document.querySelector("#spectate-progress");
      return Boolean(
        banner &&
          panel &&
          progress &&
          !banner.classList.contains("replay-banner--hidden") &&
          !panel.classList.contains("watch-panel--hidden")
      );
    });
    const localProgressBefore = await getSpectateProgress();
    await page.evaluate(() => window.advanceTime(4000));
    const localProgressAfter = await getSpectateProgress();
    assert(localProgressAfter > localProgressBefore, "Local spectate playback should advance while playing");
    await page.locator("#replay-toggle-btn").click();
    const pausedProgress = await getSpectateProgress();
    await page.evaluate(() => window.advanceTime(2000));
    const pausedProgressAfter = await getSpectateProgress();
    assert(pausedProgressAfter === pausedProgress, "Paused spectate playback should stay still");
    await page.locator('[data-spectate-speed="4"]').click();
    await page.locator("#replay-toggle-btn").click();
    const fastProgressBefore = await getSpectateProgress();
    await page.evaluate(() => window.advanceTime(1000));
    const fastProgressAfter = await getSpectateProgress();
    assert(fastProgressAfter - fastProgressBefore >= 3500, "4x spectate speed should advance faster than wall time");
    await page.locator("#replay-toggle-btn").click();
    const markerCount = await page.locator("[data-spectate-marker]").count();
    assert(markerCount >= 1, "Spectate mode should render at least one marker button");
    if (markerCount > 1) {
      await page.locator("[data-spectate-marker]").last().click();
      const markerProgress = await getSpectateProgress();
      assert(markerProgress >= fastProgressAfter, "Marker jumps should seek forward in the replay");
    }
    await setSpectateProgress(5000);
    const scrubbedProgress = await getSpectateProgress();
    assert(scrubbedProgress >= 5000, "Spectate progress scrubber should seek the replay");
    await page.locator("#exit-replay-btn").click();
    await page.waitForFunction(() => {
      const target = document.querySelector("#gameover-overlay");
      return Boolean(target && !target.classList.contains("overlay--hidden"));
    });
    await page.locator("#view-replay-page-btn").click();
    await page.waitForFunction(() => Array.isArray(window.__openedUrls) && window.__openedUrls.some((url) => /watch=replay&code=R1/.test(url)));
    assert(
      mockApi.state.replayUploads.length === 1,
      "Opening the replay page from the result screen should reuse the cached replay upload"
    );
    await page.locator("#ghost-run-btn").click();
    await page.waitForFunction(() => {
      const state = JSON.parse(window.render_game_to_text());
      return state.mode === "playing" && state.gameMode === "ghost_race" && Boolean(state.ghost);
    });
    let ghostState = await getState();
    assert(ghostState.ghost.duelMode === "ultra", "Result replay entry should start an Ultra ghost duel");
    assert(ghostState.seed === "shared-ultra-seed", "Ghost duel should reuse the replay seed");
    await page.evaluate(() => window.advanceTime(4000));
    const progressedGhostState = await getState();
    assert(progressedGhostState.ghost.elapsedMs > ghostState.ghost.elapsedMs, "Ghost duel should advance the replay ghost");
    await page.screenshot({ path: path.join(screenshotDir, "ghost-duel-local.png"), fullPage: false });
    await page.evaluate(() => window.advanceTime(120000));
    await page.waitForFunction(() => {
      const state = JSON.parse(window.render_game_to_text());
      return state.mode === "completed";
    });
    await page.waitForFunction(() => /Ghost Duel/.test(document.querySelector("#result-title")?.textContent ?? ""));
    await page.evaluate(() => {
      try {
        Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
        Object.defineProperty(navigator, "canShare", { configurable: true, value: undefined });
      } catch {
        // Ignore environments that do not allow overriding navigator methods.
      }
    });
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#share-card-btn").click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    assert(download.suggestedFilename().endsWith(".png"), "Share card export should download a PNG file");
    assert(Boolean(downloadPath), "Share card export should produce a downloadable file");

    await page.goto(`${baseUrl}?watch=replay&code=R1`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      const banner = document.querySelector("#replay-banner");
      const panel = document.querySelector("#watch-panel");
      const progress = document.querySelector("#spectate-progress");
      return Boolean(
        banner &&
          panel &&
          progress &&
          !banner.classList.contains("replay-banner--hidden") &&
          !panel.classList.contains("watch-panel--hidden")
      );
    });
    await page.waitForFunction(() => {
      const title = document.querySelector("#watch-panel-title");
      const list = document.querySelector("#watch-panel-grid");
      const clock = document.querySelector("#replay-clock");
      return Boolean(
        title &&
          list &&
          clock &&
          /R1/.test(title.textContent ?? "") &&
          /120000|02:00/.test(list.textContent ?? "") &&
          /02:00/.test(clock.textContent ?? "")
      );
    });
    const replayBannerRect = await getRect(page, "#replay-banner");
    const watchPanelRect = await getRect(page, "#watch-panel");
    assert(replayBannerRect.width >= 600, `Desktop replay banner should be wider, got ${replayBannerRect.width}`);
    assert(watchPanelRect.width >= 430, `Desktop watch panel should be wider, got ${watchPanelRect.width}`);
    await page.locator("#watch-copy-btn").click();
    await page.waitForFunction(() => Array.isArray(window.__clipboardWrites) && window.__clipboardWrites.some((value) => /watch=replay&code=R1/.test(value)));
    await page.locator("#watch-challenge-btn").click();
    await waitForCondition(() => mockApi.state.challengeCreates.length === 1, 3000, "challenge creation from watch page");
    assert(
      mockApi.state.challengeCreates[0].replayCode === "R1",
      "Creating a challenge from a watched replay should reuse the existing replay code"
    );
    assert(
      mockApi.state.replayUploads.length === 1,
      "Creating a challenge from a watched replay should not upload the same replay twice"
    );
    await page.locator("#watch-highlight-btn").click();
    await page.waitForFunction(() =>
      Array.isArray(window.__clipboardWrites) && window.__clipboardWrites.some((value) => /watch=replay&code=R1&t=/.test(value))
    );
    const highlightUrl = await page.evaluate(() =>
      Array.isArray(window.__clipboardWrites)
        ? window.__clipboardWrites.findLast((value) => /watch=replay&code=R1&t=/.test(value))
        : null
    );
    await page.locator("#watch-ghost-btn").click();
    await page.waitForURL((url) => /[?&]play=ghost&code=R1/.test(url.toString()));
    await page.waitForFunction(() => {
      const state = JSON.parse(window.render_game_to_text());
      return state.mode === "playing" && state.gameMode === "ghost_race" && state.ghost?.replayCode === "R1";
    });
    await page.screenshot({ path: path.join(screenshotDir, "ghost-duel-remote.png"), fullPage: false });
    await page.goto(`${baseUrl}?watch=replay&code=R1`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      const banner = document.querySelector("#replay-banner");
      const panel = document.querySelector("#watch-panel");
      return Boolean(
        banner &&
          panel &&
          !banner.classList.contains("replay-banner--hidden") &&
          !panel.classList.contains("watch-panel--hidden")
      );
    });
    await page.locator("#watch-share-card-btn").click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(screenshotDir, "spectate-desktop.png"), fullPage: false });
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto(highlightUrl ?? `${baseUrl}?watch=replay&code=R1&t=60000`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      const banner = document.querySelector("#replay-banner");
      const panel = document.querySelector("#watch-panel");
      return Boolean(
        banner &&
          panel &&
          !banner.classList.contains("replay-banner--hidden") &&
          !panel.classList.contains("watch-panel--hidden")
      );
    });
    await page.waitForFunction(() => {
      const state = JSON.parse(window.render_game_to_text());
      return state.spectate?.playing === false && Number(state.spectate?.currentTimeMs ?? 0) > 0;
    });
    await page.screenshot({ path: path.join(screenshotDir, "spectate-mobile.png"), fullPage: false });
    await page.goto(`${baseUrl}?watch=replay&code=R1`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      const banner = document.querySelector("#replay-banner");
      const panel = document.querySelector("#watch-panel");
      return Boolean(
        banner &&
          panel &&
          !banner.classList.contains("replay-banner--hidden") &&
          !panel.classList.contains("watch-panel--hidden")
      );
    });
    await page.locator("#watch-seed-btn").click();
    await page.waitForFunction(() => {
      const state = JSON.parse(window.render_game_to_text());
      const panel = document.querySelector("#watch-panel");
      return (
        state.mode === "playing" &&
        state.seed === "shared-ultra-seed" &&
        Boolean(panel && panel.classList.contains("watch-panel--hidden"))
      );
    });
    await page.setViewportSize({ width: 1536, height: 864 });

    const guestContext = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1180, height: 860 },
    });
    const guestPage = await guestContext.newPage();
    attachConsoleCapture(guestPage, consoleErrors);
    await guestPage.addInitScript((apiBase) => {
      window.localStorage.setItem(
        "russian-block-settings",
        JSON.stringify({
          bestScore: 0,
          muted: false,
          themeId: "classic",
          lastMode: "marathon",
          lastSeed: "starter-seed",
          autoStartLastMode: false,
          ghostEnabled: true,
          devApiBase: apiBase,
          nickname: "Guest",
        })
      );
    }, mockApi.baseUrl);

    try {
      await page.goto(`${baseUrl}?menu=1&section=rooms`, { waitUntil: "networkidle" });
      const initialRoomMetrics = await getRoomMenuMetrics(page);
      assert(initialRoomMetrics.roomGridColumns >= 2, "Desktop room page should use a two-column layout");
      assert(initialRoomMetrics.rightX - initialRoomMetrics.leftX >= 280, "Room list should sit beside the create/join column on desktop");
      await page.screenshot({ path: path.join(screenshotDir, "room-menu-wide.png"), fullPage: false });
      await page.locator('[data-room-mode="ultra"]').click();
      await page.locator("#room-create-btn").click();
      await page.waitForFunction(() => {
        const state = JSON.parse(window.render_game_to_text());
        return Boolean(state.room?.code);
      });
      const roomCode = await page.evaluate(() => JSON.parse(window.render_game_to_text()).room.code);
      assert(/^\d{6}$/.test(roomCode), "Room creation should return a 6-digit numeric room code");
      await page.waitForFunction(
        (expectedCode) => (document.querySelector("#room-list")?.textContent ?? "").includes(expectedCode),
        roomCode
      );

      await guestPage.goto(`${baseUrl}?play=room&code=${roomCode}`, { waitUntil: "networkidle" });
      await guestPage.waitForFunction(
        (expectedCode) => {
          const state = JSON.parse(window.render_game_to_text());
          return state.room?.code === expectedCode;
        },
        roomCode
      );
      await page.waitForFunction(() => {
        const state = JSON.parse(window.render_game_to_text());
        return Number(state.room?.players?.length ?? 0) === 2;
      });
      const joinedRoomMetrics = await getRoomMenuMetrics(page);
      assert(joinedRoomMetrics.roomLobbyWidth >= 960, `Room lobby should span the full desktop width, got ${joinedRoomMetrics.roomLobbyWidth}`);

      await guestPage.locator("#room-ready-btn").click();
      await page.locator("#room-ready-btn").click();
      await page.locator("#room-start-btn").click();

      await page.waitForFunction(() => {
        const state = JSON.parse(window.render_game_to_text());
        return state.mode === "playing" && state.gameMode === "ultra" && state.room?.status === "playing";
      });
      await guestPage.waitForFunction(() => {
        const state = JSON.parse(window.render_game_to_text());
        return state.mode === "playing" && state.gameMode === "ultra" && state.room?.status === "playing";
      });

      const hostRoomState = await getState();
      const guestRoomState = await guestPage.evaluate(() => JSON.parse(window.render_game_to_text()));
      assert(hostRoomState.seed === guestRoomState.seed, "Room players should receive the same seed");
      assert(hostRoomState.room.code === roomCode, "Host should stay attached to the active room");

      await Promise.all([
        page.evaluate(() => window.advanceTime(120000)),
        guestPage.evaluate(() => window.advanceTime(120000)),
      ]);

      await page.waitForFunction(() => {
        const state = JSON.parse(window.render_game_to_text());
        return state.mode === "completed" && state.room?.status === "finished";
      });
      await guestPage.waitForFunction(() => {
        const state = JSON.parse(window.render_game_to_text());
        return state.mode === "completed" && state.room?.status === "finished";
      });
      await page.waitForFunction(() => /Room (Win|Loss|Draw)/.test(document.querySelector("#result-title")?.textContent ?? ""));
      await page.screenshot({ path: path.join(screenshotDir, "room-result.png"), fullPage: false });

      await page.locator("#room-back-btn").click();
      await page.waitForFunction(() => {
        const state = JSON.parse(window.render_game_to_text());
        const lobby = document.querySelector("#room-lobby");
        return (
          state.mode === "menu" &&
          state.room?.status === "finished" &&
          Boolean(lobby && !lobby.classList.contains("room-lobby--hidden"))
        );
      });
      await page.locator("#room-rematch-btn").click();
      await page.waitForFunction(() => {
        const state = JSON.parse(window.render_game_to_text());
        return state.mode === "menu" && state.room?.roundNumber === 2 && state.room?.status === "waiting";
      });
    } finally {
      await guestContext.close();
    }

    const replayUploadsBeforeDaily = mockApi.state.replayUploads.length;
    await page.goto(`${baseUrl}?menu=1&section=daily`, { waitUntil: "networkidle" });
    await page.locator("#load-daily-btn").click();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "playing");
    state = await getState();
    assert(state.gameMode === "ultra", "Daily challenge should start a playable configured mode");
    assert(state.seed === `daily-ultra-${expectedLocalDate}`, "Daily challenge should use the browser-local challenge date");
    await page.evaluate(() => window.advanceTime(120000));
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "completed");
    await waitForCondition(() => mockApi.state.dailySubmissions.length === 1, 3000, "daily submission");
    assert(
      mockApi.state.replayUploads.length === replayUploadsBeforeDaily + 1,
      "Daily completion should upload exactly one new replay"
    );
    assert(
      mockApi.state.dailySubmissions[0].replayCode === `R${replayUploadsBeforeDaily + 1}`,
      "Daily submission should include the uploaded replay code"
    );
    await page.waitForFunction(
      () => {
        const title = document.querySelector("#leaderboard-title");
        const list = document.querySelector("#leaderboard-list");
        return Boolean(
          title &&
            list &&
            /今日挑战/.test(title.textContent ?? "") &&
            /#1/.test(list.textContent ?? "") &&
            /Axis/.test(list.textContent ?? "")
        );
      }
    );

    await page.goto(`${baseUrl}?play=ghost&source=local-best&mode=ultra`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      const state = JSON.parse(window.render_game_to_text());
      return state.mode === "playing" && state.gameMode === "ghost_race" && state.ghost?.duelMode === "ultra";
    });
    state = await getState();
    assert((await measureGhostContrast(page, state, "main")) >= 16, "Ghost duel should keep the main-board landing ghost visible");
    assert(
      (await measureGhostContrast(page, state, "ghost", { includeEdge: false, aggregate: "average" })) <= 10,
      "Passive ghost board should not render a landing ghost"
    );

    await page.goto(`${baseUrl}?menu=1&section=labs`, { waitUntil: "networkidle" });
    await page.locator("#launch-gravity-shift-btn").click();
    await page.waitForFunction(() => {
      const state = JSON.parse(window.render_game_to_text());
      return state.mode === "playing" && state.gameMode === "gravity_shift";
    });
    await page.evaluate(() => window.advanceTime(17000));
    state = await getState();
    assert(state.gravityShift?.warning === true, "Gravity Shift should expose its warning state before the flip");
    await page.evaluate(() => window.advanceTime(1000));
    state = await getState();
    assert(state.gravityDirection === -1, "Gravity Shift should flip upward after the countdown");
    await page.screenshot({ path: path.join(screenshotDir, "gravity-shift.png"), fullPage: false });

    if (consoleErrors.length > 0) {
      throw new Error(`Sharing Playwright loop produced console errors:\n${consoleErrors.join("\n")}`);
    }
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => mockApi.server.close(resolve));
  }
}

async function expectResultText(page, pattern) {
  await page.waitForFunction(
    (expectedPatternSource) => {
      const target = document.querySelector("#gameover-overlay");
      return Boolean(target && new RegExp(expectedPatternSource).test(target.textContent ?? ""));
    },
    pattern.source
  );
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
  const scope = process.env.RB_TEST_SCOPE ?? "all";
  if (scope === "all" || scope === "desktop") {
    await runDesktopSkillClient(baseUrl);
  }
  if (scope === "all" || scope === "theme") {
    await runThemeLoop(baseUrl, playwright);
  }
  if (scope === "all" || scope === "mobile") {
    await runMobileGestureLoop(baseUrl, playwright);
  }
  if (scope === "all" || scope === "sharing") {
    await runSharingFlowLoop(baseUrl, playwright);
  }
}

buildProject({ outDir: testDistDir });
runEngineSmokeTests();
const server = await startBrowserSafeServer(testDistDir);
try {
  const baseUrl = getServerUrl(server);
  await tryRunPlaywrightLoop(baseUrl);
  console.log("Game smoke tests passed.");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
