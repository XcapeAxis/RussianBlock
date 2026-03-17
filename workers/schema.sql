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
