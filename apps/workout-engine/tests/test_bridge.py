import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class BridgeContractTest(unittest.TestCase):
    def invoke(self, command, payload=None):
        with tempfile.TemporaryDirectory() as data_dir:
            env = dict(os.environ)
            env["TB_WORKOUT_DATA_DIR"] = data_dir
            env["TB_WORKOUT_CONFIG_DIR"] = str(ROOT / "config")
            proc = subprocess.run(
                [sys.executable, str(ROOT / "bridge.py"), command],
                input=json.dumps(payload or {}),
                text=True,
                capture_output=True,
                env=env,
                timeout=30,
            )
            return proc, json.loads(proc.stdout)

    def test_status_is_versioned_and_never_returns_a_secret(self):
        proc, response = self.invoke("status")
        self.assertEqual(proc.returncode, 0)
        self.assertTrue(response["ok"])
        self.assertEqual(response["schemaVersion"], 1)
        self.assertEqual(response["data"]["sets"], 0)
        self.assertNotIn("apiKey", json.dumps(response))
        self.assertNotIn("hevy_api_key", json.dumps(response))

    def test_unknown_command_returns_a_json_error(self):
        proc, response = self.invoke("does-not-exist")
        self.assertNotEqual(proc.returncode, 0)
        self.assertFalse(response["ok"])
        self.assertIn("Unknown workout command", response["error"])

    def test_exercise_history_filters_dates_maps_every_set_and_handles_quotes(self):
        with tempfile.TemporaryDirectory() as data_dir:
            env = dict(os.environ)
            env["TB_WORKOUT_DATA_DIR"] = data_dir
            env["TB_WORKOUT_CONFIG_DIR"] = str(ROOT / "config")
            subprocess.run(
                [sys.executable, str(ROOT / "bridge.py"), "status"],
                input="{}", text=True, capture_output=True, env=env, check=True,
            )
            exercise = "Bench 'Safety' Press"
            conn = sqlite3.connect(Path(data_dir) / "workout.db")
            for index, date in enumerate(("2026-06-20", "2026-07-08"), start=1):
                cursor = conn.execute(
                    "INSERT INTO sessions(start_time,start_raw,title,duration_min,date) VALUES(?,?,?,?,?)",
                    (f"{date}T08:00:00", f"{date} 08:00", "Upper", 52, date),
                )
                conn.execute(
                    """INSERT INTO sets(
                        session_id,start_time,exercise_title,set_index,set_type,weight_raw,reps_raw,
                        rpe,rest_seconds,primary_muscle,epoch,weight_norm,reps_clean,e1rm,volume,
                        is_working,quality_flag,date
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (cursor.lastrowid, f"{date}T08:0{index}:00", exercise, 0, "normal", 100 + index,
                     5, 8.5, 180, "chest", index - 1, 100 + index, 5, 118 + index, 505 + index * 5,
                     1, "reviewed_correction" if index == 2 else None, date),
                )
            conn.commit()
            conn.close()
            (Path(data_dir) / "secrets.json").write_text('{"hevy_api_key":"never-return-me"}', encoding="utf-8")

            proc = subprocess.run(
                [sys.executable, str(ROOT / "bridge.py"), "exercise-history"],
                input=json.dumps({"exercise": exercise, "from": "2026-07-01", "to": "2026-07-31"}),
                text=True, capture_output=True, env=env, timeout=30,
            )
            response = json.loads(proc.stdout)
            self.assertEqual(proc.returncode, 0)
            self.assertTrue(response["ok"])
            self.assertEqual(len(response["data"]["sessions"]), 1)
            mapped = response["data"]["sessions"][0]["sets"][0]
            self.assertEqual(mapped, {
                "index": 0, "type": "normal", "weight": 102.0, "reps": 5,
                "rpe": 8.5, "rir": 1.5, "rest_seconds": 180.0, "e1rm": 120.0,
                "volume": 515.0, "epoch": 1, "is_working": True,
                "quality_flag": "reviewed_correction",
            })
            self.assertNotIn("never-return-me", proc.stdout)

            missing = subprocess.run(
                [sys.executable, str(ROOT / "bridge.py"), "exercise-history"],
                input=json.dumps({"exercise": "Missing"}), text=True, capture_output=True, env=env, timeout=30,
            )
            self.assertNotEqual(missing.returncode, 0)
            self.assertIn("No workout history exists", json.loads(missing.stdout)["error"])


if __name__ == "__main__":
    unittest.main()
