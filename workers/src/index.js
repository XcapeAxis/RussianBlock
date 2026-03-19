const ROOM_MODE_IDS = ["sprint", "ultra"];
const ROOM_CAPACITY = 2;
const ROOM_EXPIRY_MS = 6 * 60 * 60 * 1000;

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      ...(init.headers ?? {}),
    },
  });
}

function randomCode(prefix = "") {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function randomRoomCode() {
  return String(100000 + Math.floor(Math.random() * 900000));
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeRoomMode(modeId) {
  return ROOM_MODE_IDS.includes(modeId) ? modeId : ROOM_MODE_IDS[0];
}

function normalizeNickname(value, fallback = "玩家") {
  const nickname = String(value ?? "").trim().slice(0, 24);
  return nickname || fallback;
}

function normalizeReplaySummary(replay) {
  return {
    replayId: replay.replayId,
    mode: replay.mode,
    seed: replay.seed,
    durationMs: replay.durationMs,
    result: replay.result ?? {},
  };
}

async function readJson(request) {
  return request.json().catch(() => ({}));
}

function toTimestamp(value) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function buildRoomSeed(code, roundNumber) {
  return `room-${code}-${roundNumber}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRoomResult(result = {}, modeId = "sprint") {
  return {
    score: Number(result.score) || 0,
    lines: Number(result.lines) || 0,
    durationMs: Number(result.durationMs) || 0,
    completed:
      result.completed === true ||
      result.mode === "completed" ||
      result.resultReason === "target-lines" ||
      (sanitizeRoomMode(modeId) === "sprint" && Number(result.lines) >= 40),
  };
}

function compareRoomResults(modeId, leftResult, rightResult) {
  const mode = sanitizeRoomMode(modeId);
  const left = normalizeRoomResult(leftResult, mode);
  const right = normalizeRoomResult(rightResult, mode);

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

function decideRoomWinner(modeId, results) {
  if (!Array.isArray(results) || results.length < 2) {
    return {
      winnerSlot: null,
      ordered: results ?? [],
      outcome: "pending",
    };
  }

  const ordered = [...results].sort((left, right) => {
    const comparison = compareRoomResults(modeId, left, right);
    if (comparison !== 0) {
      return comparison;
    }
    return Number(left.slot) - Number(right.slot);
  });
  const comparison = compareRoomResults(modeId, ordered[0], ordered[1]);
  return {
    winnerSlot: comparison === 0 ? null : Number(ordered[0].slot),
    ordered,
    outcome: comparison === 0 ? "draw" : "win",
  };
}

async function getReplay(env, code) {
  return env.DB.prepare("SELECT code, replay_json, summary_json FROM replays WHERE code = ?")
    .bind(code)
    .first();
}

async function getRoomRow(env, code) {
  return env.DB.prepare(
    "SELECT code, created_at, updated_at, mode, seed, is_public, status, current_round, host_token, started_at, finished_at FROM rooms WHERE code = ?"
  )
    .bind(code)
    .first();
}

async function getRoomPlayers(env, code) {
  const response = await env.DB.prepare(
    "SELECT player_token, slot_index, nickname, is_ready, joined_at, updated_at FROM room_players WHERE room_code = ? ORDER BY slot_index ASC"
  )
    .bind(code)
    .all();
  return response.results ?? [];
}

async function getRoomResults(env, code, roundNumber) {
  const response = await env.DB.prepare(
    "SELECT slot_index, nickname, replay_code, score, lines, duration_ms, summary_json, submitted_at FROM room_results WHERE room_code = ? AND round_number = ? ORDER BY slot_index ASC"
  )
    .bind(code, roundNumber)
    .all();
  return (response.results ?? []).map((row) => ({
    slot: Number(row.slot_index),
    nickname: row.nickname,
    replayCode: row.replay_code,
    score: Number(row.score) || 0,
    lines: Number(row.lines) || 0,
    durationMs: Number(row.duration_ms) || 0,
    summary: JSON.parse(row.summary_json),
    submittedAt: row.submitted_at,
  }));
}

async function saveRoomState(env, room, fields = {}) {
  const nextRoom = {
    ...room,
    ...fields,
    updated_at: fields.updated_at ?? nowIso(),
  };

  await env.DB.prepare(
    "UPDATE rooms SET updated_at = ?, seed = ?, status = ?, current_round = ?, host_token = ?, started_at = ?, finished_at = ? WHERE code = ?"
  )
    .bind(
      nextRoom.updated_at,
      nextRoom.seed,
      nextRoom.status,
      nextRoom.current_round,
      nextRoom.host_token,
      nextRoom.started_at ?? null,
      nextRoom.finished_at ?? null,
      nextRoom.code
    )
    .run();

  return nextRoom;
}

function isRoomExpired(room) {
  if (!room) {
    return true;
  }
  return Date.now() - toTimestamp(room.updated_at) > ROOM_EXPIRY_MS;
}

async function syncRoomStatus(env, room, players, results = []) {
  if (!room) {
    return null;
  }

  let nextStatus = room.status;
  if (isRoomExpired(room)) {
    nextStatus = "expired";
  } else if (room.status === "playing" && results.length >= ROOM_CAPACITY) {
    nextStatus = "finished";
  } else if (!["playing", "finished"].includes(room.status)) {
    if (players.length < ROOM_CAPACITY) {
      nextStatus = "waiting";
    } else if (players.every((player) => Number(player.is_ready) === 1)) {
      nextStatus = "ready";
    } else {
      nextStatus = "waiting";
    }
  }

  if (nextStatus !== room.status) {
    return saveRoomState(env, room, {
      status: nextStatus,
      finished_at: nextStatus === "finished" ? room.finished_at ?? nowIso() : room.finished_at,
    });
  }

  return room;
}

function serializeRoom(room, players, results, appBaseUrl, viewerToken = null) {
  const winner = decideRoomWinner(room.mode, results);
  const viewer = viewerToken ? players.find((player) => player.player_token === viewerToken) ?? null : null;
  const hostPlayer = players.find((player) => player.player_token === room.host_token) ?? null;

  return {
    code: room.code,
    mode: sanitizeRoomMode(room.mode),
    seed: room.seed,
    status: room.status,
    isPublic: Boolean(room.is_public),
    createdAt: room.created_at,
    updatedAt: room.updated_at,
    roundNumber: Number(room.current_round) || 1,
    startedAt: room.started_at ?? null,
    finishedAt: room.finished_at ?? null,
    inviteUrl: `${appBaseUrl}?play=room&code=${encodeURIComponent(room.code)}`,
    openSlots: Math.max(0, ROOM_CAPACITY - players.length),
    players: players.map((player) => ({
      slot: Number(player.slot_index),
      nickname: player.nickname,
      ready: Number(player.is_ready) === 1,
      isHost: player.player_token === room.host_token,
    })),
    viewer: viewer
      ? {
          slot: Number(viewer.slot_index),
          nickname: viewer.nickname,
          ready: Number(viewer.is_ready) === 1,
          isHost: viewer.player_token === room.host_token,
          playerToken: viewer.player_token,
        }
      : null,
    hostSlot: hostPlayer ? Number(hostPlayer.slot_index) : null,
    expired: room.status === "expired",
    results,
    winnerSlot: winner.winnerSlot,
    outcome: winner.outcome,
  };
}

async function getSerializedRoom(env, appBaseUrl, code, viewerToken = null) {
  let room = await getRoomRow(env, code);
  if (!room) {
    return null;
  }
  const players = await getRoomPlayers(env, code);
  const results = await getRoomResults(env, code, room.current_round);
  room = await syncRoomStatus(env, room, players, results);
  return serializeRoom(room, players, results, appBaseUrl, viewerToken);
}

async function generateUniqueRoomCode(env) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = randomRoomCode();
    const existing = await getRoomRow(env, code);
    if (!existing) {
      return code;
    }
  }
  throw new Error("无法生成可用的房间码。");
}

async function handleCreateReplay(request, env, appBaseUrl) {
  const payload = await readJson(request);
  const replay = payload.replay;
  if (!replay || typeof replay !== "object") {
    return json({ error: "缺少回放数据。" }, { status: 400 });
  }

  const code = randomCode("R");
  const createdAt = nowIso();
  const summary = normalizeReplaySummary(replay);
  await env.DB.prepare(
    "INSERT INTO replays (code, created_at, mode, seed, theme_id, summary_json, replay_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      code,
      createdAt,
      String(replay.mode ?? "marathon"),
      String(replay.seed ?? ""),
      String(replay.themeId ?? "classic"),
      JSON.stringify(summary),
      JSON.stringify(replay)
    )
    .run();

  return json({
    code,
    url: `${appBaseUrl}?watch=replay&code=${code}`,
    summary,
  });
}

async function handleGetReplay(env, code) {
  const replayRow = await getReplay(env, code);
  if (!replayRow) {
    return json({ error: "未找到该回放。" }, { status: 404 });
  }
  return json({
    code,
    replay: JSON.parse(replayRow.replay_json),
    summary: JSON.parse(replayRow.summary_json),
  });
}

async function handleCreateChallenge(request, env, appBaseUrl) {
  const payload = await readJson(request);
  const code = randomCode("C");
  const createdAt = nowIso();
  const challenge = {
    kind: String(payload.kind ?? "score_chase"),
    mode: String(payload.mode ?? "seed_challenge"),
    seed: String(payload.seed ?? ""),
    title: String(payload.title ?? "分享挑战"),
    goal: payload.goal ?? {},
    replayCode: payload.replayCode ? String(payload.replayCode) : null,
    expiresAt: payload.expiresAt ? String(payload.expiresAt) : null,
  };

  await env.DB.prepare(
    "INSERT INTO challenges (code, created_at, kind, mode, seed, title, goal_json, replay_code, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      code,
      createdAt,
      challenge.kind,
      challenge.mode,
      challenge.seed,
      challenge.title,
      JSON.stringify(challenge.goal),
      challenge.replayCode,
      challenge.expiresAt
    )
    .run();

  return json({
    code,
    url: `${appBaseUrl}?play=challenge&code=${code}`,
    challenge,
  });
}

async function handleGetChallenge(env, code) {
  const row = await env.DB.prepare(
    "SELECT code, kind, mode, seed, title, goal_json, replay_code, expires_at FROM challenges WHERE code = ?"
  )
    .bind(code)
    .first();
  if (!row) {
    return json({ error: "未找到该挑战。" }, { status: 404 });
  }

  return json({
    code,
    kind: row.kind,
    mode: row.mode,
    seed: row.seed,
    title: row.title,
    goal: JSON.parse(row.goal_json),
    replayCode: row.replay_code,
    expiresAt: row.expires_at,
  });
}

async function handleSubmitChallenge(request, env, code) {
  const payload = await readJson(request);
  await env.DB.prepare(
    "INSERT INTO submissions (created_at, challenge_code, replay_code, nickname, score, lines, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      nowIso(),
      code,
      payload.replayCode ? String(payload.replayCode) : null,
      payload.nickname ? String(payload.nickname) : null,
      Number(payload.score) || 0,
      Number(payload.lines) || 0,
      Number(payload.durationMs) || 0
    )
    .run();

  return json({ ok: true, challengeCode: code });
}

async function handleGetDaily(env, date) {
  let row = await env.DB.prepare(
    "SELECT challenge_date, mode, seed, config_json FROM daily_challenges WHERE challenge_date = ?"
  )
    .bind(date)
    .first();

  if (!row) {
    const config = {
      mode: "seed_challenge",
      seed: `daily-${date}`,
      title: `今日挑战 ${date}`,
      goal: {
        score: 2500,
        lines: 18,
        durationMs: 120000,
      },
    };
    await env.DB.prepare(
      "INSERT INTO daily_challenges (challenge_date, created_at, mode, seed, config_json) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(date, nowIso(), config.mode, config.seed, JSON.stringify(config))
      .run();

    row = {
      challenge_date: date,
      mode: config.mode,
      seed: config.seed,
      config_json: JSON.stringify(config),
    };
  }

  return json({
    date: row.challenge_date,
    mode: row.mode,
    seed: row.seed,
    challenge: JSON.parse(row.config_json),
  });
}

async function handleSubmitDaily(request, env, date) {
  const payload = await readJson(request);
  await env.DB.prepare(
    "INSERT INTO submissions (created_at, challenge_code, replay_code, nickname, score, lines, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      nowIso(),
      `daily:${date}`,
      payload.replayCode ? String(payload.replayCode) : null,
      payload.nickname ? String(payload.nickname) : null,
      Number(payload.score) || 0,
      Number(payload.lines) || 0,
      Number(payload.durationMs) || 0
    )
    .run();

  return json({ ok: true, date });
}

async function handleGetLeaderboard(env, board, current = {}) {
  const rows = await env.DB.prepare(
    "SELECT nickname, score, lines, duration_ms, replay_code, created_at FROM submissions WHERE challenge_code = ? ORDER BY score DESC, duration_ms ASC LIMIT 20"
  )
    .bind(board)
    .all();
  const totalRow = await env.DB.prepare("SELECT COUNT(*) AS total FROM submissions WHERE challenge_code = ?")
    .bind(board)
    .first();

  let currentRank = null;
  const hasCurrentSubmission =
    ((current.replayCode !== null && current.replayCode !== undefined && current.replayCode !== "") ||
      (current.score !== null && current.score !== undefined));
  let rankScore = Number(current.score) || 0;
  let rankDurationMs = Number(current.durationMs) || 0;
  let rankReplayCode = current.replayCode ? String(current.replayCode) : null;

  if (rankReplayCode) {
    const storedRow = await env.DB.prepare(
      "SELECT replay_code, score, duration_ms FROM submissions WHERE challenge_code = ? AND replay_code = ? ORDER BY id DESC LIMIT 1"
    )
      .bind(board, rankReplayCode)
      .first();
    if (storedRow) {
      rankScore = Number(storedRow.score) || 0;
      rankDurationMs = Number(storedRow.duration_ms) || 0;
      rankReplayCode = storedRow.replay_code;
    }
  }

  if (hasCurrentSubmission) {
    const betterRow = await env.DB.prepare(
      "SELECT COUNT(*) AS better_count FROM submissions WHERE challenge_code = ? AND (score > ? OR (score = ? AND duration_ms < ?))"
    )
      .bind(board, rankScore, rankScore, rankDurationMs)
      .first();
    const rank = Number(betterRow?.better_count) + 1;
    if (Number.isFinite(rank)) {
      currentRank = {
        rank,
        replayCode: rankReplayCode,
        score: rankScore,
        durationMs: rankDurationMs,
        nickname: current.nickname ? String(current.nickname) : null,
      };
    }
  }

  return json({
    board,
    entries: rows.results ?? [],
    total: Number(totalRow?.total) || 0,
    currentRank,
  });
}

async function handleCreatePuzzle(request, env, appBaseUrl) {
  const payload = await readJson(request);
  const code = randomCode("P");
  await env.DB.prepare(
    "INSERT INTO puzzles (code, created_at, title, author, payload_json) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(
      code,
      nowIso(),
      String(payload.title ?? "Puzzle"),
      payload.author ? String(payload.author) : null,
      JSON.stringify(payload.payload ?? payload)
    )
    .run();

  return json({
    code,
    url: `${appBaseUrl}?play=puzzle&code=${code}`,
  });
}

async function handleGetPuzzle(env, code) {
  const row = await env.DB.prepare("SELECT code, title, author, payload_json FROM puzzles WHERE code = ?")
    .bind(code)
    .first();
  if (!row) {
    return json({ error: "未找到该残局。" }, { status: 404 });
  }
  return json({
    code: row.code,
    title: row.title,
    author: row.author,
    payload: JSON.parse(row.payload_json),
  });
}

async function handleCreateRoom(request, env, appBaseUrl) {
  const payload = await readJson(request);
  const code = await generateUniqueRoomCode(env);
  const createdAt = nowIso();
  const playerToken = randomCode("P");
  const room = {
    code,
    created_at: createdAt,
    updated_at: createdAt,
    mode: sanitizeRoomMode(payload.mode),
    seed: buildRoomSeed(code, 1),
    is_public: payload.isPublic ? 1 : 0,
    status: "waiting",
    current_round: 1,
    host_token: playerToken,
    started_at: null,
    finished_at: null,
  };

  await env.DB.prepare(
    "INSERT INTO rooms (code, created_at, updated_at, mode, seed, is_public, status, current_round, host_token, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      room.code,
      room.created_at,
      room.updated_at,
      room.mode,
      room.seed,
      room.is_public,
      room.status,
      room.current_round,
      room.host_token,
      room.started_at,
      room.finished_at
    )
    .run();

  await env.DB.prepare(
    "INSERT INTO room_players (room_code, player_token, slot_index, nickname, is_ready, joined_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(room.code, playerToken, 1, normalizeNickname(payload.nickname, "房主"), 0, createdAt, createdAt)
    .run();

  const serialized = await getSerializedRoom(env, appBaseUrl, code, playerToken);
  return json({
    room: serialized,
    playerToken,
  });
}

async function handleGetPublicRooms(env, appBaseUrl, url) {
  const filter = url.searchParams.get("filter") ?? "all";
  const filterMode = sanitizeRoomMode(url.searchParams.get("mode") ?? "");
  const response =
    filter === "all"
      ? await env.DB.prepare("SELECT code FROM rooms WHERE is_public = 1 ORDER BY updated_at DESC LIMIT 24").all()
      : await env.DB.prepare("SELECT code FROM rooms WHERE is_public = 1 AND mode = ? ORDER BY updated_at DESC LIMIT 24")
          .bind(filterMode)
          .all();

  const rooms = [];
  for (const row of response.results ?? []) {
    const room = await getSerializedRoom(env, appBaseUrl, row.code);
    if (!room) {
      continue;
    }
    if (!["waiting", "ready"].includes(room.status) || room.openSlots <= 0 || room.expired) {
      continue;
    }
    rooms.push(room);
  }

  return json({ rooms });
}

async function handleGetRoom(env, appBaseUrl, code, url) {
  const serialized = await getSerializedRoom(env, appBaseUrl, code, url.searchParams.get("playerToken"));
  if (!serialized) {
    return json({ error: "未找到该房间。" }, { status: 404 });
  }
  return json({ room: serialized });
}

async function handleJoinRoom(request, env, appBaseUrl, code) {
  const payload = await readJson(request);
  let room = await getRoomRow(env, code);
  if (!room) {
    return json({ error: "未找到该房间。" }, { status: 404 });
  }
  if (isRoomExpired(room)) {
    room = await saveRoomState(env, room, { status: "expired" });
    return json({ error: "房间已过期。" }, { status: 410 });
  }

  const players = await getRoomPlayers(env, code);
  const nickname = normalizeNickname(payload.nickname, `玩家 ${players.length + 1}`);
  const playerToken = String(payload.playerToken ?? "").trim();
  const existingPlayer = playerToken ? players.find((player) => player.player_token === playerToken) ?? null : null;

  if (existingPlayer) {
    await env.DB.prepare("UPDATE room_players SET nickname = ?, updated_at = ? WHERE player_token = ?")
      .bind(nickname, nowIso(), existingPlayer.player_token)
      .run();
    const serialized = await getSerializedRoom(env, appBaseUrl, code, existingPlayer.player_token);
    return json({
      room: serialized,
      playerToken: existingPlayer.player_token,
    });
  }

  if (players.length >= ROOM_CAPACITY || ["playing", "finished", "expired"].includes(room.status)) {
    return json({ error: "当前房间无法加入。" }, { status: 409 });
  }

  const usedSlots = new Set(players.map((player) => Number(player.slot_index)));
  const slot = usedSlots.has(1) ? 2 : 1;
  const nextPlayerToken = randomCode("P");
  const timestamp = nowIso();

  await env.DB.prepare(
    "INSERT INTO room_players (room_code, player_token, slot_index, nickname, is_ready, joined_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(code, nextPlayerToken, slot, nickname, 0, timestamp, timestamp)
    .run();

  room = await saveRoomState(env, room, {});
  const serialized = await getSerializedRoom(env, appBaseUrl, code, nextPlayerToken);
  return json({
    room: serialized,
    playerToken: nextPlayerToken,
  });
}

async function handleLeaveRoom(request, env, appBaseUrl, code) {
  const payload = await readJson(request);
  const playerToken = String(payload.playerToken ?? "").trim();
  if (!playerToken) {
    return json({ error: "缺少玩家标识。" }, { status: 400 });
  }

  const room = await getRoomRow(env, code);
  if (!room) {
    return json({ error: "未找到该房间。" }, { status: 404 });
  }
  const players = await getRoomPlayers(env, code);
  const existingPlayer = players.find((player) => player.player_token === playerToken);
  if (!existingPlayer) {
    return json({ error: "房间中未找到该玩家。" }, { status: 404 });
  }

  await env.DB.prepare("DELETE FROM room_players WHERE player_token = ?").bind(playerToken).run();
  const remainingPlayers = await getRoomPlayers(env, code);

  if (remainingPlayers.length === 0) {
    await env.DB.prepare("DELETE FROM room_results WHERE room_code = ?").bind(code).run();
    await env.DB.prepare("DELETE FROM rooms WHERE code = ?").bind(code).run();
    return json({ ok: true, deleted: true });
  }

  const nextHost = room.host_token === playerToken ? remainingPlayers[0].player_token : room.host_token;
  await env.DB.prepare("UPDATE room_players SET is_ready = 0, updated_at = ? WHERE room_code = ?")
    .bind(nowIso(), code)
    .run();
  await saveRoomState(env, room, {
    host_token: nextHost,
    status: room.status === "playing" ? "finished" : "waiting",
    finished_at: room.status === "playing" ? nowIso() : room.finished_at,
  });

  const serialized = await getSerializedRoom(env, appBaseUrl, code, nextHost);
  return json({
    ok: true,
    room: serialized,
  });
}

async function handleRoomStart(request, env, appBaseUrl, code) {
  const payload = await readJson(request);
  const playerToken = String(payload.playerToken ?? "").trim();
  if (!playerToken) {
    return json({ error: "缺少玩家标识。" }, { status: 400 });
  }

  let room = await getRoomRow(env, code);
  if (!room) {
    return json({ error: "未找到该房间。" }, { status: 404 });
  }
  const players = await getRoomPlayers(env, code);
  const player = players.find((entry) => entry.player_token === playerToken);
  if (!player) {
    return json({ error: "房间中未找到该玩家。" }, { status: 404 });
  }

  const action = String(payload.action ?? "start");
  if (action === "ready") {
    const nextReady = payload.ready !== false;
    await env.DB.prepare("UPDATE room_players SET is_ready = ?, updated_at = ? WHERE player_token = ?")
      .bind(nextReady ? 1 : 0, nowIso(), playerToken)
      .run();
    room = await saveRoomState(env, room, {});
    const serialized = await getSerializedRoom(env, appBaseUrl, code, playerToken);
    return json({ room: serialized });
  }

  if (playerToken !== room.host_token) {
    return json({ error: "只有房主可以开始房间。" }, { status: 403 });
  }
  if (players.length < ROOM_CAPACITY) {
    return json({ error: "开始前需要两名玩家。" }, { status: 409 });
  }
  if (!players.every((entry) => Number(entry.is_ready) === 1)) {
    return json({ error: "两名玩家都需要先准备。" }, { status: 409 });
  }

  await saveRoomState(env, room, {
    status: "playing",
    started_at: nowIso(),
    finished_at: null,
  });
  const serialized = await getSerializedRoom(env, appBaseUrl, code, playerToken);
  return json({ room: serialized });
}

async function handleRoomSubmit(request, env, appBaseUrl, code) {
  const payload = await readJson(request);
  const playerToken = String(payload.playerToken ?? "").trim();
  if (!playerToken) {
    return json({ error: "缺少玩家标识。" }, { status: 400 });
  }

  let room = await getRoomRow(env, code);
  if (!room) {
    return json({ error: "未找到该房间。" }, { status: 404 });
  }

  const players = await getRoomPlayers(env, code);
  const player = players.find((entry) => entry.player_token === playerToken);
  if (!player) {
    return json({ error: "房间中未找到该玩家。" }, { status: 404 });
  }

  const summary = payload.summary ?? {
    score: payload.score,
    lines: payload.lines,
    durationMs: payload.durationMs,
  };
  const normalizedSummary = normalizeRoomResult(summary, room.mode);
  const timestamp = nowIso();

  await env.DB.prepare(
    "INSERT OR REPLACE INTO room_results (room_code, round_number, slot_index, nickname, replay_code, score, lines, duration_ms, summary_json, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      code,
      room.current_round,
      Number(player.slot_index),
      normalizeNickname(payload.nickname ?? player.nickname, player.nickname),
      payload.replayCode ? String(payload.replayCode) : null,
      normalizedSummary.score,
      normalizedSummary.lines,
      normalizedSummary.durationMs,
      JSON.stringify(normalizedSummary),
      timestamp
    )
    .run();

  const results = await getRoomResults(env, code, room.current_round);
  if (results.length >= ROOM_CAPACITY) {
    room = await saveRoomState(env, room, {
      status: "finished",
      finished_at: timestamp,
    });
  } else {
    room = await saveRoomState(env, room, {});
  }

  const serialized = await getSerializedRoom(env, appBaseUrl, code, playerToken);
  return json({
    room: serialized,
  });
}

async function handleRoomRematch(request, env, appBaseUrl, code) {
  const payload = await readJson(request);
  const playerToken = String(payload.playerToken ?? "").trim();
  if (!playerToken) {
    return json({ error: "缺少玩家标识。" }, { status: 400 });
  }

  let room = await getRoomRow(env, code);
  if (!room) {
    return json({ error: "未找到该房间。" }, { status: 404 });
  }

  const players = await getRoomPlayers(env, code);
  if (!players.some((player) => player.player_token === playerToken)) {
    return json({ error: "房间中未找到该玩家。" }, { status: 404 });
  }

  const nextRound = Number(room.current_round) + 1;
  await env.DB.prepare("UPDATE room_players SET is_ready = 0, updated_at = ? WHERE room_code = ?")
    .bind(nowIso(), code)
    .run();
  room = await saveRoomState(env, room, {
    current_round: nextRound,
    seed: buildRoomSeed(code, nextRound),
    status: "waiting",
    started_at: null,
    finished_at: null,
  });

  const serialized = await getSerializedRoom(env, appBaseUrl, code, playerToken);
  return json({
    room: serialized,
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return json({ ok: true });
    }

    const url = new URL(request.url);
    const appBaseUrl = String(env.APP_BASE_URL ?? "https://xcapeaxis.github.io/RussianBlock/");
    const segments = url.pathname.split("/").filter(Boolean);

    if (segments[0] !== "api") {
      return json({ error: "未找到接口。" }, { status: 404 });
    }

    if (request.method === "POST" && segments[1] === "replays" && segments.length === 2) {
      return handleCreateReplay(request, env, appBaseUrl);
    }
    if (request.method === "GET" && segments[1] === "replays" && segments[2]) {
      return handleGetReplay(env, segments[2]);
    }
    if (request.method === "POST" && segments[1] === "challenges" && segments.length === 2) {
      return handleCreateChallenge(request, env, appBaseUrl);
    }
    if (request.method === "GET" && segments[1] === "challenges" && segments[2] && segments.length === 3) {
      return handleGetChallenge(env, segments[2]);
    }
    if (request.method === "POST" && segments[1] === "challenges" && segments[2] && segments[3] === "submissions") {
      return handleSubmitChallenge(request, env, segments[2]);
    }
    if (request.method === "GET" && segments[1] === "daily" && segments[2] && segments.length === 3) {
      return handleGetDaily(env, segments[2]);
    }
    if (request.method === "POST" && segments[1] === "daily" && segments[2] && segments[3] === "submissions") {
      return handleSubmitDaily(request, env, segments[2]);
    }
    if (request.method === "GET" && segments[1] === "leaderboards" && segments[2]) {
      return handleGetLeaderboard(env, segments[2], {
        replayCode: url.searchParams.get("replayCode"),
        score: url.searchParams.get("score"),
        durationMs: url.searchParams.get("durationMs"),
        nickname: url.searchParams.get("nickname"),
      });
    }
    if (request.method === "POST" && segments[1] === "puzzles" && segments.length === 2) {
      return handleCreatePuzzle(request, env, appBaseUrl);
    }
    if (request.method === "GET" && segments[1] === "puzzles" && segments[2]) {
      return handleGetPuzzle(env, segments[2]);
    }
    if (request.method === "POST" && segments[1] === "rooms" && segments.length === 2) {
      return handleCreateRoom(request, env, appBaseUrl);
    }
    if (request.method === "GET" && segments[1] === "rooms" && segments[2] === "public") {
      return handleGetPublicRooms(env, appBaseUrl, url);
    }
    if (request.method === "GET" && segments[1] === "rooms" && segments[2] && segments.length === 3) {
      return handleGetRoom(env, appBaseUrl, segments[2], url);
    }
    if (request.method === "POST" && segments[1] === "rooms" && segments[2] && segments[3] === "join") {
      return handleJoinRoom(request, env, appBaseUrl, segments[2]);
    }
    if (request.method === "POST" && segments[1] === "rooms" && segments[2] && segments[3] === "leave") {
      return handleLeaveRoom(request, env, appBaseUrl, segments[2]);
    }
    if (request.method === "POST" && segments[1] === "rooms" && segments[2] && segments[3] === "start") {
      return handleRoomStart(request, env, appBaseUrl, segments[2]);
    }
    if (request.method === "POST" && segments[1] === "rooms" && segments[2] && segments[3] === "submit") {
      return handleRoomSubmit(request, env, appBaseUrl, segments[2]);
    }
    if (request.method === "POST" && segments[1] === "rooms" && segments[2] && segments[3] === "rematch") {
      return handleRoomRematch(request, env, appBaseUrl, segments[2]);
    }

    return json({ error: "未找到接口。" }, { status: 404 });
  },
};
