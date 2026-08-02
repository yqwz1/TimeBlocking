"""Tests for the Fitness-Fatigue 'Form' model (design 01-fitness-fatigue-form-model).

Covers the three properties the design hangs on:
  1. Gap robustness - after a layoff Form settles near 0 (NOT an ACWR-style spike).
  2. The pre-update 'no peek' Form (first day == 0; fast fatigue dominates right
     after a hard day, then decays below fitness so Form turns positive).
  3. The leakage-free validator: a perfectly-trending lift yields ~0 residuals
     (the detrending works), while a real over-trend bump shows up as Y>0.
Plus a DB-backed smoke test that the model + backtest.form_validity run end-to-end.
"""
import math
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from workout import config, form, backtest, volume, fatigue  # noqa: E402


class DensifyTest(unittest.TestCase):
    def test_fills_gaps_with_zero(self):
        out = list(form.densify_daily([("2025-01-01", 5.0), ("2025-01-04", 9.0)]))
        self.assertEqual([d for d, _ in out],
                         ["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04"])
        self.assertEqual([v for _, v in out], [5.0, 0.0, 0.0, 9.0])

    def test_sums_duplicate_dates(self):
        out = list(form.densify_daily([("2025-01-01", 5.0), ("2025-01-01", 3.0)]))
        self.assertEqual(out, [("2025-01-01", 8.0)])

    def test_empty_yields_nothing(self):
        self.assertEqual(list(form.densify_daily([])), [])


class FormSeriesTest(unittest.TestCase):
    def test_smoothing_factors_match_design(self):
        # alpha = 1 - exp(-1/tau); the day-after-load traces must equal alpha*load
        ser = form.form_series([("2025-01-01", 100.0)])
        _, ctl, atl, frm = ser[0]
        self.assertEqual(frm, 0.0)                       # first day pre-update == 0
        self.assertAlmostEqual(ctl, (1 - math.exp(-1 / 42.0)) * 100.0)
        self.assertAlmostEqual(atl, (1 - math.exp(-1 / 7.0)) * 100.0)

    def test_fatigue_dominates_right_after_a_hard_day(self):
        # one big day then rest: the day-after Form is NEGATIVE because the fast
        # fatigue trace (tau 7) caught more of the load than fitness (tau 42).
        ser = form.form_series([("2025-01-01", 100.0), ("2025-01-10", 0.0)])
        self.assertLess(ser[1][3], 0.0)

    def test_gap_robust_form_settles_near_zero_not_spiking(self):
        # THE design goal: 60 rest days after a single load -> both traces decay,
        # Form ends small and positive (fresh), never a division blow-up.
        ser = form.form_series([("2025-01-01", 100.0), ("2025-03-15", 0.0)])
        self.assertGreater(len(ser), 60)
        last_form = ser[-1][3]
        self.assertGreater(last_form, 0.0)              # recovered -> fresh
        self.assertLess(abs(last_form), 5.0)            # but settled near 0
        # every value finite (no ACWR near-zero-denominator artifact)
        self.assertTrue(all(math.isfinite(f) for *_, f in ser))

    def test_form_by_date_lookup(self):
        loads = [("2025-01-01", 100.0), ("2025-01-05", 50.0)]
        fbd = form.form_by_date(loads)
        ser = form.form_series(loads)
        self.assertEqual(fbd[ser[2][0]], ser[2][3])


class ReadinessTest(unittest.TestCase):
    HIST = list(range(-5, 6))   # mean 0, sample sd ~3.32

    def test_high_form_recovers_well(self):
        state, z = form.readiness_from_form(5, self.HIST)
        self.assertEqual(state, "recovering_well")
        self.assertGreaterEqual(z, 0.5)

    def test_low_form_under_recovering(self):
        state, z = form.readiness_from_form(-5, self.HIST)
        self.assertEqual(state, "under_recovering")
        self.assertLessEqual(z, -0.5)

    def test_mid_form_borderline(self):
        state, _ = form.readiness_from_form(0, self.HIST)
        self.assertEqual(state, "borderline")

    def test_too_little_history_is_borderline(self):
        self.assertEqual(form.readiness_from_form(99, [1.0]), ("borderline", 0.0))


class LeakageFreePairsTest(unittest.TestCase):
    """The honesty core: residuals must be measured against the lift's OWN prior
    trend, so a purely linear riser produces ~0 outcome (no manufactured signal)."""

    CFG = {"embargo_days": 3, "horizon_days": 21, "min_points": 4,
           "trail_sessions": 6}

    def _weekly(self, e1rms, base="2025-01-06"):
        # real calendar weekly sessions from `base` with the given e1rm values
        base_dt = datetime.strptime(base, "%Y-%m-%d")
        return [((base_dt + timedelta(days=7 * i)).strftime("%Y-%m-%d"), e)
                for i, e in enumerate(e1rms)]

    def test_pure_linear_trend_gives_zero_residuals(self):
        ser = self._weekly([100 + 2 * i for i in range(10)])   # perfectly linear
        forms = {d: 0.0 for d, _ in ser}
        pairs = form.leakage_free_pairs(ser, forms, self.CFG)
        self.assertTrue(pairs)
        self.assertTrue(all(abs(y) < 1e-6 for _, y in pairs))  # trend removed

    def test_predictor_is_the_form_as_of_that_session(self):
        ser = self._weekly([100 + 2 * i for i in range(10)])
        forms = {d: float(idx) for idx, (d, _) in enumerate(ser)}
        pairs = form.leakage_free_pairs(ser, forms, self.CFG)
        # first window is at session index min_points=4 -> X should be 4.0
        self.assertEqual(pairs[0][0], 4.0)

    def test_above_trend_bump_shows_positive_residual(self):
        e = [100 + 2 * i for i in range(10)]
        e[5] += 20                                             # one over-trend jump
        ser = self._weekly(e)
        forms = {d: 0.0 for d, _ in ser}
        pairs = form.leakage_free_pairs(ser, forms, self.CFG)
        # the window whose OUTCOME is session 5 must carry a positive residual
        self.assertTrue(any(y > 5 for _, y in pairs))

    def test_skips_when_no_form_for_session(self):
        ser = self._weekly([100 + 2 * i for i in range(10)])
        pairs = form.leakage_free_pairs(ser, {}, self.CFG)     # no form lookup
        self.assertEqual(pairs, [])


class FormValidityDbTest(unittest.TestCase):
    """End-to-end: the model + backtest.form_validity run against a real store."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        config.DATA_DIR = self.tmp
        config.OUTPUT_DIR = os.path.join(self.tmp, "out")
        config.DB_PATH = os.path.join(self.tmp, "form.db")
        from workout import db
        self.conn = db.connect()
        db.init(self.conn)
        self.muscle = config.exercise_info("Bench Press (Barbell)")["primary"]
        # weekly bench sessions with rising e1rm + volume so the validator has a
        # representative lift, an e1rm series and a daily load to build Form from.
        base = datetime(2025, 1, 6)
        for i in range(8):
            day = (base + timedelta(days=7 * i)).strftime("%Y-%m-%d")
            self.conn.execute(
                "INSERT INTO sets (start_time, exercise_title, primary_muscle, "
                "set_index, reps_clean, weight_raw, e1rm, volume, epoch, "
                "is_working, date) VALUES (?,?,?,?,?,?,?,?,0,1,?)",
                (f"{day}T20:00:00", "Bench Press (Barbell)", self.muscle,
                 0, 5, 100 + i, 110.0 + i, 30.0, day))
        self.conn.commit()

    def test_daily_muscle_load_and_series(self):
        loads = form.daily_muscle_load(self.conn, self.muscle)
        self.assertEqual(len(loads), 8)
        ser = form.form_series(loads)
        self.assertGreater(len(ser), 8)                # densified across the gaps
        self.assertEqual(ser[0][3], 0.0)

    def test_form_validity_runs_and_is_shaped(self):
        fv = backtest.form_validity(self.conn)
        self.assertIn("n", fv)
        # 8 sessions -> too few pooled windows to clear min_n; must degrade cleanly
        if fv["n"] < fv.get("success_bar", {}).get("min_n", 8):
            self.assertIn("note", fv)
        else:
            self.assertIn("corr_form_vs_residual", fv)

    def test_run_includes_form_validity_key(self):
        self.assertIn("form_validity", backtest.run(self.conn))


# --------------------------------------------------------------------------
# Section 5 live-wiring: Form replaces the acwr+dropoff fatigue sub-read,
# ACWR is gated against the gap blow-up, and confidence keys off the Form r.
# --------------------------------------------------------------------------
class FormSignalTest(unittest.TestCase):
    def test_neutral_z_is_zero(self):
        self.assertEqual(volume._form_signal(0.0), 0.0)

    def test_fatigued_scales_negative_and_clips(self):
        self.assertEqual(volume._form_signal(-2.0), -1.0)
        self.assertEqual(volume._form_signal(-9.0), -1.0)     # clipped at -1

    def test_fresh_is_mild_positive_and_caps(self):
        s = volume._form_signal(1.0)
        self.assertGreater(s, 0.0)
        self.assertLessEqual(s, 0.3)
        self.assertEqual(volume._form_signal(9.0), 0.3)       # capped at +0.3

    def test_none_passes_through(self):
        self.assertIsNone(volume._form_signal(None))


class FormRecoveryWeightsTest(unittest.TestCase):
    W = {"perf": 0.5, "acwr": 0.3, "dropoff": 0.2, "rpe": 0.2}

    def test_no_rpe_splits_perf_and_form(self):
        wn = volume._form_recovery_weights(self.W, rpe_on=False)
        self.assertAlmostEqual(wn["perf"], 0.5)
        self.assertAlmostEqual(wn["form"], 0.5)               # whole fatigue half
        self.assertEqual(wn["rpe"], 0.0)
        self.assertAlmostEqual(sum(wn.values()), 1.0)

    def test_rpe_takes_its_fraction_from_the_fatigue_half(self):
        wn = volume._form_recovery_weights(self.W, rpe_on=True)
        self.assertAlmostEqual(wn["perf"], 0.5)
        self.assertAlmostEqual(wn["form"], 0.3)               # 1 - 0.5 - 0.2
        self.assertAlmostEqual(wn["rpe"], 0.2)
        self.assertAlmostEqual(sum(wn.values()), 1.0)


class ConfidenceFromFormTest(unittest.TestCase):
    def test_reads_form_residual_corr_weak_is_low(self):
        lvl, _ = volume.confidence_from_validity(
            {"n": 200, "corr_form_vs_residual": 0.077, "monotone_ordering": False})
        self.assertEqual(lvl, "low")

    def test_strong_form_corr_is_high(self):
        lvl, _ = volume.confidence_from_validity(
            {"n": 200, "corr_form_vs_residual": 0.5, "monotone_ordering": True})
        self.assertEqual(lvl, "high")

    def test_falls_back_to_legacy_key(self):
        lvl, _ = volume.confidence_from_validity(
            {"n": 200, "corr_fatigue_signals_vs_next_change": 0.5,
             "monotone_ordering": True})
        self.assertEqual(lvl, "high")


class AcwrGateTest(unittest.TestCase):
    """The 4.0 artifact: a near-empty chronic window must SUPPRESS the ratio."""

    def _loads(self, active_days, end="2025-03-01"):
        end_dt = datetime.strptime(end, "%Y-%m-%d")
        return {(end_dt - timedelta(days=i)).strftime("%Y-%m-%d"): 100.0
                for i in range(active_days)}

    def test_thin_chronic_returns_none(self):
        # 2 active days in 28 -> raw ratio would be 4.0; the gate returns None
        self.assertIsNone(fatigue.acwr(self._loads(2), "2025-03-01"))

    def test_healthy_chronic_returns_ratio(self):
        self.assertIsNotNone(fatigue.acwr(self._loads(20), "2025-03-01"))

    def test_active_days_counts_loaded_days(self):
        self.assertEqual(fatigue._active_days(self._loads(5), "2025-03-01", 28), 5)


class RecoveryByMuscleFormTest(unittest.TestCase):
    """End-to-end: the per-muscle recovery read is now Form-driven (form_z set,
    fatigue from Form), momentum stays separate, and a missing ACWR is fine."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        config.DATA_DIR = self.tmp
        config.OUTPUT_DIR = os.path.join(self.tmp, "out")
        config.DB_PATH = os.path.join(self.tmp, "recform.db")
        from workout import db
        self.conn = db.connect()
        db.init(self.conn)
        self.muscle = config.exercise_info("Bench Press (Barbell)")["primary"]
        base = datetime(2025, 1, 6)
        for i in range(8):
            day = (base + timedelta(days=7 * i)).strftime("%Y-%m-%d")
            self.conn.execute(
                "INSERT INTO sets (start_time, exercise_title, primary_muscle, "
                "set_index, reps_clean, weight_raw, e1rm, volume, epoch, "
                "is_working, date) VALUES (?,?,?,?,?,?,?,?,0,1,?)",
                (f"{day}T20:00:00", "Bench Press (Barbell)", self.muscle,
                 0, 5, 100.0 + i, 110.0 + i, 30.0, day))
        self.conn.commit()
        self.as_of = (base + timedelta(days=7 * 7 + 1)).strftime("%Y-%m-%d")
        self.prog = {"Bench Press (Barbell)":
                     {"status": "progressing", "e1rm_trend_per_week": 0.5}}

    def test_form_drives_the_fatigue_read(self):
        rec = volume.recovery_by_muscle(self.conn, self.as_of, self.prog, {})
        d = rec[self.muscle]
        self.assertNotEqual(d["recovery"], "insufficient_data")
        self.assertIsNotNone(d["score"])
        self.assertIsNotNone(d["form_z"])          # Form computed and exposed
        self.assertIsNotNone(d["fatigue"])         # fatigue half is Form-based
        self.assertEqual(d["momentum"], 1.0)       # 1/1 lift progressing, separate
        self.assertIsNone(d["acwr"])               # none passed -> no blow-up


if __name__ == "__main__":
    unittest.main(verbosity=2)
