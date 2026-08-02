"""Stdlib unittest suite. Run: python -m unittest discover -s tests
Plants every edge case from the plan into a tiny CSV and asserts behavior,
then runs the full pipeline against the real export as a golden smoke test.
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from workout import config  # noqa: E402

HEADER = ('"title","start_time","end_time","description","exercise_title",'
          '"superset_id","exercise_notes","set_index","set_type","weight_kg",'
          '"reps","distance_km","duration_seconds","rpe"')


def row(title, start, ex, idx, w, reps, end=None):
    end = end or start
    wv = "" if w is None else w
    return (f'"{title}","{start}","{end}","","{ex}",,"",{idx},"normal",'
            f'{wv},{reps},,,')


PLANTED = [HEADER,
           # clean bench session - e1rm check 60x8 -> 76.0
           row("D", "05 Jan 2025, 10:00", "Bench Press (Barbell)", 0, 60, 8),
           row("D", "05 Jan 2025, 10:00", "Bench Press (Barbell)", 1, 60, 8),
           # rep typo: 100x55 alongside a clean sibling 100x5
           row("D", "05 Jan 2025, 10:00", "Myt Squat", 0, 100, 5),
           row("D", "05 Jan 2025, 10:00", "Myt Squat", 1, 100, 55),
           # blank weight (bodyweight)
           row("D", "05 Jan 2025, 10:00", "Pullup", 0, None, 8),
           # unit jump: ~10 in Jan, ~100 in Apr -> 2 epochs (>=4 sets/era so the
           # tiny-epoch merge guard keeps the split)
           row("D", "05 Jan 2025, 10:00", "Unit Test", 0, 10, 8),
           row("E", "12 Jan 2025, 10:00", "Unit Test", 0, 11, 8),
           row("H", "19 Jan 2025, 10:00", "Unit Test", 0, 10, 8),
           row("I", "26 Jan 2025, 10:00", "Unit Test", 0, 12, 8),
           row("F", "06 Apr 2025, 10:00", "Unit Test", 0, 100, 8),
           row("G", "13 Apr 2025, 10:00", "Unit Test", 0, 105, 8),
           row("J", "20 Apr 2025, 10:00", "Unit Test", 0, 102, 8),
           row("K", "27 Apr 2025, 10:00", "Unit Test", 0, 108, 8)]


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        config.DATA_DIR = self.tmp
        config.OUTPUT_DIR = os.path.join(self.tmp, "out")
        config.DB_PATH = os.path.join(self.tmp, "t.db")
        self.csv = os.path.join(self.tmp, "planted.csv")
        with open(self.csv, "w", encoding="utf-8") as f:
            f.write("\n".join(PLANTED) + "\n")
        from workout import db
        self.conn = db.connect()
        db.init(self.conn)

    def test_ingest_counts_and_idempotency(self):
        from workout import ingest
        r1 = ingest.run(self.conn, self.csv)
        self.assertEqual(r1["inserted"], 13)
        n = self.conn.execute("SELECT COUNT(*) c FROM sets").fetchone()["c"]
        self.assertEqual(n, 13)
        # idempotent re-run (force past sha short-circuit)
        r2 = ingest.run(self.conn, self.csv, force=True)
        self.assertEqual(r2["inserted"], 0)
        self.assertEqual(r2["duplicate_noop"], 13)
        n2 = self.conn.execute("SELECT COUNT(*) c FROM sets").fetchone()["c"]
        self.assertEqual(n, n2)
        # no duplicate keys
        dups = self.conn.execute(
            "SELECT COUNT(*) c FROM (SELECT 1 FROM sets GROUP BY start_time,"
            "exercise_title,set_index HAVING COUNT(*)>1)").fetchone()["c"]
        self.assertEqual(dups, 0)

    def test_rep_typo_corrected(self):
        from workout import ingest
        ingest.run(self.conn, self.csv)
        r = self.conn.execute(
            "SELECT reps_raw, reps_clean, quality_flag FROM sets "
            "WHERE exercise_title='Myt Squat' AND reps_raw=55").fetchone()
        self.assertEqual(r["reps_raw"], 55)          # raw kept
        self.assertLessEqual(r["reps_clean"], 15)    # corrected to plausible
        self.assertIn("rep_typo", r["quality_flag"])

    def test_blank_weight_is_bodyweight(self):
        from workout import ingest
        ingest.run(self.conn, self.csv)
        r = self.conn.execute(
            "SELECT is_bodyweight, e1rm, quality_flag FROM sets "
            "WHERE exercise_title='Pullup'").fetchone()
        self.assertEqual(r["is_bodyweight"], 1)
        self.assertIsNone(r["e1rm"])
        self.assertIn("weight", r["quality_flag"])

    def test_unit_epochs_split(self):
        from workout import ingest
        ingest.run(self.conn, self.csv)
        ne = self.conn.execute(
            "SELECT COUNT(DISTINCT epoch) n FROM sets "
            "WHERE exercise_title='Unit Test'").fetchone()["n"]
        self.assertEqual(ne, 2)

    def test_e1rm_epley(self):
        from workout import ingest
        ingest.run(self.conn, self.csv)
        e = self.conn.execute(
            "SELECT e1rm FROM sets WHERE exercise_title='Bench Press (Barbell)' "
            "AND set_index=0").fetchone()["e1rm"]
        self.assertAlmostEqual(e, 76.0, places=2)  # 60*(1+8/30)

    def test_edited_set_updates(self):
        from workout import ingest
        ingest.run(self.conn, self.csv)
        edited = PLANTED[:]
        edited[1] = row("D", "05 Jan 2025, 10:00", "Bench Press (Barbell)", 0, 65, 8)
        p2 = os.path.join(self.tmp, "edited.csv")
        with open(p2, "w", encoding="utf-8") as f:
            f.write("\n".join(edited) + "\n")
        r = ingest.run(self.conn, p2)
        self.assertEqual(r["updated"], 1)
        w = self.conn.execute(
            "SELECT weight_raw FROM sets WHERE exercise_title='Bench Press (Barbell)'"
            " AND set_index=0").fetchone()["weight_raw"]
        self.assertEqual(w, 65)


class GoldenSmokeTest(unittest.TestCase):
    REAL = r"C:\Users\wahib\Downloads\08 - Archives\workout_data.csv"

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        config.DATA_DIR = self.tmp
        config.OUTPUT_DIR = os.path.join(self.tmp, "out")
        config.DB_PATH = os.path.join(self.tmp, "real.db")

    @unittest.skipUnless(os.path.exists(REAL), "real export not present")
    def test_full_pipeline_runs(self):
        from workout import db, ingest, summary, report
        conn = db.connect()
        db.init(conn)
        res = ingest.run(conn, self.REAL)
        self.assertEqual(res["inserted"], 1929)
        obj = summary.build(conn)
        self.assertEqual(obj["schema_version"], 4)
        self.assertTrue(len(obj["exercises"]) > 20)
        # legs must flag as under-MEV (matches the known 6% leg volume)
        self.assertEqual(obj["week_summary"]["muscle_detail"]["quads"]["status"],
                         "under_MEV")
        md = report.render_markdown(obj)
        self.assertIn("Weekly Coaching Report", md)
        html = report.render_dashboard(obj)
        self.assertNotIn("/*__DATA__*/", html)
        # recovery accuracy block + confidence-labeled, frequency-aware set plan
        self.assertIn("recovery_accuracy", obj)
        vp = obj["volume_plan"]
        self.assertIn("recovery_confidence", vp)
        if vp["recommendations"]:
            r0 = vp["recommendations"][0]
            for k in ("confidence", "momentum", "fatigue", "current_sets_4wk"):
                self.assertIn(k, r0)
        chest = obj["week_summary"]["muscle_detail"]["chest"]
        for k in ("sets_per_week_ewma", "sets_recent_7d", "active_weeks_4wk"):
            self.assertIn(k, chest)

    def test_v4_dashboard_blocks(self):
        """The dashboard data blocks added in v4 are present and well-formed."""
        from workout import db, ingest, summary
        conn = db.connect()
        db.init(conn)
        ingest.run(conn, self.REAL)
        obj = summary.build(conn)
        # calendar: one row per training day, with the expected shape
        cal = obj["calendar"]
        self.assertTrue(len(cal) > 50)
        self.assertEqual(len(cal), len({c["date"] for c in cal}))  # unique days
        for k in ("date", "sets", "volume", "n_exercises", "muscles"):
            self.assertIn(k, cal[0])
        # sessions: a drill-down keyed by date, each with exercises
        sess = obj["sessions"]
        self.assertIn(cal[-1]["date"], sess)
        last = sess[cal[-1]["date"]]
        self.assertIn("exercises", last)
        self.assertTrue(len(last["exercises"]) >= 1)
        self.assertIn("top_weight", last["exercises"][0])
        # records: one per analysed lift, with a best_e1rm
        recs = obj["records"]
        self.assertTrue(len(recs) > 20)
        self.assertTrue(any(r["best_e1rm"] for r in recs))
        # next_actions: prioritized, capped, well-formed
        na = obj["next_actions"]
        self.assertTrue(1 <= len(na) <= 8)
        for k in ("priority", "icon", "title", "detail", "tab"):
            self.assertIn(k, na[0])
        self.assertEqual(na, sorted(na, key=lambda a: a["priority"]))
        # muscle_detail carries recency for the body map
        self.assertIn("days_since", obj["week_summary"]["muscle_detail"]["chest"])
        # bodyweight is present (possibly empty) as a list
        self.assertIsInstance(obj["bodyweight"], list)
        # powerlifting block: three slots, total series, partial-aware
        pl = obj["powerlifting"]
        self.assertEqual([L["slot"] for L in pl["lifts"]],
                         ["squat", "bench", "deadlift"])
        self.assertIn("config", pl)
        self.assertIsInstance(pl["total_series"], list)
        self.assertTrue(0 <= pl["lifts_present"] <= 3)
        if pl["total_series"]:
            pt = pl["total_series"][-1]
            for k in ("date", "total", "present", "squat", "bench", "deadlift"):
                self.assertIn(k, pt)
            # total == sum of the lifts present at that point
            present_vals = [pt[s] for s in ("squat", "bench", "deadlift")
                            if pt[s] is not None]
            self.assertAlmostEqual(pt["total"], round(sum(present_vals), 1), places=1)
        # any present lift carries recent set-level rows
        for L in pl["lifts"]:
            if L.get("present"):
                self.assertIn("recent_sets", L)


if __name__ == "__main__":
    unittest.main(verbosity=2)
