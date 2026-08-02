"""Tests for conformal prediction intervals (design 06).

Core claims:
  1. conformal_quantile is the EXACT split-conformal order statistic
     s[ceil((n+1)(1-alpha)) - 1], returning +inf when n is too small for a finite
     (1-alpha) interval - the finite-sample marginal guarantee, not an interpolated
     percentile.
  2. conformal_interval is symmetric, scalable (the §1b heteroscedastic width),
     clampable, and None when the quantile is +inf.
  3. mondrian_quantiles gives a per-group quantile only when the pooled n clears
     min_n, else the fallback (or None for an orphan); lookup resolves group ->
     global.
  4. predict_reps_conformal keeps predict_reps_anchored's POINT and only swaps the
     band; normalized widens away from the trained load; the band clamps to [1,20].
  5. rep_conformal_quantiles pools |residual| scores by exercise-TYPE.
  6. prediction_for is byte-identical (Gaussian band, no 'interval' key) when the
     flag is OFF, and emits a calibrated conformal band when ON.
  7. The backtest validator (coverage vs the Gaussian band) and the forecast band
     audit are well-formed; the finite-sample correction never narrows the band.
"""
import math
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from workout import (config, conformal, individualize as ind,  # noqa: E402
                     autoregulation as ar, forecast, backtest, trend)


# --------------------------------------------------------------------------
# Shared conformal core
# --------------------------------------------------------------------------
class ConformalQuantileTest(unittest.TestCase):
    def test_empty_is_inf(self):
        self.assertEqual(conformal.conformal_quantile([], 0.2), float("inf"))

    def test_exact_order_statistic(self):
        # n=10, alpha=0.2 -> k=ceil(11*0.8)=9 -> the 9th smallest (1-indexed) = 9
        self.assertEqual(conformal.conformal_quantile(list(range(1, 11)), 0.2), 9)

    def test_too_few_for_finite_interval(self):
        # alpha=0.2 needs n>=4: n=3 -> k=ceil(4*0.8)=4 > 3 -> inf
        self.assertEqual(conformal.conformal_quantile([5, 1, 3], 0.2), float("inf"))
        # n=4 -> k=ceil(5*0.8)=4 <= 4 -> finite (the max)
        self.assertEqual(conformal.conformal_quantile([5, 1, 3, 2], 0.2), 5)

    def test_finite_sample_inflation_vs_plain_percentile(self):
        # the (n+1) correction must never read BELOW the plain (1-alpha) percentile
        scores = [float(i) for i in range(1, 31)]
        q = conformal.conformal_quantile(scores, 0.2)
        plain = trend._percentile(sorted(scores), 0.8)
        self.assertGreaterEqual(q, plain)

    def test_marginal_coverage_property(self):
        # q at 80% over 1..100 should cover >= 80% of an exchangeable draw
        scores = list(range(1, 101))
        q = conformal.conformal_quantile(scores, 0.2)
        covered = sum(1 for v in scores if v <= q) / len(scores)
        self.assertGreaterEqual(covered, 0.8)

    def test_ignores_none_and_inf(self):
        self.assertEqual(
            conformal.conformal_quantile([1, None, 2, float("inf"), 3, 4], 0.2), 4)


class ConformalIntervalTest(unittest.TestCase):
    def test_inf_is_none(self):
        self.assertIsNone(conformal.conformal_interval(8, float("inf")))
        self.assertIsNone(conformal.conformal_interval(8, None))

    def test_symmetric(self):
        self.assertEqual(conformal.conformal_interval(8, 2), [6, 10])

    def test_scale(self):
        self.assertEqual(conformal.conformal_interval(8, 2, scale=1.5), [5.0, 11.0])

    def test_clamp(self):
        # point 2, q 5 -> [-3, 7] clamped to [1, 20] -> [1, 7]
        self.assertEqual(conformal.conformal_interval(2, 5, clamp=(1.0, 20.0)), [1.0, 7])

    def test_zero_width_is_a_point(self):
        self.assertEqual(conformal.conformal_interval(8, 0), [8, 8])


class MondrianTest(unittest.TestCase):
    def test_group_above_floor_gets_own_quantile(self):
        out = conformal.mondrian_quantiles({"a": list(range(1, 26))}, 0.2, min_n=20)
        # n=25 -> k=ceil(26*0.8)=21 -> 21st smallest = 21
        self.assertEqual(out["a"], 21)

    def test_group_below_floor_inherits_fallback(self):
        out = conformal.mondrian_quantiles({"a": [1, 2]}, 0.2, min_n=20, fallback=7)
        self.assertEqual(out["a"], 7)

    def test_orphan_without_fallback_is_none(self):
        out = conformal.mondrian_quantiles({"a": [1, 2]}, 0.2, min_n=20, fallback=None)
        self.assertIsNone(out["a"])

    def test_lookup_falls_back_to_global(self):
        q = {"default": None, "__global__": 3.0}
        self.assertEqual(conformal.lookup(q, "default"), 3.0)   # None -> global
        self.assertEqual(conformal.lookup(q, "missing"), 3.0)   # absent -> global

    def test_lookup_keeps_zero_quantile(self):
        # a legitimate zero-width q must NOT be mistaken for 'missing'
        q = {"default": 0.0, "__global__": 3.0}
        self.assertEqual(conformal.lookup(q, "default"), 0.0)


class AlphaTest(unittest.TestCase):
    def test_alpha_from_band_level(self):
        self.assertAlmostEqual(conformal.alpha_from_settings(),
                               1.0 - config.settings()["forecast_band_level"])


# --------------------------------------------------------------------------
# Rep-side helpers (individualize)
# --------------------------------------------------------------------------
class NormScaleTest(unittest.TestCase):
    MODEL = {"slope": -0.2, "resid_std": 1.0, "n": 10, "mean_x": 100.0, "ssx": 1000.0}

    def test_no_model_is_one(self):
        self.assertEqual(ind._norm_scale(None, 100), 1.0)
        self.assertEqual(ind._norm_scale({"ssx": 0}, 100), 1.0)

    def test_minimum_at_mean_and_fans_out(self):
        at_mean = ind._norm_scale(self.MODEL, 100.0)
        far = ind._norm_scale(self.MODEL, 160.0)
        self.assertLess(at_mean, far)                # wider away from the trained load
        self.assertAlmostEqual(at_mean, math.sqrt(1 + 1 / 10))   # (load-mean)^2 = 0


class PredictRepsConformalTest(unittest.TestCase):
    MODEL = {"slope": -0.2, "resid_std": 1.0, "n": 10, "mean_x": 100.0, "ssx": 1000.0}

    def test_point_matches_anchored(self):
        ap = ind.predict_reps_anchored(self.MODEL, 100, 8, 90)
        pt, lo, hi = ind.predict_reps_conformal(self.MODEL, 100, 8, 90, q_g=2.0)
        self.assertAlmostEqual(pt, ap[0])            # POINT identical to the incumbent

    def test_band_is_point_plus_minus_q(self):
        pt, lo, hi = ind.predict_reps_conformal(self.MODEL, 100, 8, 100, q_g=2.0)
        self.assertAlmostEqual(pt, 8.0)
        self.assertAlmostEqual(lo, 6.0)
        self.assertAlmostEqual(hi, 10.0)

    def test_none_quantile_is_point_only(self):
        pt, lo, hi = ind.predict_reps_conformal(self.MODEL, 100, 8, 100, q_g=None)
        self.assertAlmostEqual(pt, 8.0)
        self.assertIsNone(lo)
        self.assertIsNone(hi)

    def test_clamp_to_feasible_reps(self):
        # huge q -> lower bound clamps at 1, upper at 20
        _, lo, hi = ind.predict_reps_conformal(self.MODEL, 100, 8, 100, q_g=50.0)
        self.assertEqual(lo, 1.0)
        self.assertEqual(hi, 20.0)

    def test_normalized_widens_far_from_mean(self):
        _, lo_near, hi_near = ind.predict_reps_conformal(
            self.MODEL, 100, 8, 100, q_g=1.0, normalized=True, clamp=None)
        _, lo_far, hi_far = ind.predict_reps_conformal(
            self.MODEL, 100, 8, 160, q_g=1.0, normalized=True, clamp=None)
        self.assertGreater(hi_far - lo_far, hi_near - lo_near)

    def test_no_anchor_is_none(self):
        self.assertIsNone(ind.predict_reps_conformal(self.MODEL, None, None, 100, 2.0))


# --------------------------------------------------------------------------
# Forecast finite-sample correction never narrows
# --------------------------------------------------------------------------
class ForecastCorrectionTest(unittest.TestCase):
    def test_conformal_half_not_below_plain(self):
        rels = sorted([0.01 * i for i in range(1, 41)])     # n=40
        level = 0.8
        plain = trend._percentile(rels, level)
        conf = conformal.conformal_quantile(rels, 1.0 - level)
        self.assertGreaterEqual(conf, plain)                 # finite-sample widens/equals


# --------------------------------------------------------------------------
# DB-backed: live quantiles, flag gating, validators
# --------------------------------------------------------------------------
class ConformalDbTest(unittest.TestCase):
    """A load-varied lift with several sessions: type quantiles compute, the flag
    flips the live band to conformal (point unchanged), and the validators run."""

    EX = "Bench Press"

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        config.DATA_DIR = self.tmp
        config.OUTPUT_DIR = os.path.join(self.tmp, "out")
        config.DB_PATH = os.path.join(self.tmp, "cf.db")
        from workout import db
        self.conn = db.connect()
        db.init(self.conn)
        self.muscle = config.exercise_info(self.EX)["primary"]
        base = datetime(2026, 1, 5)
        # 14 sessions, load varied, reps wobble around the slope so residuals are
        # NOT all zero (a non-degenerate calibration set).
        rows = [(60, 12), (62, 11), (64, 11), (66, 10), (68, 9), (70, 9), (72, 8),
                (74, 8), (76, 7), (78, 7), (80, 6), (82, 6), (84, 5), (86, 5)]
        for i, (w, r) in enumerate(rows):
            day = (base + timedelta(days=4 * i)).strftime("%Y-%m-%d")
            self.conn.execute(
                "INSERT INTO sets (start_time, exercise_title, primary_muscle, "
                "set_index, weight_raw, reps_clean, epoch, is_working, date) "
                "VALUES (?,?,?,0,?,?,0,1,?)",
                (f"{day}T18:00:00", self.EX, self.muscle, w, r, day))
        self.conn.commit()

    def _on(self, **over):
        # This helper is installed as a replacement for _conformal_cfg below,
        # so calling conformal._conformal_cfg() here recursively invokes itself.
        # Build the equivalent test configuration directly instead.
        c = {
            "enabled": True,
            "min_group_n": 20,
            "normalized": False,
            "coverage_lo": 0.75,
            "coverage_hi": 0.85,
            "min_type_n": 20,
            "forecast_width_tol": 0.10,
        }
        c["min_group_n"] = 3            # tiny so the test pool calibrates
        c.update(over)
        return c

    def test_rep_conformal_quantiles_shape(self):
        cq = ind.rep_conformal_quantiles(self.conn)
        self.assertIn("__global__", cq)
        self.assertIn(ind.ex_type(self.EX), cq)
        for v in cq.values():
            self.assertTrue(v is None or (isinstance(v, float) and math.isfinite(v)))

    def test_flag_off_is_gaussian_no_interval_key(self):
        pred = ar.prediction_for(self.conn, self.EX, 0, 80.0)
        self.assertNotIn("interval", pred)

    def test_flag_on_emits_conformal_band_same_point(self):
        off = ar.prediction_for(self.conn, self.EX, 0, 80.0)
        with mock.patch.object(conformal, "_conformal_cfg", self._on):
            on = ar.prediction_for(self.conn, self.EX, 0, 80.0)
        self.assertEqual(on.get("interval"), "conformal")
        self.assertAlmostEqual(on["reps"], off["reps"])      # POINT unchanged
        self.assertLessEqual(on["lo"], on["reps"])
        self.assertGreaterEqual(on["hi"], on["reps"])

    def test_validator_well_formed(self):
        out = backtest.conformal_rep_intervals(self.conn)
        for k in ("n", "overall", "by_type", "adopt_conformal", "degenerate_interval",
                  "rule", "note"):
            self.assertIn(k, out)
        self.assertIsInstance(out["adopt_conformal"], bool)
        if out.get("n"):
            ov = out["overall"]
            if ov["coverage"] is not None:
                self.assertGreaterEqual(ov["coverage"], 0.0)
                self.assertLessEqual(ov["coverage"], 1.0)
            # Gaussian incumbent is scored on every window for the comparison
            self.assertIsNotNone(ov["gaussian_coverage"])

    def test_forecast_band_audit_well_formed(self):
        out = backtest.forecast_band_audit(self.conn)
        # tiny single-lift DB -> likely "not enough", but must be a clean dict
        self.assertIn("n", out)
        if out.get("plain_halfwidth") is not None:
            self.assertIn("adopt_conformal_band", out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
