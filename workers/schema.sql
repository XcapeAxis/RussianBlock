CREATE TABLE IF NOT EXISTS replays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  mode TEXT NOT NULL,
  seed TEXT NOT NULL,
  theme_id TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  replay_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  mode TEXT NOT NULL,
  seed TEXT NOT NULL,
  title TEXT NOT NULL,
  goal_json TEXT NOT NULL,
  replay_code TEXT,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS daily_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge_date TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  mode TEXT NOT NULL,
  seed TEXT NOT NULL,
  config_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  challenge_code TEXT NOT NULL,
  replay_code TEXT,
  nickname TEXT,
  score INTEGER NOT NULL,
  lines INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS puzzles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  mode TEXT NOT NULL,
  seed TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  current_round INTEGER NOT NULL DEFAULT 1,
  host_token TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS room_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  player_token TEXT NOT NULL UNIQUE,
  slot_index INTEGER NOT NULL,
  nickname TEXT NOT NULL,
  is_ready INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(room_code, slot_index)
);

CREATE TABLE IF NOT EXISTS room_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  slot_index INTEGER NOT NULL,
  nickname TEXT,
  replay_code TEXT,
  score INTEGER NOT NULL,
  lines INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  UNIQUE(room_code, round_number, slot_index)
);
