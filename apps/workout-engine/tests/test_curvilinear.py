"""Tests for the curvilinear, regularized 1RM model (design 04).

Core claims:
  1. The monotone PCHIP curve passes through the Nuzzo knots, is strictly
     decreasing, f(1.0)=1, and is invertible (round-trips).
  2. spline_for_type orders by physics (lower_compound tolerates more reps at a
     %1RM than default) and is cached.
  3. failure_reps mirrors metrics.e1rm's reps-to-failure + reliability gate.
  4. fit_anchor RECOVERS the true 1RM when points lie on the type curve, is
     UNIT-SAFE (scaling loads scales M), and a 1RM always exceeds the top load.
  5. Gating + fallback ladder: spline 1RM only for spread lifts; the dispatcher
     is byte-identical to legacy when disabled, and switches when enabled.
  6. End-to-end on a DB: the anchor persists, analyze_exercise surfaces it, and
     the pre-registered validator returns a well-formed verdict.
"""
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from workout import config, individualize as ind, metrics, backtest  # noqa: E402


def _cfg(enabled):
    c = ind._curvilinear_cfg()
    c["enabled"] = enabled
    return c


class MonotoneCurveTest(unittest.TestCase):
    def setUp(self):
        self.s = ind.spline_for_type("default")

    def test_passes_through_knots(self):
        # default table: 0.70->12, 0.80->8, 0.85->6, 1.00->1
        self.assertAlmostEqual(self.s(0.70), 12.0, places=6)
        self.assertAlmostEqual(self.s(0.80), 8.0, places=6)
        self.assertAlmostEqual(self.s(1.00), 1.0, places=6)

    def test_strictly_decreasing(self):
        grid = [0.30 + 0.01 * i for i in range(76)]   # 0.30 .. 1.05
        vals = [self.s(p) for p in grid]
        self.assertTrue(all(b < a for a, b in zip(vals, vals[1:])))

    def test_invertible_round_trip(self):
        for target in (3.0, 6.0, 8.0, 11.0):
            p = self.s.inverse(target, 0.30, 1.05)
            self.assertAlmostEqual(self.s(p), target, places=3)

    def test_linear_extrapolation_beyond_knots(self):
        # below the lightest knot (0.65) the tail is linear with the edge tangent
        p0, p1 = 0.50, 0.40
        slope_tail = (self.s(p0) - self.s(p1)) / (p0 - p1)
        slope_tail2 = (self.s(0.45) - self.s(0.35)) / (0.10)
        self.assertAlmostEqual(slope_tail, slope_tail2, places=6)


class SplineForTypeTest(unittest.TestCase):
    def test_physics_ordering(self):
        # lower-body compounds tolerate more reps at the same %1RM than default
        lc = ind.spline_for_type("lower_compound")
        df = ind.spline_for_type("default")
        self.assertGreater(lc(0.80), df(0.80))

    def test_unknown_type_falls_back_to_default(self):
        self.assertEqual(ind.spline_for_type("nonsense")(0.80),
                         ind.spline_for_type("default")(0.80))

    def test_cached(self):
        self.assertIs(ind.spline_for_type("default"), ind.spline_for_type("default"))


class FailureRepsTest(unittest.TestCase):
    def test_reliable_rpe_adds_rir(self):
        rstar, reliable = ind.failure_reps(5, 8.0)        # RIR 2
        self.assertEqual((rstar, reliable), (7.0, True))

    def test_no_rpe_is_one_sided(self):
        self.assertEqual(ind.failure_reps(5, None), (5.0, False))

    def test_high_reps_unreliable(self):
        self.assertEqual(ind.failure_reps(15, 8.0), (15.0, False))   # reps > cap

    def test_deep_rir_unreliable(self):
        self.assertEqual(ind.failure_reps(5, 5.0), (5.0, False))     # RIR 5 > max


class FitAnchorTest(unittest.TestCase):
    # reps PERFORMED at RPE 8 (RIR 2) so r* = reps+2 lands exactly on the default
    # curve at M=100: 70->12, 75->10, 80->8, 85->6 reps-to-failure.
    PTS = [(70.0, 10, 8.0), (75.0, 8, 8.0), (80.0, 6, 8.0), (85.0, 4, 8.0)]

    def test_recovers_true_1rm(self):
        a = ind.fit_anchor(self.PTS, "default")
        self.assertEqual(a["basis"], "fit")
        self.assertAlmostEqual(a["M"], 100.0, delta=1.0)

    def test_unit_invariance(self):
        a1 = ind.fit_anchor(self.PTS, "default")
        scaled = [(w * 2, r, rpe) for (w, r, rpe) in self.PTS]
        a2 = ind.fit_anchor(scaled, "default")
        self.assertAlmostEqual(a2["M"], 2 * a1["M"], delta=1.0)   # ratio-only -> scales

    def test_1rm_exceeds_top_load(self):
        a = ind.fit_anchor(self.PTS, "default")
        self.assertGreater(a["M"], max(w for w, _, _ in self.PTS))

    def test_fixed_load_is_prior_basis(self):
        flat = [(50.0, 8, 8.0), (50.0, 8, 8.0), (50.0, 7, 8.0)]
        a = ind.fit_anchor(flat, "default")
        self.assertEqual(a["basis"], "prior")
        self.assertGreater(a["M"], 50.0)

    def test_empty_is_none(self):
        self.assertIsNone(ind.fit_anchor([], "default"))


class IndividualRmSplineTest(unittest.TestCase):
    def test_spread_lift_gets_value(self):
        a = ind.fit_anchor(FitAnchorTest.PTS, "default")
        self.assertAlmostEqual(ind.individual_1rm_spline(a), round(a["M"], 1))

    def test_fixed_load_lift_gets_none(self):
        a = ind.fit_anchor([(50.0, 8, 8.0), (50.0, 8, 8.0), (50.0, 7, 8.0)], "default")
        self.assertIsNone(ind.individual_1rm_spline(a))   # prior basis -> no spline 1RM

    def test_none_anchor(self):
        self.assertIsNone(ind.individual_1rm_spline(None))


class DispatchTest(unittest.TestCase):
    MODEL = {"slope": -0.3, "intercept": 31.0, "r2": 0.9, "n": 10,
             "resid_std": 1.0, "mean_x": 80.0, "ssx": 250.0,
             "min_x": 70.0, "max_x": 90.0}

    def test_disabled_uses_linear(self):
        a = ind.fit_anchor(FitAnchorTest.PTS, "default")
        v, basis = ind.individ_1rm_dispatch(a, self.MODEL, _cfg(False))
        self.assertEqual(basis, "linear")
        self.assertEqual(v, ind.individual_1rm(self.MODEL))

    def test_enabled_prefers_spline(self):
        a = ind.fit_anchor(FitAnchorTest.PTS, "default")
        v, basis = ind.individ_1rm_dispatch(a, self.MODEL, _cfg(True))
        self.assertEqual(basis, "spline")
        self.assertEqual(v, ind.individual_1rm_spline(a))

    def test_enabled_falls_back_to_linear_for_fixed_load(self):
        a = ind.fit_anchor([(50.0, 8, 8.0)] * 3, "default")     # prior basis
        v, basis = ind.individ_1rm_dispatch(a, self.MODEL, _cfg(True))
        self.assertEqual(basis, "linear")                       # spline declined -> linear

    def test_no_model_no_anchor_is_none(self):
        v, basis = ind.individ_1rm_dispatch(None, None, _cfg(True))
        self.assertEqual((v, basis), (None, "none"))


class WeightDepFormulaTest(unittest.TestCase):
    def test_returns_a_number_in_domain(self):
        self.assertIsNotNone(metrics.e1rm_weightdep(100.0, 5))

    def test_none_below_load_floor(self):
        # a + b*ln(w) <= 0  ->  w < exp(2.55/4.58) ~ 1.74kg -> undefined
        self.assertIsNone(metrics.e1rm_weightdep(1.0, 5))


class CurvilinearDbTest(unittest.TestCase):
    """A spread upper-press lift with recent RPE gets a curvilinear anchor; the
    flag toggles whether it drives the headline 1RM; the validator runs."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        config.DATA_DIR = self.tmp
        config.OUTPUT_DIR = os.path.join(self.tmp, "out")
        config.DB_PATH = os.path.join(self.tmp, "cv.db")
        from workout import db
        self.conn = db.connect()
        db.init(self.conn)
        base = datetime(2026, 3, 2)
        # varied loads, falling reps, RPE 8-9 (recent -> reliable to-failure)
        rows = [(60, 12, 8.0), (65, 10, 8.0), (70, 9, 8.0), (72, 8, 8.5),
                (75, 7, 8.0), (78, 6, 8.5), (80, 5, 9.0), (82, 5, 9.0),
                (84, 4, 9.0), (86, 3, 9.5)]
        for i, (w, r, rpe) in enumerate(rows):
            day = (base + timedelta(days=5 * i)).strftime("%Y-%m-%d")
            self.conn.execute(
                "INSERT INTO sets (start_time, exercise_title, set_index, "
                "weight_raw, reps_clean, rpe, epoch, is_working, date) "
                "VALUES (?,?,0,?,?,?,0,1,?)",
                (f"{day}T18:00:00", "Bench Press", w, r, rpe, day))
        self.conn.commit()

    def test_anchor_present_and_fit(self):
        a = ind.analyze_exercise(self.conn, "Bench Press", 0)
        self.assertIsNotNone(a["anchor"])
        self.assertEqual(a["anchor"]["basis"], "fit")
        self.assertGreater(a["anchor"]["M"], 86.0)            # exceeds top load

    def test_flag_off_is_legacy_linear(self):
        a = ind.analyze_exercise(self.conn, "Bench Press", 0)
        self.assertEqual(a["individ_1rm_basis"], "linear")
        model = ind.fit_load_rep(ind.fresh_points(self.conn, "Bench Press", 0))
        self.assertEqual(a["individ_1rm"], ind.individual_1rm(model))   # byte-identical

    def test_flag_on_uses_spline(self):
        on = _cfg(True)   # build BEFORE patching so the lambda can't recurse
        with mock.patch.object(ind, "_curvilinear_cfg", lambda: on):
            a = ind.analyze_exercise(self.conn, "Bench Press", 0)
        self.assertEqual(a["individ_1rm_basis"], "spline")
        self.assertAlmostEqual(a["individ_1rm"], round(a["anchor"]["M"], 1))

    def test_refresh_persists_anchor(self):
        ind.refresh_models(self.conn)
        row = self.conn.execute(
            "SELECT anchor_m, anchor_type, individ_1rm_basis FROM exercise_models "
            "WHERE exercise_title='Bench Press'").fetchone()
        self.assertIsNotNone(row["anchor_m"])
        self.assertEqual(row["anchor_type"], "upper_press")

    def test_validator_shape(self):
        out = backtest.heavy_extrapolation(self.conn)
        for k in ("heavy", "inband", "adopt_curvilinear", "rule", "note"):
            self.assertIn(k, out)
        self.assertIsInstance(out["adopt_curvilinear"], bool)


if __name__ == "__main__":
    unittest.main(verbosity=2)
