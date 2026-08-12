import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from workout import config, db, volume_analytics  # noqa: E402


class VolumeAnalyticsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        config.DATA_DIR = self.tmp
        config.OUTPUT_DIR = os.path.join(self.tmp, "out")
        config.DB_PATH = os.path.join(self.tmp, "analytics.db")
        self.conn = db.connect()
        db.init(self.conn)
        # One direct Bench set gives chest 1.0 and both secondary muscles 0.5.
        for index, day in enumerate(("2026-06-01", "2026-06-29")):
            session = self.conn.execute(
                "INSERT INTO sessions(start_time,start_raw,title,date) VALUES(?,?,?,?)",
                (f"{day}T18:00:00", f"{day} 18:00", "Upper", day),
            )
            self.conn.execute(
                """INSERT INTO sets(session_id,start_time,exercise_title,set_index,weight_raw,
                                     reps_clean,volume,is_working,date)
                   VALUES(?,?,?,?,?,?,?,?,?)""",
                (session.lastrowid, f"{day}T18:00:00", "Bench Press (Barbell)", 0,
                 100, 5, 500, 1, day),
            )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    @patch("workout.volume_analytics.volume.recovery_by_muscle", return_value={})
    @patch("workout.volume_analytics.fatigue.assess", return_value={"acwr_by_muscle": {}})
    @patch("workout.volume_analytics.progression.analyze_all", return_value={"Bench Press (Barbell)": {}})
    @patch("workout.volume_analytics.backtest.form_validity", return_value={"n": 0})
    @patch("workout.volume_analytics.volume.recommend", return_value={"recommendations": [], "recovery_confidence": "low", "recovery_confidence_basis": "sparse history"})
    def test_credits_secondary_muscles_and_aligns_equal_previous_period(self, *_mocks):
        result = volume_analytics.build(self.conn, "4w", compare_requested=True)
        by_muscle = {item["muscle"]: item for item in result["muscles"]}
        self.assertEqual(result["selected"]["weeks"], 4)
        self.assertTrue(result["comparison_available"])
        self.assertEqual(by_muscle["chest"]["credited_sets"], 1.0)
        self.assertEqual(by_muscle["triceps"]["credited_sets"], 0.5)
        self.assertEqual(by_muscle["shoulders"]["load_index"], 250.0)
        # Overview totals include every consistently credited muscle: primary
        # chest (1.0) plus triceps and shoulders (0.5 each).
        self.assertEqual(result["comparison_overview"]["credited_sets"], 2.0)

    @patch("workout.volume_analytics.volume.recovery_by_muscle", return_value={})
    @patch("workout.volume_analytics.fatigue.assess", return_value={"acwr_by_muscle": {}})
    @patch("workout.volume_analytics.progression.analyze_all", return_value={"Bench Press (Barbell)": {}})
    @patch("workout.volume_analytics.backtest.form_validity", return_value={"n": 0})
    @patch("workout.volume_analytics.volume.recommend", return_value={"recommendations": [], "recovery_confidence": "low", "recovery_confidence_basis": "sparse history"})
    def test_all_history_disables_previous_comparison_without_fabricating_scores(self, *_mocks):
        result = volume_analytics.build(self.conn, "all", compare_requested=True)
        self.assertIsNone(result["previous"])
        self.assertFalse(result["comparison_available"])
        self.assertIn("equal preceding period", result["comparison_reason"])
        self.assertTrue(all(week["recovery_score"] is None for week in result["weekly"]))


if __name__ == "__main__":
    unittest.main()
