"""Offline tests for the Hevy API adapter: auth header, pagination, retry, and
error surfacing. urllib is mocked - no real network, no key needed."""
import io
import json
import os
import sys
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from workout import hevy_client  # noqa: E402


class FakeResp:
    def __init__(self, payload):
        self._b = json.dumps(payload).encode("utf-8")

    def read(self):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _http_error(code, body=b'{"error":"x"}'):
    return urllib.error.HTTPError("http://x", code, "err", {}, io.BytesIO(body))


def _seq_urlopen(items, recorder=None):
    it = iter(items)

    def _open(req, timeout=None):
        if recorder is not None:
            recorder.append(req)
        nxt = next(it)
        if isinstance(nxt, Exception):
            raise nxt
        return FakeResp(nxt)
    return _open


class HevyClientTest(unittest.TestCase):
    def setUp(self):
        os.environ["HEVY_API_KEY"] = "test-key-123"
        # don't let a stale module-level secrets cache interfere
        from workout import config
        config._secrets = {}

    def tearDown(self):
        os.environ.pop("HEVY_API_KEY", None)

    def test_sends_api_key_header_and_parses(self):
        rec = []
        with mock.patch("urllib.request.urlopen",
                        _seq_urlopen([{"ok": True}], rec)):
            out = hevy_client._request("GET", "/workouts")
        self.assertEqual(out, {"ok": True})
        # urllib title-cases header keys -> "Api-key"
        self.assertEqual(rec[0].get_header("Api-key"), "test-key-123")

    def test_pagination_walks_all_pages(self):
        pages = [
            {"page": 1, "page_count": 2, "workouts": [{"id": "a"}, {"id": "b"}]},
            {"page": 2, "page_count": 2, "workouts": [{"id": "c"}]},
        ]
        with mock.patch("urllib.request.urlopen", _seq_urlopen(pages)):
            ids = [w["id"] for w in hevy_client.iter_workouts()]
        self.assertEqual(ids, ["a", "b", "c"])

    def test_retries_then_succeeds(self):
        seq = [_http_error(429), {"ok": 1}]
        with mock.patch("workout.hevy_client.time.sleep", lambda *_: None), \
                mock.patch("urllib.request.urlopen", _seq_urlopen(seq)):
            out = hevy_client._request("GET", "/workouts")
        self.assertEqual(out, {"ok": 1})

    def test_terminal_error_raises_readable(self):
        with mock.patch("workout.hevy_client.time.sleep", lambda *_: None), \
                mock.patch("urllib.request.urlopen",
                           _seq_urlopen([_http_error(404)])):
            with self.assertRaises(RuntimeError) as cm:
                hevy_client._request("GET", "/workouts/nope")
        self.assertIn("404", str(cm.exception))

    def test_auth_error_hints_at_key(self):
        with mock.patch("workout.hevy_client.time.sleep", lambda *_: None), \
                mock.patch("urllib.request.urlopen",
                           _seq_urlopen([_http_error(401)])):
            with self.assertRaises(RuntimeError) as cm:
                hevy_client._request("GET", "/workouts")
        self.assertIn("key", str(cm.exception).lower())

    def test_update_routine_puts_body(self):
        rec = []
        payload = {"routine": {"title": "x", "exercises": []}}
        with mock.patch("urllib.request.urlopen",
                        _seq_urlopen([{"routine": {"id": "r1"}}], rec)):
            hevy_client.update_routine("r1", payload)
        self.assertEqual(rec[0].method, "PUT")
        self.assertEqual(json.loads(rec[0].data.decode()), payload)


if __name__ == "__main__":
    unittest.main(verbosity=2)
