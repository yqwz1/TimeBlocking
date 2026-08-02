"""RPE-autoregulated next-target: load gate + granular jump size.

Hitting the top of the rep range earns load ONLY with reps in reserve, and a
double jump when even the hardest top set was well short of failure. With no RPE
the behavior is the original double-progression (single step).
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from workout import config  # noqa: E402
from workout import autoregulation as ar  # noqa: E402

EX = "Bench Press (Barbell)"
PROG = {"epoch": 1, "status": "progressing"}


class AutoregTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        config.DATA_DIR = self.tmp
        config.OUTPUT_DIR = os.path.join(self.tmp, "out")
        config.DB_PATH = os.path.join(self.tmp, "ar.db")
        from workout import db
        self.conn = db.connect()
        db.init(self.conn)
        self.muscle = config.exercise_info(EX)["primary"]
        self.inc = config.settings()["increment_overrides"].get(
            config.exercise_info(EX).get("equipment", "other"),
            config.settings()["default_increment_kg"])

    def _log(self, reps_rpe, weight=100.0):
        """reps_rpe = list of (reps, rpe) top sets, all at the same load."""
        for i, (reps, rpe) in enumerate(reps_rpe):
            self.conn.execute(
                "INSERT INTO sets (start_time, exercise_title, primary_muscle, "
                "epoch, set_index, reps_clean, weight_raw, rpe, is_working, date) "
                "VALUES (?,?,?,?,?,?,?,?,1,?)",
                ("2025-03-01T20:00:00", EX, self.muscle, 1, i, reps, weight,
                 rpe, "2025-03-01"))
        self.conn.commit()

    def test_top_of_range_with_reserve_adds_one_step(self):
        self._log([(8, 7.0), (8, 7.0)])           # RIR 3: reserve, but not big
        t = ar._base_target(self.conn, EX, PROG)
        self.assertEqual(t["rec_type"], "progress")
        self.assertAlmostEqual(t["weight"], 100.0 + self.inc)

    def test_big_reserve_earns_double_jump(self):
        self._log([(8, 6.0), (8, 6.0)])           # hardest top set RIR 4 -> 2 steps
        t = ar._base_target(self.conn, EX, PROG)
        self.assertEqual(t["rec_type"], "progress")
        self.assertAlmostEqual(t["weight"], 100.0 + 2 * self.inc)

    def test_high_rpe_holds_even_at_top_reps(self):
        self._log([(8, 9.5), (8, 10.0)])          # no reserve -> repeat cleaner
        t = ar._base_target(self.conn, EX, PROG)
        self.assertEqual(t["rec_type"], "hold")
        self.assertAlmostEqual(t["weight"], 100.0)

    def test_one_grindy_set_blocks_the_double_jump(self):
        self._log([(8, 6.0), (8, 8.0)])           # easiest RIR4 but hardest RIR2
        t = ar._base_target(self.conn, EX, PROG)
        self.assertEqual(t["rec_type"], "progress")
        self.assertAlmostEqual(t["weight"], 100.0 + self.inc)   # single, not double

    def test_no_rpe_keeps_original_single_step(self):
        self._log([(8, None), (8, None)])
        t = ar._base_target(self.conn, EX, PROG)
        self.assertEqual(t["rec_type"], "progress")
        self.assertAlmostEqual(t["weight"], 100.0 + self.inc)

    def test_next_target_surfaces_last_rpe(self):
        self._log([(8, 7.0), (8, 8.5)])
        t = ar.next_target(self.conn, EX, PROG)
        self.assertEqual(t["last_rpe"], 8.5)                    # hardest top set
        self.assertAlmostEqual(t["last_reserve"], 1.5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
