"""Trust-focused tests for the volume & recovery refinements:
frequency-aware volume (EWMA), confidence-gated recommendations, the same-load
drop-off guard, momentum/fatigue split, and advisory cutoff calibration.
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from workout import config  # noqa: E402
from workout import volume, balance, backtest  # noqa: E402


class DecideConfidenceTest(unittest.TestCase):
    """Low confidence must fall back to landmarks; high reproduces old behavior."""

    def test_default_confidence_matches_high(self):
        self.assertEqual(volume._decide(12, 10, 18, 25, "recovering_well"),
                         volume._decide(12, 10, 18, 25, "recovering_well", "high"))

    def test_low_confidence_holds_instead_of_cutting(self):
        # MEV-MAV, poor recovery, but the recovery read is untrustworthy -> hold
        tgt, action, _ = volume._decide(12, 10, 18, 25, "under_recovering", "low")
        self.assertEqual(tgt, 12)
        self.assertEqual(action, "hold")

    def test_low_confidence_does_not_add_on_good_recovery(self):
        tgt, action, _ = volume._decide(12, 10, 18, 25, "recovering_well", "low")
        self.assertEqual(tgt, 12)
        self.assertEqual(action, "hold")

    def test_high_confidence_still_cuts_on_poor_recovery(self):
        tgt, action, _ = volume._decide(12, 10, 18, 25, "under_recovering", "high")
        self.assertLessEqual(tgt, 12)
        self.assertIn(action, ("reduce", "hold"))

    def test_low_confidence_still_ramps_below_mev(self):
        # below MEV we always bring up to the minimum, regardless of confidence
        tgt, action, _ = volume._decide(4, 10, 18, 25, "under_recovering", "low")
        self.assertEqual(tgt, 10)
        self.assertEqual(action, "raise_to_MEV")

    def test_low_confidence_still_deloads_over_mrv(self):
        tgt, action, _ = volume._decide(27, 10, 18, 25, "recovering_well", "low")
        self.assertLess(tgt, 27)
        self.assertEqual(action, "deload")


class ConfidenceMappingTest(unittest.TestCase):
    def test_weak_corr_is_low(self):
        lvl, _ = volume.confidence_from_validity(
            {"n": 50, "corr_fatigue_signals_vs_next_change": 0.06,
             "monotone_ordering": False})
        self.assertEqual(lvl, "low")

    def test_small_n_is_low(self):
        lvl, _ = volume.confidence_from_validity({"n": 3})
        self.assertEqual(lvl, "low")

    def test_strong_corr_is_high(self):
        lvl, _ = volume.confidence_from_validity(
            {"n": 50, "corr_fatigue_signals_vs_next_change": 0.5,
             "monotone_ordering": True})
        self.assertEqual(lvl, "high")

    def test_none_does_not_overreach(self):
        # not evaluated -> keep today's behavior, don't claim low or high
        lvl, _ = volume.confidence_from_validity(None)
        self.assertEqual(lvl, "moderate")


class SessionDropoffTest(unittest.TestCase):
    def test_same_load_drop_counts(self):
        self.assertAlmostEqual(volume.session_dropoff([100, 100], [10, 8], 0.10),
                               0.2, places=6)

    def test_lighter_backoff_excluded(self):
        # a single top set + a much lighter back-off leaves <2 same-load sets
        self.assertIsNone(volume.session_dropoff([100, 60], [10, 12], 0.10))

    def test_backoff_does_not_inflate_fatigue(self):
        # 100x10, 100x9 (real fatigue), 60x12 back-off -> only the same-load
        # pair counts (10->9), NOT the raw first-vs-last (which would be negative)
        self.assertAlmostEqual(volume.session_dropoff([100, 100, 60], [10, 9, 12], 0.10),
                               0.1, places=6)

    def test_missing_weight_falls_back_to_raw(self):
        self.assertAlmostEqual(volume.session_dropoff([None, None], [10, 8], 0.10),
                               0.2, places=6)


class FitCutoffsTest(unittest.TestCase):
    def test_returns_numeric_cutoffs(self):
        scores = [-0.9, -0.8, -0.6, -0.4, -0.2, 0.0, 0.2, 0.4, 0.6, 0.8, 0.9, 1.0]
        outcomes = [s * 5 for s in scores]  # perfectly monotone
        res = backtest._fit_cutoffs(scores, outcomes, {"well": 0.2, "under": -0.2})
        self.assertIsNotNone(res)
        self.assertIsInstance(res["suggested"]["well"], float)
        self.assertIsInstance(res["suggested"]["under"], float)
        self.assertGreaterEqual(res["suggested_spread"], 0)
        self.assertIn("improves_backtest", res)

    def test_too_few_returns_none(self):
        self.assertIsNone(
            backtest._fit_cutoffs([0, 1, 2], [0, 1, 2], {"well": 0.2, "under": -0.2}))

    def test_acwr_duplicate_removed(self):
        # the backtest must reuse fatigue.acwr, not its own copy
        self.assertFalse(hasattr(backtest, "_acwr_at"))


class RpeSignalTest(unittest.TestCase):
    """The RPE fatigue read: gated until enough data, negative when grinding,
    mildly positive with reps in reserve, and byte-identical weights when off."""

    RP = {"rpe_signal": {"neutral": 8.0, "hard": 10.0, "light": 6.0,
                         "creep_bad": 2.0, "creep_blend": 0.4, "min_sets": 2}}

    def test_none_below_min_sets(self):
        self.assertIsNone(volume._rpe_signal(
            {"mean_top_rpe": 10.0, "creep": None, "n_sets": 1}, self.RP))

    def test_none_when_no_info(self):
        self.assertIsNone(volume._rpe_signal(None, self.RP))

    def test_grinding_is_negative(self):
        s = volume._rpe_signal({"mean_top_rpe": 10.0, "creep": None, "n_sets": 4}, self.RP)
        self.assertEqual(s, -1.0)

    def test_reps_in_reserve_is_mild_positive(self):
        s = volume._rpe_signal({"mean_top_rpe": 6.0, "creep": None, "n_sets": 4}, self.RP)
        self.assertGreater(s, 0)
        self.assertLessEqual(s, 0.3)

    def test_creep_pushes_more_negative(self):
        flat = volume._rpe_signal({"mean_top_rpe": 8.0, "creep": 0.0, "n_sets": 4}, self.RP)
        rising = volume._rpe_signal({"mean_top_rpe": 8.0, "creep": 2.0, "n_sets": 4}, self.RP)
        self.assertLess(rising, flat)

    def test_weights_off_reproduce_original_mix(self):
        w = {"perf": 0.5, "acwr": 0.3, "dropoff": 0.2, "rpe": 0.2}
        wn = volume._recovery_weights(w, rpe_on=False)
        self.assertAlmostEqual(wn["perf"], 0.5)
        self.assertAlmostEqual(wn["acwr"], 0.3)
        self.assertAlmostEqual(wn["dropoff"], 0.2)
        self.assertEqual(wn["rpe"], 0.0)

    def test_weights_on_sum_to_one_and_reserve_rpe_fraction(self):
        w = {"perf": 0.5, "acwr": 0.3, "dropoff": 0.2, "rpe": 0.2}
        wn = volume._recovery_weights(w, rpe_on=True)
        self.assertAlmostEqual(sum(wn.values()), 1.0)
        self.assertAlmostEqual(wn["rpe"], 0.2)
        # the other three keep their 5:3:2 ratio within the remaining 0.8
        self.assertAlmostEqual(wn["perf"], 0.4)
        self.assertAlmostEqual(wn["acwr"], 0.24)
        self.assertAlmostEqual(wn["dropoff"], 0.16)


class EwmaBalanceTest(unittest.TestCase):
    """Frequency-aware 'now': a recent surge after empty weeks must read higher
    on the EWMA than on the flat 4-week mean, and active_weeks must reflect it."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        config.DATA_DIR = self.tmp
        config.OUTPUT_DIR = os.path.join(self.tmp, "out")
        config.DB_PATH = os.path.join(self.tmp, "ewma.db")
        from workout import db
        self.conn = db.connect()
        db.init(self.conn)
        # 8 chest sets in the most recent week only, three prior weeks empty
        for i in range(8):
            self.conn.execute(
                "INSERT INTO sets (start_time, exercise_title, set_index, "
                "is_working, date) VALUES (?,?,?,1,?)",
                ("2025-01-30T20:00:00", "Bench Press (Barbell)", i, "2025-01-30"))
        self.conn.commit()
        self.muscle = config.exercise_info("Bench Press (Barbell)")["primary"]

    def test_ewma_outweighs_flat_mean_on_recent_surge(self):
        wb = balance.weekly_balance(self.conn, weeks=4, as_of="2025-02-01")
        d = wb[self.muscle]
        self.assertEqual(d["sets_per_week"], 2.0)          # flat: 8 over 4 weeks
        self.assertEqual(d["sets_recent_7d"], 8.0)
        self.assertEqual(d["active_weeks_4wk"], 1)
        self.assertGreater(d["sets_per_week_ewma"], d["sets_per_week"])

    def test_buckets_place_sets_in_the_recent_week(self):
        bk = balance.weekly_buckets(self.conn, weeks=4, as_of="2025-02-01")
        self.assertEqual(bk[self.muscle][0], 8.0)          # most-recent bucket
        self.assertEqual(sum(bk[self.muscle][1:]), 0.0)    # older weeks empty


class RpeByMuscleTest(unittest.TestCase):
    """End-to-end: top-set RPE + matched-load creep extracted from real rows."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        config.DATA_DIR = self.tmp
        config.OUTPUT_DIR = os.path.join(self.tmp, "out")
        config.DB_PATH = os.path.join(self.tmp, "rpe.db")
        from workout import db
        self.conn = db.connect()
        db.init(self.conn)
        self.muscle = config.exercise_info("Bench Press (Barbell)")["primary"]
        # one session, 3 same-load top sets, RPE climbing 8 -> 9 -> 10 (creep +2)
        for i, rpe in enumerate((8.0, 9.0, 10.0)):
            self.conn.execute(
                "INSERT INTO sets (start_time, exercise_title, primary_muscle, "
                "set_index, reps_clean, weight_raw, rpe, is_working, date) "
                "VALUES (?,?,?,?,?,?,?,1,?)",
                ("2025-02-01T20:00:00", "Bench Press (Barbell)", self.muscle,
                 i, 5, 100.0, rpe, "2025-02-01"))
        self.conn.commit()

    def test_extracts_top_rpe_and_creep(self):
        info = volume._rpe_by_muscle(self.conn, "2025-02-02")[self.muscle]
        self.assertEqual(info["n_sets"], 3)
        self.assertEqual(info["mean_top_rpe"], 10.0)   # heaviest set = the RPE-10 one
        self.assertAlmostEqual(info["creep"], 2.0)     # 10 - 8 at matched load

    def test_lighter_backoff_excluded_from_creep(self):
        # add a much lighter back-off at low RPE; it must not count toward creep
        self.conn.execute(
            "INSERT INTO sets (start_time, exercise_title, primary_muscle, "
            "set_index, reps_clean, weight_raw, rpe, is_working, date) "
            "VALUES (?,?,?,?,?,?,?,1,?)",
            ("2025-02-01T20:00:00", "Bench Press (Barbell)", self.muscle,
             3, 8, 60.0, 6.0, "2025-02-01"))
        self.conn.commit()
        info = volume._rpe_by_muscle(self.conn, "2025-02-02")[self.muscle]
        self.assertAlmostEqual(info["creep"], 2.0)     # still 10 - 8, back-off ignored


if __name__ == "__main__":
    unittest.main(verbosity=2)
