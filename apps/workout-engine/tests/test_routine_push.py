"""Offline tests for routine push (update-in-place): matched exercises get the
new target, unmatched exercises pass through untouched (never dropped), preview
writes nothing, and push PUTs the payload. summary + hevy_client are mocked."""
import contextlib
import io
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from workout import config  # noqa: E402

ROUTINE = {
    "id": "r1", "title": "Upper A", "notes": "heavy day",
    "exercises": [
        {"index": 0, "title": "Bench Press (Barbell)",
         "exercise_template_id": "uuid-bench", "supersets_id": None,
         "rest_seconds": 120, "notes": "",
         "sets": [{"index": 0, "type": "warmup", "weight_kg": 40, "reps": 5},
                  {"index": 1, "type": "normal", "weight_kg": 60, "reps": 8},
                  {"index": 2, "type": "normal", "weight_kg": 60, "reps": 8}]},
        {"index": 1, "title": "Some Unmapped Lift",
         "exercise_template_id": "uuid-x", "supersets_id": None,
         "rest_seconds": 90, "notes": "",
         "sets": [{"index": 0, "type": "normal", "weight_kg": 20, "reps": 10}]},
    ],
}

OBJ = {"exercises": [
    {"name": "Bench Press (Barbell)", "next_target": {
        "rec_type": "progress", "weight": 65, "reps": 5, "n_sets": 2,
        "sets": [{"weight": 65, "reps": 5}, {"weight": 65, "reps": 5}],
        "rationale": "Hit top of range - add load."}},
]}


def _fresh_db(path):
    config.DB_PATH = path
    from workout import db
    conn = db.connect()
    db.init(conn)
    return conn


class RoutinePushTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        config.DATA_DIR = self.tmp
        config.OUTPUT_DIR = os.path.join(self.tmp, "out")
        self.conn = _fresh_db(os.path.join(self.tmp, "push.db"))
        from workout import routine_push
        self.rp = routine_push

    def _build(self, routines=(ROUTINE,), obj=OBJ):
        with mock.patch.object(self.rp, "summary") as msum, \
                mock.patch.object(self.rp.hevy_client, "iter_routines",
                                  lambda *a, **k: list(routines)):
            msum.build.return_value = obj
            return self.rp.build_updates(self.conn)

    def test_matched_sets_updated_unmatched_passthrough(self):
        updates = self._build()
        self.assertEqual(len(updates), 1)
        u = updates[0]
        self.assertEqual(u["title"], "Upper A")
        exs = u["payload"]["routine"]["exercises"]
        self.assertEqual(len(exs), 2)  # both exercises sent back, nothing dropped

        bench = exs[0]
        # warmup left alone; both working sets retargeted to 65kg x 5
        self.assertEqual(bench["sets"][0]["weight_kg"], 40)   # warmup untouched
        self.assertEqual(bench["sets"][1]["weight_kg"], 65)
        self.assertEqual(bench["sets"][1]["reps"], 5)
        self.assertIsNone(bench["sets"][1]["rep_range"])
        self.assertEqual(bench["sets"][2]["weight_kg"], 65)
        # GET supersets_id is bridged to PUT superset_id
        self.assertIn("superset_id", bench)

        unmapped = exs[1]
        self.assertEqual(unmapped["sets"][0]["weight_kg"], 20)  # untouched
        self.assertIn("Some Unmapped Lift", u["unmatched"])

    def test_changes_recorded_for_preview(self):
        u = self._build()[0]
        chg = u["exercise_changes"]
        self.assertEqual(len(chg), 1)
        self.assertEqual(chg[0]["exercise"], "Bench Press (Barbell)")
        self.assertEqual(len(chg[0]["sets"]), 2)  # two working sets changed
        self.assertEqual(chg[0]["sets"][0]["old"], (60, 8))
        self.assertEqual(chg[0]["sets"][0]["new"], (65, 5))

    def test_no_targets_means_no_updates(self):
        only_unmapped = {**ROUTINE, "exercises": ROUTINE["exercises"][1:]}
        self.assertEqual(self._build(routines=[only_unmapped]), [])

    def test_preview_makes_no_writes(self):
        updates = self._build()
        with mock.patch.object(self.rp.hevy_client, "update_routine") as up:
            with contextlib.redirect_stdout(io.StringIO()):
                self.rp.preview(updates)
        up.assert_not_called()

    def test_push_puts_payload(self):
        updates = self._build()
        with mock.patch.object(self.rp.hevy_client, "update_routine") as up:
            with contextlib.redirect_stdout(io.StringIO()):
                n = self.rp.push(self.conn, updates)
        self.assertEqual(n, 1)
        up.assert_called_once()
        args = up.call_args[0]
        self.assertEqual(args[0], "r1")                       # routine id
        self.assertEqual(args[1], updates[0]["payload"])      # body


if __name__ == "__main__":
    unittest.main(verbosity=2)
