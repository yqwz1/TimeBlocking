"""Tests for the gated ACWR + readiness state machine (roadmap #3).

The centerpiece: a thin post-layoff chronic base must read DETRAINED (ramp up),
never SPIKING (back off) — that single gate kills the entire 4.0-artifact class.
Plus the state-machine bands, EWMA gap-decay, the uncouple band, demoted
monotony, and the false-alarm audit.
"""
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from workout import config, fatigue, backtest  # noqa: E402


def _loads(pairs, base="2025-03-01"):
    """{date: load} from (days_before_base, load) pairs; as_of = base."""
    b = datetime.strptime(base, "%Y-%m-%d")
    return {(b - timedelta(days=d)).strftime("%Y-%m-%d"): load for d, load in pairs}


class ClassifyStateTest(unittest.TestCase):
    S = config.settings()   # spike 1.5, low 0.8 -> accumulating band starts 1.25

    def test_spiking(self):
        self.assertEqual(fatigue.classify_state(2.0, self.S)["state"], "spiking")
        self.assertEqual(fatigue.classify_state(2.0, self.S)["level"], "red")

    def test_accumulating(self):
        self.assertEqual(fatigue.classify_state(1.3, self.S)["state"], "accumulating")
        self.assertEqual(fatigue.classify_state(1.3, self.S)["level"], "amber")

    def test_productive(self):
        self.assertEqual(fatigue.classify_state(1.0, self.S)["state"], "productive")
        self.assertEqual(fatigue.classify_state(1.0, self.S)["level"], "green")

    def test_fresh(self):
        self.assertEqual(fatigue.classify_state(0.6, self.S)["state"], "fresh")

    def test_none_is_productive_green(self):
        self.assertEqual(fatigue.classify_state(None, self.S)["level"], "green")


class GateArtifactTest(unittest.TestCase):
    """THE fix: a lone session after a layoff is detrained, not a 4.0 spike."""

    def test_thin_base_is_detrained_not_spiking(self):
        loads = _loads([(2, 100.0), (3, 100.0)])      # 2 active days in 28
        g = fatigue.acwr_gated(loads, "2025-03-01")
        self.assertEqual(g["state"], "detrained")
        self.assertEqual(g["level"], "amber")
        self.assertIsNone(g["acwr"])                  # suppressed, not a number

    def test_old_ungated_acwr_would_have_cried_spike(self):
        # same series: the original formula explodes (the 4.0 we're killing)
        loads = _loads([(2, 100.0), (3, 100.0)])
        old = backtest._raw_acwr(loads, "2025-03-01", config.settings())
        self.assertIsNotNone(old)
        self.assertGreater(old, config.settings()["acwr_spike"])

    def test_adequate_base_real_spike_still_flags(self):
        # a full base for weeks, then a 5x acute jump -> a genuine spike survives
        loads = {}
        for d in range(7, 35):
            loads.update(_loads([(d, 12.0)]))
        for d in range(0, 7):
            loads.update(_loads([(d, 60.0)]))
        g = fatigue.acwr_gated(loads, "2025-03-01")
        self.assertEqual(g["state"], "spiking")
        self.assertEqual(g["level"], "red")
        self.assertIsNotNone(g["acwr"])

    def test_adequate_steady_base_is_productive(self):
        loads = {}
        for d in range(0, 35):
            loads.update(_loads([(d, 20.0)]))         # steady daily load
        g = fatigue.acwr_gated(loads, "2025-03-01")
        self.assertIn(g["state"], ("productive", "fresh"))
        self.assertEqual(g["level"], "green")


class ChronicAdequacyTest(unittest.TestCase):
    S = config.settings()

    def test_thin_coverage_inadequate(self):
        adequate, d_chr, _ = fatigue.chronic_adequacy(
            _loads([(2, 100.0), (3, 100.0)]), "2025-03-01", self.S, l_ref=50.0)
        self.assertFalse(adequate)
        self.assertEqual(d_chr, 2)

    def test_low_level_inadequate(self):
        # enough days, but far below the user's established norm
        loads = {}
        for d in range(0, 20):
            loads.update(_loads([(d, 1.0)]))          # 20 active days, tiny load
        adequate, d_chr, l_chr = fatigue.chronic_adequacy(
            loads, "2025-03-01", self.S, l_ref=100.0)  # norm is 100x bigger
        self.assertGreaterEqual(d_chr, self.S["acwr_chronic_min_days"])
        self.assertFalse(adequate)                    # fails the level half

    def test_adequate_passes(self):
        loads = {}
        for d in range(0, 28):
            loads.update(_loads([(d, 20.0)]))
        adequate, _, _ = fatigue.chronic_adequacy(loads, "2025-03-01", self.S, l_ref=20.0)
        self.assertTrue(adequate)


class EwmaAndBandTest(unittest.TestCase):
    def test_ewma_decays_across_gap_no_blowup(self):
        loads = _loads([(40, 100.0)])                 # one load 40 days ago
        v = fatigue.ewma_load(loads, min(loads), "2025-03-01", 7)
        self.assertGreaterEqual(v, 0.0)
        self.assertLess(v, 5.0)                        # decayed far down, finite

    def test_date_band_excludes_acute_window(self):
        band = fatigue._date_band("2025-03-01", 28, 7)
        self.assertEqual(len(band), 21)               # days 7..27 back
        self.assertNotIn("2025-03-01", band)          # acute (today) excluded
        self.assertIn("2025-02-22", band)             # 7 days back is the band edge


class AssessStateMachineDbTest(unittest.TestCase):
    """End-to-end: a gappy store reads amber/detrained, NOT red 'back off'."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        config.DATA_DIR = self.tmp
        config.OUTPUT_DIR = os.path.join(self.tmp, "out")
        config.DB_PATH = os.path.join(self.tmp, "acwr.db")
        from workout import db
        self.conn = db.connect()
        db.init(self.conn)
        muscle = config.exercise_info("Bench Press (Barbell)")["primary"]
        base = datetime(2025, 3, 1)
        # three sessions ~2 months ago, a long gap, then one lone recent session
        for off in (60, 58, 56, 1):
            day = (base - timedelta(days=off)).strftime("%Y-%m-%d")
            self.conn.execute(
                "INSERT INTO sets (start_time, exercise_title, primary_muscle, "
                "set_index, reps_clean, weight_raw, volume, epoch, is_working, date) "
                "VALUES (?,?,?,0,5,100,30.0,0,1,?)",
                (f"{day}T20:00:00", "Bench Press (Barbell)", muscle, day))
        self.conn.commit()
        self.as_of = base.strftime("%Y-%m-%d")

    def test_returning_reads_detrained_not_red(self):
        a = fatigue.assess(self.conn, self.as_of)
        self.assertNotEqual(a["readiness"], "red")    # the artifact can't reach red
        self.assertEqual(a["readiness_state"], "detrained")
        self.assertIsNone(a["acwr_global"])
        self.assertIn("ramp up", a["reasons"][0])

    def test_gate_audit_shape(self):
        out = backtest.acwr_gate_audit(self.conn)
        self.assertIn("post_gap_old_spike_flags", out)
        self.assertIn("gate_eliminates_artifact", out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
