"""SQLite store: schema, connection, migrations."""
import sqlite3
from . import config

SCHEMA_VERSION = 4

DDL = """
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS imports (
  import_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  imported_at   TEXT NOT NULL,
  source_path   TEXT NOT NULL,
  file_sha256   TEXT NOT NULL,
  rows_seen     INTEGER DEFAULT 0,
  rows_inserted INTEGER DEFAULT 0,
  rows_updated  INTEGER DEFAULT 0,
  rows_flagged  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  start_time   TEXT NOT NULL UNIQUE,
  start_raw    TEXT NOT NULL,
  title        TEXT,
  end_time     TEXT,
  duration_min REAL,
  date         TEXT NOT NULL,
  workout_id   TEXT
);

CREATE TABLE IF NOT EXISTS sets (
  set_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       INTEGER REFERENCES sessions(session_id),
  start_time       TEXT NOT NULL,
  exercise_title   TEXT NOT NULL,
  set_index        INTEGER NOT NULL,
  set_type         TEXT,
  weight_raw       REAL,
  reps_raw         INTEGER,
  rpe              REAL,
  rest_seconds     REAL,
  exercise_template_id TEXT,
  -- derived (filled by recompute):
  primary_muscle   TEXT,
  pattern          TEXT,
  epoch            INTEGER DEFAULT 0,
  weight_norm      REAL,
  reps_clean       INTEGER,
  e1rm             REAL,
  volume           REAL,
  is_bodyweight    INTEGER DEFAULT 0,
  is_working       INTEGER DEFAULT 1,
  quality_flag     TEXT,
  source_import_id INTEGER,
  date             TEXT,
  UNIQUE(start_time, exercise_title, set_index)
);
CREATE INDEX IF NOT EXISTS idx_sets_ex_time ON sets(exercise_title, start_time);
CREATE INDEX IF NOT EXISTS idx_sets_date ON sets(date);

CREATE TABLE IF NOT EXISTS bodyweight (
  date   TEXT PRIMARY KEY,
  weight REAL NOT NULL,
  unit   TEXT DEFAULT 'kg',
  note   TEXT
);

CREATE TABLE IF NOT EXISTS goals (
  goal_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  exercise_title TEXT,
  metric         TEXT,
  target_value   REAL,
  target_reps    INTEGER,
  target_date    TEXT,
  created_at     TEXT,
  status         TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS recommendations (
  rec_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at     TEXT,
  for_week       TEXT,
  exercise_title TEXT,
  rec_type       TEXT,
  target_weight  REAL,
  target_reps    INTEGER,
  rationale      TEXT,
  outcome        TEXT,
  outcome_date   TEXT
);

CREATE TABLE IF NOT EXISTS coach_notes (
  note_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT,
  category   TEXT,
  body       TEXT,
  active     INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS exercise_models (
  exercise_title  TEXT PRIMARY KEY,
  epoch           INTEGER,
  n_fresh         INTEGER,
  slope           REAL,
  intercept       REAL,
  r2              REAL,
  resid_std       REAL,
  mean_load       REAL,
  ssx             REAL,
  individ_1rm     REAL,
  grace_state     TEXT,
  confidence      INTEGER,
  post_slope_mean REAL,
  post_slope_var  REAL,
  anchor_m          REAL,
  anchor_type       TEXT,
  anchor_n_eff      REAL,
  anchor_spread     REAL,
  individ_1rm_basis TEXT,
  updated_at      TEXT
);

CREATE TABLE IF NOT EXISTS training_blocks (
  block_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  start_date TEXT,
  end_date   TEXT,
  style      TEXT,
  note       TEXT
);

-- Hevy API sync (schema v3): cursor/meta key-value store, and the
-- title<->exercise_template_id map learned from the user's own synced history.
CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS exercise_map (
  exercise_title       TEXT PRIMARY KEY,
  exercise_template_id TEXT,
  last_seen            TEXT
);
"""


def connect():
    config.ensure_dirs()
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init(conn):
    conn.executescript(DDL)
    row = conn.execute("SELECT version FROM schema_version").fetchone()
    if row is None:
        conn.execute("INSERT INTO schema_version(version) VALUES (?)", (SCHEMA_VERSION,))
    conn.commit()
    migrate(conn)


def migrate(conn):
    """Bring a pre-existing DB up to the current schema version."""
    row = conn.execute("SELECT version FROM schema_version").fetchone()
    v = row["version"] if row else 1
    if v < 2:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(sets)")]
        if "rest_seconds" not in cols:
            conn.execute("ALTER TABLE sets ADD COLUMN rest_seconds REAL")
        conn.execute("UPDATE schema_version SET version=2")
        conn.commit()
    if v < 3:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(sets)")]
        if "exercise_template_id" not in cols:
            conn.execute("ALTER TABLE sets ADD COLUMN exercise_template_id TEXT")
        scols = [r["name"] for r in conn.execute("PRAGMA table_info(sessions)")]
        if "workout_id" not in scols:
            conn.execute("ALTER TABLE sessions ADD COLUMN workout_id TEXT")
        conn.executescript(
            "CREATE TABLE IF NOT EXISTS sync_state ("
            "  key TEXT PRIMARY KEY, value TEXT);"
            "CREATE TABLE IF NOT EXISTS exercise_map ("
            "  exercise_title TEXT PRIMARY KEY, exercise_template_id TEXT,"
            "  last_seen TEXT);")
        conn.execute("UPDATE schema_version SET version=3")
        conn.commit()
    if v < 4:
        # design 04: persist the curvilinear 1RM anchor next to the linear model.
        ecols = [r["name"] for r in conn.execute("PRAGMA table_info(exercise_models)")]
        for col, typ in (("anchor_m", "REAL"), ("anchor_type", "TEXT"),
                         ("anchor_n_eff", "REAL"), ("anchor_spread", "REAL"),
                         ("individ_1rm_basis", "TEXT")):
            if col not in ecols:
                conn.execute(f"ALTER TABLE exercise_models ADD COLUMN {col} {typ}")
        conn.execute("UPDATE schema_version SET version=4")
        conn.commit()
