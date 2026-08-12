import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from workout import config  # noqa: E402


class PowerliftingProfileTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.original_data = config.DATA_DIR
        self.original_output = config.OUTPUT_DIR
        config.DATA_DIR = self.tmp.name
        config.OUTPUT_DIR = os.path.join(self.tmp.name, "output")

    def tearDown(self):
        config.DATA_DIR = self.original_data
        config.OUTPUT_DIR = self.original_output
        self.tmp.cleanup()

    def test_profile_is_atomically_saved_in_data_directory_and_merged_over_defaults(self):
        profile = {
            "lifts": {"squat": "High Bar Squat", "bench": "Competition Bench", "deadlift": "Conventional Deadlift"},
            "bar_weight_kg": 20,
            "plate_pairs_kg": [25, 20, 2.5, 1.25],
            "sex": "female",
            "score": "wilks",
            "meet_date": "2026-11-14",
            "attempt_pct": [0.9, 0.95, 1.0],
        }
        config.save_powerlifting_profile(profile)
        path = config.powerlifting_profile_path()
        self.assertTrue(os.path.isfile(path))
        with open(path, encoding="utf-8") as f:
            self.assertEqual(json.load(f), profile)
        merged = config.powerlifting()
        self.assertEqual(merged["score"], "wilks")
        self.assertEqual(merged["lifts"]["bench"], "Competition Bench")
        self.assertIn("standards", merged)


if __name__ == "__main__":
    unittest.main()
