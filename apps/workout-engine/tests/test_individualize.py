"""v2 tests: Bayesian individualization, plateau detection, compare engine."""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from workout import config  # noqa: E402
from workout import individualize as ind, trend, plateau, volume  # noqa: E402
from workout import forecast, metrics  # noqa: E402


class OLSTest(unittest.TestCase):
    def test_recovers_known_slope(self):
        # reps = 20 - 0.1*load + small noise -> slope ~ -0.1, non-degenerate PI
        noise = {60: 0.3, 70: -0.2, 80: 0.1, 90: -0.3, 100: 0.2}
        pts = [(load, 20 - 0.1 * load + noise[load]) for load in noise]
        m = ind.fit_load_rep(pts)
        self.assertIsNotNone(m)
        self.assertAlmostEqual(m["slope"], -0.1, places=1)
        pt, lo, hi = ind.predict_reps(m, 85)
        self.assertAlmostEqual(pt, 11.5, delta=0.5)
        self.assertLess(lo, pt)
        self.assertGreater(hi, pt)

    def test_positive_slope_rejected(self):
        # reps rising with load is not a valid load-rep model
        pts = [(load, load) for load in (60, 70, 80, 90, 100)]
        self.assertIsNone(ind.fit_load_rep(pts))


class AnchoredPredictTest(unittest.TestCase):
    def test_adjusts_for_load_change(self):
        model = {"slope": -0.1, "resid_std": 1.0}
        # last set: 100kg x 10. At 90kg expect ~1 more rep (slope -0.1/kg).
        pt, lo, hi = ind.predict_reps_anchored(model, 100, 10, 90)
        self.assertAlmostEqual(pt, 11.0, places=6)
        self.assertLess(lo, pt)
        self.assertGreater(hi, pt)

    def test_no_model_falls_back_to_naive(self):
        # no slope -> predicts the last reps unchanged
        pt, _, _ = ind.predict_reps_anchored(None, 100, 8, 105)
        self.assertEqual(pt, 8)


class BayesTest(unittest.TestCase):
    def test_posterior_between_prior_and_obs(self):
        post, var = ind.normal_normal_update(1.0, 4.0, 3.0, 1.0, 5)
        self.assertTrue(1.0 < post < 3.0)
        self.assertLess(var, 4.0)  # variance shrinks below prior

    def test_variance_shrinks_with_n(self):
        _, v_small = ind.normal_normal_update(1.0, 4.0, 3.0, 2.0, 2)
        _, v_large = ind.normal_normal_update(1.0, 4.0, 3.0, 2.0, 30)
        self.assertLess(v_large, v_small)

    def test_shrink_moves_toward_obs_as_n_grows(self):
        near, _ = ind.shrink_slope(3.5, 2.0, 2)
        far, _ = ind.shrink_slope(3.5, 2.0, 40)
        self.assertGreater(far, near)  # more data -> closer to observed 3.5


class GraceTest(unittest.TestCase):
    def test_states(self):
        self.assertEqual(ind.grace(None)[0], "calibrating")
        small = {"n": 3, "r2": 0.9}
        self.assertEqual(ind.grace(small)[0], "calibrating")
        good = {"n": 20, "r2": 0.8}
        self.assertEqual(ind.grace(good)[0], "confident")
        mid = {"n": 8, "r2": 0.6}
        self.assertEqual(ind.grace(mid)[0], "learning")


class TheilSenTest(unittest.TestCase):
    def test_slope(self):
        fit = trend.theil_sen([(0, 0), (1, 2), (2, 4), (3, 6)])
        self.assertAlmostEqual(fit["slope"], 2.0, places=6)


class PlateauTest(unittest.TestCase):
    def _series(self, vals):
        # weekly dates
        out = []
        for i, v in enumerate(vals):
            d = f"2025-{1 + i // 4:02d}-{1 + (i % 4) * 7:02d}"
            out.append((d, v))
        return out

    def test_segmented_finds_breakpoint(self):
        # rises then flattens
        s = self._series([100, 105, 110, 115, 120, 120, 120, 120])
        seg = plateau.segmented(s, min_seg=3)
        self.assertIsNotNone(seg)
        self.assertGreater(seg["left_slope_wk"], 0)
        self.assertLess(abs(seg["right_slope_wk"]), abs(seg["left_slope_wk"]))

    def test_status_flat_is_plateau(self):
        s = self._series([100, 106, 112, 118, 124, 124, 124, 124, 124])
        st = plateau.status(s)
        self.assertIn(st["verdict"], ("plateau", "declining"))

    def test_asymptotic_ceiling(self):
        # approaches ~150
        import math
        s = self._series([100 + 50 * (1 - math.exp(-0.5 * i)) for i in range(10)])
        asy = plateau.asymptotic(s)
        self.assertIsNotNone(asy)
        self.assertTrue(130 <= asy["ceiling"] <= 175)


class VolumeGatingTest(unittest.TestCase):
    """The user's core rule: poor recovery must never increase sets."""

    def test_good_recovery_adds(self):
        target, action, _ = volume._decide(12, 10, 18, 25, "recovering_well")
        self.assertGreater(target, 12)
        self.assertEqual(action, "add")

    def test_poor_recovery_does_not_increase(self):
        target, action, _ = volume._decide(12, 10, 18, 25, "under_recovering")
        self.assertLessEqual(target, 12)          # never adds when under-recovering
        self.assertIn(action, ("reduce", "hold"))

    def test_borderline_holds(self):
        target, action, _ = volume._decide(12, 10, 18, 25, "borderline")
        self.assertEqual(target, 12)
        self.assertEqual(action, "hold")

    def test_over_mrv_deloads(self):
        target, action, _ = volume._decide(27, 10, 18, 25, "recovering_well")
        self.assertLess(target, 27)
        self.assertEqual(action, "deload")

    def test_below_mev_raises(self):
        target, action, _ = volume._decide(4, 10, 18, 25, "recovering_well")
        self.assertEqual(target, 10)
        self.assertEqual(action, "raise_to_MEV")


class ForecastTest(unittest.TestCase):
    def test_damped_horizon_linear_when_phi_one(self):
        self.assertEqual(forecast._damped_horizon(1.0, 8), 8.0)

    def test_damped_horizon_shrinks_and_is_monotone(self):
        # 0<phi<1 must give a smaller effective horizon, rising with phi
        h_low = forecast._damped_horizon(0.5, 8)
        h_high = forecast._damped_horizon(0.8, 8)
        self.assertTrue(0 < h_low < h_high < 8)

    def test_project_point_linear(self):
        self.assertAlmostEqual(
            forecast.project_point(100, 1.0, 8, phi=1.0, ceiling=None), 108.0, places=6)

    def test_project_point_damped_below_linear(self):
        p = forecast.project_point(100, 1.0, 8, phi=0.6, ceiling=None)
        self.assertTrue(100 < p < 108)  # rises, but less than the linear 108

    def test_project_point_caps_at_ceiling(self):
        # linear would reach 140; a credible ceiling at 110 must cap it
        p = forecast.project_point(100, 5.0, 8, phi=1.0, ceiling=110)
        self.assertEqual(p, 110)

    def test_project_point_ignores_ceiling_when_declining(self):
        # a falling lift is never pushed up to a ceiling
        p = forecast.project_point(100, -1.0, 8, phi=1.0, ceiling=110)
        self.assertLess(p, 100)

    def test_insufficient_returns_no_point(self):
        prog = {"status": "insufficient", "e1rm_trend_per_week": None,
                "series": [], "trend_band": None}
        self.assertIsNone(forecast.forecast_exercise(prog)["e1rm_in_horizon"])

    def test_plateau_projects_flat(self):
        prog = {"status": "plateau", "e1rm_trend_per_week": 0.0,
                "series": [("2025-01-01", 100.0)], "trend_band": None}
        self.assertEqual(forecast.forecast_exercise(prog)["e1rm_in_horizon"], 100.0)

    def test_calibrated_band_uses_relative_halfwidth(self):
        prog = {"status": "progressing", "e1rm_trend_per_week": 1.0,
                "series": [("2025-01-01", 100.0)], "trend_band": [0.5, 1.5]}
        res = forecast.forecast_exercise(prog, {"rel_halfwidth": 0.1, "level": 0.8})
        lo, hi = res["band"]
        self.assertAlmostEqual(hi - lo, 20.0, places=1)  # anchor 100 * 0.1 * 2 sides


class E1rmRpeTest(unittest.TestCase):
    def test_rpe_none_is_plain_epley(self):
        self.assertEqual(metrics.e1rm(100, 5, False, None), metrics.e1rm(100, 5, False))
        self.assertAlmostEqual(metrics.e1rm(100, 5, False), round(100 * (1 + 5 / 30.0), 2))

    def test_reliable_rpe_raises_estimate(self):
        # RPE 8 -> ~2 RIR -> reps-to-failure 7 -> higher max than reps performed
        self.assertGreater(metrics.e1rm(100, 5, False, 8.0), metrics.e1rm(100, 5, False))

    def test_unreliable_rir_ignored(self):
        # RPE 5 -> 5 RIR exceeds the reliable cap -> falls back to plain Epley
        self.assertEqual(metrics.e1rm(100, 5, False, 5.0), metrics.e1rm(100, 5, False))

    def test_reps_plus_rir_capped(self):
        # 9 reps + 2 RIR = 11 > rep cap -> keep Epley inside its reliable range
        self.assertEqual(metrics.e1rm(100, 9, False, 8.0), metrics.e1rm(100, 9, False))


class BacktestGoldenTest(unittest.TestCase):
    REAL = r"C:\Users\wahib\Downloads\08 - Archives\workout_data.csv"

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        config.DATA_DIR = self.tmp
        config.OUTPUT_DIR = os.path.join(self.tmp, "out")
        config.DB_PATH = os.path.join(self.tmp, "bt.db")

    @unittest.skipUnless(os.path.exists(REAL), "real export not present")
    def test_backtest_metrics(self):
        from workout import db, ingest, individualize, backtest
        conn = db.connect(); db.init(conn)
        ingest.run(conn, self.REAL)
        individualize.refresh_models(conn)
        r = backtest.run(conn)
        rp = r["rep_prediction"]
        self.assertGreater(rp["n"], 50)
        # the anchored predictor must beat the naive baseline
        self.assertTrue(rp["beats_naive"])
        self.assertLessEqual(rp["model_mae"], rp["naive_mae"])
        self.assertGreaterEqual(r["recovery_validity"].get("n", 0), 5)
        # the validity result now carries an advisory cutoff suggestion
        self.assertIn("suggested_cutoffs", r["recovery_validity"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
