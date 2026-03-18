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

async function readJson(request) {
  return request.json().catch(() => ({}));
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

async function getReplay(env, code) {
  return env.DB.prepare("SELECT code, replay_json, summary_json FROM replays WHERE code = ?")
    .bind(code)
    .first();
}

async function handleCreateReplay(request, env, appBaseUrl) {
  const payload = await readJson(request);
  const replay = payload.replay;
  if (!replay || typeof replay !== "object") {
    return json({ error: "Missing replay payload." }, { status: 400 });
  }

  const code = randomCode("R");
  const createdAt = new Date().toISOString();
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
    return json({ error: "Replay not found." }, { status: 404 });
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
  const createdAt = new Date().toISOString();
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
    return json({ error: "Challenge not found." }, { status: 404 });
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
      new Date().toISOString(),
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
    const generatedSeed = `daily-${date}`;
    const config = {
      mode: "seed_challenge",
      seed: generatedSeed,
      title: `Daily Challenge ${date}`,
      goal: {
        score: 2500,
        lines: 18,
        durationMs: 120000,
      },
    };
    await env.DB.prepare(
      "INSERT INTO daily_challenges (challenge_date, created_at, mode, seed, config_json) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(date, new Date().toISOString(), config.mode, config.seed, JSON.stringify(config))
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
      new Date().toISOString(),
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
    (
      current.replayCode !== null &&
      current.replayCode !== undefined &&
      current.replayCode !== ""
    ) ||
    (current.score !== null && current.score !== undefined);
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
      new Date().toISOString(),
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
    return json({ error: "Puzzle not found." }, { status: 404 });
  }
  return json({
    code: row.code,
    title: row.title,
    author: row.author,
    payload: JSON.parse(row.payload_json),
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
      return json({ error: "Not found." }, { status: 404 });
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
    if (
      request.method === "POST" &&
      segments[1] === "challenges" &&
      segments[2] &&
      segments[3] === "submissions"
    ) {
      return handleSubmitChallenge(request, env, segments[2]);
    }

    if (request.method === "GET" && segments[1] === "daily" && segments[2] && segments.length === 3) {
      return handleGetDaily(env, segments[2]);
    }
    if (
      request.method === "POST" &&
      segments[1] === "daily" &&
      segments[2] &&
      segments[3] === "submissions"
    ) {
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

    return json({ error: "Not found." }, { status: 404 });
  },
};
