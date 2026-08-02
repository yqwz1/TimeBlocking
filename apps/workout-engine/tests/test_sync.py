"""Offline tests for the Hevy API sync: CSV-vs-API parity (same rows from both
sources), deletion handling, cursor advance, and the learned exercise map.
hevy_client is mocked - no network."""
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from workout import config  # noqa: E402

HEADER = ('"title","start_time","end_time","description","exercise_title",'
          '"superset_id","exercise_notes","set_index","set_type","weight_kg",'
          '"reps","distance_km","duration_seconds","rpe"')


def _bench_csv_row(idx):
    return (f'"D","05 Jan 2025, 10:00","05 Jan 2025, 10:00","",'
            f'"Bench Press (Barbell)",,"",{idx},"normal",60,8,,,')


# A naive (offset-free) start_time so parity holds regardless of the test
# machine's timezone: it maps to the same wall-clock as the CSV "05 Jan ...".
API_WORKOUT = {
    "id": "w1", "title": "D",
    "start_time": "2025-01-05T10:00:00", "end_time": "2025-01-05T10:00:00",
    "exercises": [{
        "index": 0, "title": "Bench Press (Barbell)",
        "exercise_template_id": "uuid-bench",
        "sets": [{"index": 0, "type": "normal", "weight_kg": 60, "reps": 8},
                 {"index": 1, "type": "normal", "weight_kg": 60, "reps": 8}],
    }],
}


def _fresh_db(path):
    config.DB_PATH = path
    from workout import db
    conn = db.connect()
    db.init(conn)
    return conn


class SyncTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        config.DATA_DIR = self.tmp
        config.OUTPUT_DIR = os.path.join(self.tmp, "out")
        from workout import sync
        self.sync = sync

    def _run_backfill(self, conn, workouts=(API_WORKOUT,), measurements=()):
        with mock.patch.object(self.sync.hevy_client, "iter_workouts",
                               lambda *a, **k: list(workouts)), \
             mock.patch.object(self.sync.hevy_client, "iter_body_measurements",
                               lambda *a, **k: list(measurements)):
            return self.sync.run(conn, full=True)

    def test_api_matches_csv_rows(self):
        # Ingest the same session via CSV and via API into two DBs; the stored
        # set rows must be identical (proving the shared write path + recompute).
        from workout import ingest
        csv_conn = _fresh_db(os.path.join(self.tmp, "csv.db"))
        csv_path = os.path.join(self.tmp, "bench.csv")
        with open(csv_path, "w", encoding="utf-8") as f:
            f.write("\n".join([HEADER, _bench_csv_row(0), _bench_csv_row(1)]) + "\n")
        ingest.run(csv_conn, csv_path)

        api_conn = _fresh_db(os.path.join(self.tmp, "api.db"))
        res = self._run_backfill(api_conn)
        self.assertEqual(res["inserted"], 2)

        cols = ("start_time", "exercise_title", "set_index", "weight_raw",
                "reps_raw", "e1rm", "primary_muscle", "is_working")
        q = (f"SELECT {','.join(cols)} FROM sets "
             "ORDER BY exercise_title, set_index")
        csv_rows = [tuple(r) for r in csv_conn.execute(q)]
        api_rows = [tuple(r) for r in api_conn.execute(q)]
        self.assertEqual(csv_rows, api_rows)
        self.assertAlmostEqual(api_rows[0][5], 76.0, places=2)  # e1rm 60x8

    def test_template_id_and_map_learned(self):
        conn = _fresh_db(os.path.join(self.tmp, "map.db"))
        self._run_backfill(conn)
        tid = conn.execute(
            "SELECT exercise_template_id t FROM sets LIMIT 1").fetchone()["t"]
        self.assertEqual(tid, "uuid-bench")
        row = conn.execute(
            "SELECT exercise_template_id t FROM exercise_map "
            "WHERE exercise_title='Bench Press (Barbell)'").fetchone()
        self.assertEqual(row["t"], "uuid-bench")

    def test_cursor_advances_and_backfill_flag_set(self):
        conn = _fresh_db(os.path.join(self.tmp, "cur.db"))
        self._run_backfill(conn)
        self.assertEqual(self.sync.get_state(conn, "backfilled"), "1")
        self.assertIsNotNone(self.sync.get_state(conn, "last_events_cursor"))
        self.assertIsNotNone(self.sync.get_state(conn, "last_sync_at"))

    def test_deletion_removes_sets_and_session(self):
        conn = _fresh_db(os.path.join(self.tmp, "del.db"))
        self._run_backfill(conn)
        self.assertEqual(
            conn.execute("SELECT COUNT(*) c FROM sets").fetchone()["c"], 2)
        # Now an incremental sync delivering a delete event for that workout.
        ev = [{"type": "deleted", "id": "w1", "deleted_at": "2025-01-06T00:00:00"}]
        with mock.patch.object(self.sync.hevy_client, "iter_workout_events",
                               lambda *a, **k: list(ev)), \
             mock.patch.object(self.sync.hevy_client, "iter_body_measurements",
                               lambda *a, **k: []):
            res = self.sync.run(conn)
        self.assertEqual(res["mode"], "incremental")
        self.assertEqual(res["deleted"], 1)
        self.assertEqual(
            conn.execute("SELECT COUNT(*) c FROM sets").fetchone()["c"], 0)
        self.assertEqual(
            conn.execute("SELECT COUNT(*) c FROM sessions").fetchone()["c"], 0)

    def test_body_measurements_logged(self):
        conn = _fresh_db(os.path.join(self.tmp, "bw.db"))
        self._run_backfill(
            conn, measurements=[{"date": "2025-01-05", "weight_kg": 82.5}])
        bw = conn.execute("SELECT weight FROM bodyweight WHERE date='2025-01-05'"
                          ).fetchone()
        self.assertIsNotNone(bw)
        self.assertEqual(bw["weight"], 82.5)


class MigrationTest(unittest.TestCase):
    """An existing v2 DB upgrades to the current schema in place: the new
    column/tables appear and existing rows survive (no reingest needed)."""

    def test_v2_to_v3_in_place(self):
        import sqlite3
        from workout import db
        path = os.path.join(tempfile.mkdtemp(), "old.db")
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        conn.executescript(
            "CREATE TABLE schema_version (version INTEGER NOT NULL);"
            "INSERT INTO schema_version(version) VALUES (2);"
            "CREATE TABLE sessions (session_id INTEGER PRIMARY KEY AUTOINCREMENT,"
            " start_time TEXT NOT NULL UNIQUE, start_raw TEXT NOT NULL, title TEXT,"
            " end_time TEXT, duration_min REAL, date TEXT NOT NULL);"
            "CREATE TABLE sets (set_id INTEGER PRIMARY KEY AUTOINCREMENT,"
            " start_time TEXT NOT NULL, exercise_title TEXT NOT NULL,"
            " set_index INTEGER NOT NULL, weight_raw REAL, reps_raw INTEGER,"
            " rpe REAL, rest_seconds REAL, date TEXT,"
            " UNIQUE(start_time, exercise_title, set_index));"
            "INSERT INTO sets(start_time, exercise_title, set_index, date) "
            " VALUES ('2025-01-05T10:00:00','Bench Press (Barbell)',0,'2025-01-05');")
        conn.commit()

        db.init(conn)  # runs DDL (no-op for existing tables) + migrate()

        self.assertEqual(
            conn.execute("SELECT version FROM schema_version").fetchone()["version"],
            db.SCHEMA_VERSION)
        scol = [r["name"] for r in conn.execute("PRAGMA table_info(sets)")]
        self.assertIn("exercise_template_id", scol)
        sess = [r["name"] for r in conn.execute("PRAGMA table_info(sessions)")]
        self.assertIn("workout_id", sess)
        tabs = {r["name"] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertIn("sync_state", tabs)
        self.assertIn("exercise_map", tabs)
        self.assertEqual(
            conn.execute("SELECT COUNT(*) c FROM sets").fetchone()["c"], 1)


class ParseApiTimestampTest(unittest.TestCase):
    def test_naive_passthrough(self):
        from workout import dates
        dt = dates.parse_api("2025-01-05T10:00:00")
        self.assertIsNone(dt.tzinfo)
        self.assertEqual(dates.iso(dt), "2025-01-05T10:00:00")

    def test_offset_and_z_parse_to_naive_local(self):
        from workout import dates
        for s in ("2025-01-05T10:00:00Z", "2025-01-05T10:00:00+00:00"):
            dt = dates.parse_api(s)
            self.assertIsNone(dt.tzinfo)  # always naive local wall-clock


if __name__ == "__main__":
    unittest.main(verbosity=2)
