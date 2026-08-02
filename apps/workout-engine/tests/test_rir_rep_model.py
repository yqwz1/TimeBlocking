"""Tests for folding RIR into the live in-band rep model (design 05).

Core claims:
  1. median_target_rir = the user's typical effort: median of RELIABLE RIRs,
     falling back to the default until enough reliable-RIR sets exist.
  2. predict_reps_at_effort anchors on CAPACITY r* = reps + reliable RIR, projects
     along the slope, and predicts performed reps at the intended effort
     (capacity - target_rir). A censored anchor (no reliable RIR) is byte-
     identical to predict_reps_anchored; matched load+effort equals naive; the
     interval inflates by the RIR noise; a supplied pooled slope is honored.
  3. Flag gating: prediction_for is byte-identical to the raw-reps path when the
     model is OFF, and switches to predict-at-effort (annotated basis +
     target_rir) when ON with a reliable anchor.
  4. weight_verdict consumes the effort-aware reps; next_target surfaces the RIR.
  5. The walk-forward validator is well-formed and the LEGACY bucket (no reliable
     anchor RIR) is byte-identical baseline-vs-effort by construction.
"""
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from workout import (config, individualize as ind,  # noqa: E402
                     autoregulation as ar, backtest)


def _cfg(enabled):
    c = ind._rir_rep_cfg()
    c["enabled"] = enabled
    return c


class MedianTargetRirTest(unittest.TestCase):
    def test_median_of_reliable(self):
        # RIR from RPE 8/8/7 = 2/2/3 -> median 2
        pts = [(8, 8.0), (6, 8.0), (5, 7.0)]
        self.assertEqual(ind.median_target_rir(pts, 2.0), 2.0)

    def test_ignores_unreliable_and_falls_back(self):
        # only ONE reliable (RPE 8 -> RIR 2); the others are unreliable
        # (reps>12, and RPE 4 -> RIR 6 > max) -> too few -> default
        pts = [(8, 8.0), (15, 9.0), (5, 4.0)]
        self.assertEqual(ind.median_target_rir(pts, 1.5), 1.5)

    def test_empty_is_default(self):
        self.assertEqual(ind.median_target_rir([], 2.0), 2.0)


class PredictAtEffortTest(unittest.TestCase):
    MODEL = {"slope": -0.2, "resid_std": 1.0}

    def test_reliable_anchor_predicts_at_effort(self):
        # last 8 reps @ RPE 8 (RIR 2) -> capacity 10; same load, target RIR 2
        pt, lo, hi, eff = ind.predict_reps_at_effort(
            self.MODEL, 100, 8, 8.0, 100, 2.0, rir_var=1.0)
        self.assertTrue(eff)
        self.assertAlmostEqual(pt, 8.0)                 # 10 capacity - 2 effort = 8

    def test_lighter_load_projects_capacity_then_drops_effort(self):
        # capacity 10 at 100kg, slope -0.2 -> at 90kg capacity 12; minus RIR 2 -> 10
        pt, _, _, eff = ind.predict_reps_at_effort(
            self.MODEL, 100, 8, 8.0, 90, 2.0, rir_var=1.0)
        self.assertTrue(eff)
        self.assertAlmostEqual(pt, 10.0)

    def test_near_failure_anchor_lowers_effort_prediction(self):
        # took it to failure (RPE 10, RIR 0) for 5; at normal RIR 2 you'd do 3
        pt, _, _, eff = ind.predict_reps_at_effort(
            self.MODEL, 100, 5, 10.0, 100, 2.0, rir_var=1.0)
        self.assertTrue(eff)
        self.assertAlmostEqual(pt, 3.0)

    def test_censored_anchor_is_byte_identical(self):
        eff = ind.predict_reps_at_effort(self.MODEL, 100, 8, None, 90, 2.0, rir_var=1.0)
        raw = ind.predict_reps_anchored(self.MODEL, 100, 8, 90)
        self.assertFalse(eff[3])
        self.assertEqual((eff[0], eff[1], eff[2]), raw)   # exact same triple

    def test_unreliable_rpe_is_censored(self):
        # RPE 5 -> RIR 5 > max -> not reliable -> censored path
        _, _, _, eff = ind.predict_reps_at_effort(
            self.MODEL, 100, 8, 5.0, 100, 2.0, rir_var=1.0)
        self.assertFalse(eff)

    def test_interval_inflated_by_rir_noise(self):
        _, lo, hi, _ = ind.predict_reps_at_effort(
            self.MODEL, 100, 8, 8.0, 100, 2.0, rir_var=1.0)
        # se = sqrt(resid_std^2 + rir_var) = sqrt(2)
        self.assertAlmostEqual(hi - lo, 2 * 1.96 * (2 ** 0.5), places=6)

    def test_pooled_slope_honored(self):
        # pooled slope -0.5: capacity 10 at 100 -> at 90 capacity 15; minus 2 -> 13
        pt, lo, hi, eff = ind.predict_reps_at_effort(
            self.MODEL, 100, 8, 8.0, 90, 2.0, pooled=(-0.5, 2.0), rir_var=1.0)
        self.assertAlmostEqual(pt, 13.0)
        self.assertAlmostEqual(hi - lo, 2 * 1.96 * (5 ** 0.5), places=6)  # se uses pooled SE


class RirRepDbTest(unittest.TestCase):
    """A spread lift logged with recent RPE: target_rir reads the median effort,
    the flag toggles predict-at-effort, and the validator runs."""

    EX = "Bench Press"

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        config.DATA_DIR = self.tmp
        config.OUTPUT_DIR = os.path.join(self.tmp, "out")
        config.DB_PATH = os.path.join(self.tmp, "rir.db")
        from workout import db
        self.conn = db.connect()
        db.init(self.conn)
        self.muscle = config.exercise_info(self.EX)["primary"]
        base = datetime(2026, 3, 2)
        # varied loads, falling reps, all RPE 8 (RIR 2) EXCEPT the last session,
        # taken to RPE 10 (RIR 0) -> its capacity anchor differs from the median.
        rows = [(60, 12, 8.0), (64, 11, 8.0), (68, 10, 8.0), (72, 9, 8.0),
                (76, 8, 8.0), (80, 7, 8.0), (84, 6, 8.0), (88, 5, 10.0)]
        for i, (w, r, rpe) in enumerate(rows):
            day = (base + timedelta(days=5 * i)).strftime("%Y-%m-%d")
            self.conn.execute(
                "INSERT INTO sets (start_time, exercise_title, primary_muscle, "
                "set_index, weight_raw, reps_clean, rpe, epoch, is_working, date) "
                "VALUES (?,?,?,0,?,?,?,0,1,?)",
                (f"{day}T18:00:00", self.EX, self.muscle, w, r, rpe, day))
        self.conn.commit()
        self.last_w, self.last_r = 88, 5

    def test_target_rir_is_median_effort(self):
        # seven RIR-2 sets + one RIR-0 -> median 2
        self.assertEqual(ind.target_rir(self.conn, self.EX, 0), 2.0)

    def test_flag_off_is_raw_reps_path(self):
        pred = ar.prediction_for(self.conn, self.EX, 0, float(self.last_w))
        self.assertNotIn("at_effort", pred)
        # raw anchored prediction at the same load == last reps (delta 0)
        self.assertAlmostEqual(pred["reps"], float(self.last_r), delta=0.6)

    def test_flag_on_predicts_at_effort(self):
        on = _cfg(True)
        with mock.patch.object(ind, "_rir_rep_cfg", lambda: on):
            pred = ar.prediction_for(self.conn, self.EX, 0, float(self.last_w))
        self.assertTrue(pred["at_effort"])
        self.assertEqual(pred["target_rir"], 2.0)
        self.assertIn("at RIR", pred["basis"])
        # last set went to failure (RIR 0) for 5; at the median RIR-2 effort the
        # prediction drops by ~2 vs the raw 'same as last' path.
        self.assertAlmostEqual(pred["reps"], float(self.last_r) - 2.0, delta=0.6)

    def test_flag_on_shifts_weight_verdict(self):
        on = _cfg(True)
        with mock.patch.object(ind, "_rir_rep_cfg", lambda: on):
            v = ar.weight_verdict(self.conn, self.EX, 0, float(self.last_w))
        # ~3 predicted performed reps at RIR 2 is below the 5-8 range -> too heavy
        self.assertEqual(v["verdict"], "too_heavy")
        self.assertTrue(v["prediction"]["at_effort"])

    def test_next_target_surfaces_predicted_rir(self):
        on = _cfg(True)
        prog = {"epoch": 0, "status": "progressing"}
        with mock.patch.object(ind, "_rir_rep_cfg", lambda: on):
            t = ar.next_target(self.conn, self.EX, prog)
        if t.get("weight") is not None and "predicted_reps" in t:
            self.assertEqual(t.get("predicted_at_rir"), 2.0)

    def test_validator_shape_and_legacy_identity(self):
        # add a NO-RPE lift so the LEGACY bucket (censored anchors) is populated
        base = datetime(2026, 3, 2)
        legacy = [(50, 10), (54, 9), (58, 9), (62, 8), (66, 7), (70, 6), (74, 6)]
        for i, (w, r) in enumerate(legacy):
            day = (base + timedelta(days=4 * i)).strftime("%Y-%m-%d")
            self.conn.execute(
                "INSERT INTO sets (start_time, exercise_title, primary_muscle, "
                "set_index, weight_raw, reps_clean, epoch, is_working, date) "
                "VALUES (?,?,?,0,?,?,0,1,?)",
                (f"{day}T18:00:00", "Lat Pulldown",
                 config.exercise_info("Lat Pulldown")["primary"], w, r, day))
        self.conn.commit()
        out = backtest.effort_rep_prediction(self.conn)
        for k in ("recent", "legacy", "effort_offset", "adopt_effort", "rule", "note"):
            self.assertIn(k, out)
        self.assertIsInstance(out["adopt_effort"], bool)
        # legacy = censored anchors -> effort predictor byte-identical to baseline
        if out["legacy"].get("n"):
            self.assertEqual(out["legacy"]["mae_effort"], out["legacy"]["mae_baseline"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
