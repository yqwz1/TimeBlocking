"""Tests for hierarchical partial pooling of the load->reps slope (design 02).

Core claims:
  1. ex_type maps movement patterns to the three reps_at_pct1rm buckets.
  2. The DerSimonian-Laird level math: tau2=0 for a homogeneous group, >0 for a
     heterogeneous one; precision-weighted mu.
  3. shrink_load_rep_slope: a starved lift fully borrows mu_g (the rescue); a
     strong lift is ~unchanged.
  4. predict_reps_anchored honors a supplied pooled slope (overrides the raw fit).
  5. End-to-end on a DB: a starved same-type lift borrows a data-rich lift's slope
     so it can predict at all, and the pre-registered validator reports a verdict.
"""
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from workout import config, individualize as ind, backtest, autoregulation  # noqa: E402


class ExTypeTest(unittest.TestCase):
    def test_lower_compound(self):
        self.assertEqual(ind.ex_type("Squat (Barbell)"), "lower_compound")
        self.assertEqual(ind.ex_type("Deadlift (Barbell)"), "lower_compound")

    def test_upper_press(self):
        self.assertEqual(ind.ex_type("Bench Press"), "upper_press")

    def test_default_for_pulls_and_isolation(self):
        self.assertEqual(ind.ex_type("Lat Pulldown"), "default")
        self.assertEqual(ind.ex_type("Forearm Curl"), "default")

    def test_unmapped_is_default(self):
        self.assertEqual(ind.ex_type("Totally Made Up Lift"), "default")


class EbLevelTest(unittest.TestCase):
    def test_single_lift_zero_tau2(self):
        lvl = ind._eb_level([(-0.3, 0.1, 1.5)])
        self.assertAlmostEqual(lvl["mu"], -0.3)
        self.assertEqual(lvl["tau2"], 0.0)
        self.assertEqual(lvl["k"], 1)

    def test_homogeneous_group_zero_tau2(self):
        lvl = ind._eb_level([(-0.3, 0.05, 1.0), (-0.3, 0.05, 1.0)])
        self.assertAlmostEqual(lvl["mu"], -0.3)
        self.assertEqual(lvl["tau2"], 0.0)

    def test_heterogeneous_group_positive_tau2(self):
        lvl = ind._eb_level([(-0.2, 0.05, 1.0), (-0.8, 0.05, 1.0)])
        self.assertAlmostEqual(lvl["mu"], -0.5)        # precision-weighted (equal se)
        self.assertGreater(lvl["tau2"], 0.0)


class ShrinkSlopeTest(unittest.TestCase):
    def test_starved_full_borrow(self):
        beta, var = ind.shrink_load_rep_slope(None, None, -0.3, 0.01)
        self.assertEqual(beta, -0.3)                   # = mu_g, the rescue
        self.assertEqual(var, 0.01)

    def test_huge_se_borrows_mu(self):
        beta, _ = ind.shrink_load_rep_slope(-0.1, 1000.0, -0.3, 0.01)
        self.assertAlmostEqual(beta, -0.3, places=3)   # B -> 1

    def test_tiny_se_keeps_personal(self):
        beta, _ = ind.shrink_load_rep_slope(-0.1, 0.001, -0.3, 0.01)
        self.assertAlmostEqual(beta, -0.1, places=3)   # B -> 0

    def test_zero_tau2_uses_common_slope(self):
        beta, var = ind.shrink_load_rep_slope(-0.1, 0.1, -0.3, 0.0)
        self.assertEqual(beta, -0.3)
        self.assertAlmostEqual(var, 0.01)              # se**2

    def test_partial_shrink_between(self):
        beta, _ = ind.shrink_load_rep_slope(-0.1, 0.1414, -0.3, 0.01)
        self.assertTrue(-0.3 < beta < -0.1)


class PredictAnchoredPooledTest(unittest.TestCase):
    MODEL = {"slope": -0.5, "resid_std": 2.0}

    def test_pooled_overrides_raw_slope(self):
        pt, lo, hi = ind.predict_reps_anchored(self.MODEL, 100, 10, 90, pooled=(-0.2, 1.0))
        self.assertEqual(pt, 12.0)                     # 10 + (-0.2)*(90-100)
        self.assertAlmostEqual(hi - lo, 2 * 1.96 * 1.0)  # interval from pooled se

    def test_raw_used_without_pooled(self):
        pt, _, _ = ind.predict_reps_anchored(self.MODEL, 100, 10, 90)
        self.assertEqual(pt, 15.0)                     # 10 + (-0.5)*(90-100)

    def test_naive_when_no_model_no_pooled(self):
        pt, _, _ = ind.predict_reps_anchored(None, 100, 8, 105)
        self.assertEqual(pt, 8.0)                       # slope 0


class PooledSlopeForTest(unittest.TestCase):
    GROUPS = {"upper_press": {"mu": -0.3, "tau2": 0.01, "resid_std": 1.5, "k": 4},
              "__global__": {"mu": -0.25, "tau2": 0.02, "resid_std": 1.6, "k": 6}}

    def test_starved_borrows(self):
        p = ind.pooled_slope_for("Bench Press", None, self.GROUPS)
        self.assertEqual(p["basis"], "borrowed")
        self.assertTrue(p["apply"])
        self.assertEqual(p["slope"], -0.3)             # mu_g
        self.assertEqual(p["resid_std"], 1.5)          # group rep scatter
        self.assertEqual(p["confidence"], 45)          # 25 + 5*4, capped 55

    def test_strong_kept_personal(self):
        strong = {"slope": -0.25, "r2": 0.8, "n": 10, "min_x": 50, "max_x": 90,
                  "ssx": 1000.0, "resid_std": 1.2}
        p = ind.pooled_slope_for("Bench Press", strong, self.GROUPS)
        self.assertEqual(p["basis"], "personal")
        self.assertFalse(p["apply"])
        self.assertEqual(p["slope"], -0.25)            # untouched

    def test_weak_with_data_is_shrunk(self):
        weak = {"slope": -0.1, "r2": 0.2, "n": 5, "min_x": 50, "max_x": 55,
                "ssx": 50.0, "resid_std": 1.0}
        p = ind.pooled_slope_for("Bench Press", weak, self.GROUPS)
        self.assertEqual(p["basis"], "shrunk")
        self.assertTrue(p["apply"])
        self.assertTrue(-0.3 < p["slope"] < -0.1)

    def test_falls_back_to_global_for_unknown_type(self):
        # a type with no level -> borrow the global level
        groups = {"__global__": self.GROUPS["__global__"]}
        p = ind.pooled_slope_for("Bench Press", None, groups)
        self.assertEqual(p["slope"], -0.25)


class PoolingDbTest(unittest.TestCase):
    """A starved upper-press lift borrows a data-rich upper-press lift's slope."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        config.DATA_DIR = self.tmp
        config.OUTPUT_DIR = os.path.join(self.tmp, "out")
        config.DB_PATH = os.path.join(self.tmp, "pool.db")
        from workout import db
        self.conn = db.connect()
        db.init(self.conn)
        base = datetime(2025, 1, 6)
        # RICH upper_press lift: clear negative load->reps slope over varied loads,
        # with realistic jitter (perfectly collinear reps -> resid_std 0 -> excluded).
        reps_seq = [12, 11, 10, 10, 9, 8, 7, 7, 5, 4]
        for i in range(10):
            day = (base + timedelta(days=7 * i)).strftime("%Y-%m-%d")
            self.conn.execute(
                "INSERT INTO sets (start_time, exercise_title, set_index, "
                "weight_raw, reps_clean, epoch, is_working, date) "
                "VALUES (?,?,0,?,?,0,1,?)",
                (f"{day}T18:00:00", "Bench Press", 60.0 + 4 * i, reps_seq[i], day))
        # STARVED upper_press lift: constant load -> no own slope -> must borrow
        for i in range(6):
            day = (base + timedelta(days=7 * i)).strftime("%Y-%m-%d")
            self.conn.execute(
                "INSERT INTO sets (start_time, exercise_title, set_index, "
                "weight_raw, reps_clean, epoch, is_working, date) "
                "VALUES (?,?,0,?,?,0,1,?)",
                (f"{day}T19:00:00", "Upper Chest Press (Machine)", 50.0, 8, day))
        self.conn.commit()

    def test_group_slope_estimated_from_rich_lift(self):
        groups = ind.group_slopes(self.conn)
        self.assertIn("upper_press", groups)
        self.assertLess(groups["upper_press"]["mu"], 0)   # reps fall as load rises
        self.assertEqual(groups["upper_press"]["k"], 1)   # only the rich lift identifies
        self.assertIsNotNone(groups["__global__"])

    def test_starved_lift_borrows_and_can_predict(self):
        groups = ind.group_slopes(self.conn)
        a = ind.analyze_exercise(self.conn, "Upper Chest Press (Machine)", 0, groups)
        self.assertIsNone(a["model"])                     # no own slope
        self.assertEqual(a["slope_basis"], "borrowed")
        self.assertTrue(a["slope_apply"])
        self.assertLess(a["pooled_slope"], 0)             # borrowed negative slope
        # prediction now uses the borrowed slope, not naive 'same reps'
        pred = autoregulation.prediction_for(
            self.conn, "Upper Chest Press (Machine)", 0, 60.0, groups)
        self.assertIn("borrowed", pred["basis"])
        self.assertLess(pred["reps"], 8)                  # heavier than the 50kg @8 anchor

    def test_rich_lift_kept_personal(self):
        groups = ind.group_slopes(self.conn)
        a = ind.analyze_exercise(self.conn, "Bench Press", 0, groups)
        self.assertIsNotNone(a["model"])
        self.assertEqual(a["slope_basis"], "personal")
        self.assertFalse(a["slope_apply"])

    def test_validator_shape(self):
        out = backtest.pooled_rep_prediction(self.conn)
        self.assertIn("starved", out)
        self.assertIn("rich", out)
        self.assertIn("adopt_pooling", out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
