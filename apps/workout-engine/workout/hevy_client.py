"""Isolated Hevy REST API adapter.

ALL network I/O for the coach lives in this one module (stdlib urllib only, to
keep the project zero-dependency). Everything else - the SQLite store and the
analytics - stays the source of truth; this is just an ingestion + output
adapter. If Hevy changes or retires the API (their docs warn they might), this
is the only file that has to change, and the CSV importer remains as a fallback.

Auth: the key is sent in the `api-key` header (Hevy's documented scheme).
Endpoints return paginated envelopes: {page, page_count, <collection>: [...]}.
A few shape details (the exact header name, the body_measurements collection
key, the events `since` param) are confirmed against the live API in the
sync/push smoke test; they are isolated here so any correction is one-line.
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request

from . import config

# Status codes worth retrying with backoff (transient).
_RETRY_CODES = {429, 500, 502, 503, 504}


def _request(method, path, params=None, body=None):
    """Make one authenticated request; return parsed JSON (or {} on empty body).
    Retries transient failures with exponential backoff, then raises a readable
    RuntimeError. Never logs the API key."""
    cfg = config.hevy_settings()
    url = cfg["base_url"].rstrip("/") + path
    if params:
        clean = {k: v for k, v in params.items() if v is not None}
        if clean:
            url += "?" + urllib.parse.urlencode(clean)

    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"api-key": config.hevy_api_key(), "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"

    timeout = cfg["timeout_seconds"]
    max_retries = cfg["max_retries"]
    attempt = 0
    while True:
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8")
                if not raw.strip():
                    return {}
                try:
                    return json.loads(raw)
                except ValueError:
                    # Some write endpoints (e.g. POST /exercise_templates) return
                    # the new id as a bare, unquoted string rather than JSON.
                    return raw.strip()
        except urllib.error.HTTPError as e:
            if e.code in _RETRY_CODES and attempt < max_retries:
                time.sleep(min(2 ** attempt, 30))
                attempt += 1
                continue
            detail = ""
            try:
                detail = e.read().decode("utf-8")[:300]
            except Exception:
                pass
            hint = (" (check your Hevy API key in config/secrets.json)"
                    if e.code in (401, 403) else "")
            raise RuntimeError(
                f"Hevy API {method} {path} -> HTTP {e.code}{hint}: {detail}"
            ) from None
        except urllib.error.URLError as e:
            if attempt < max_retries:
                time.sleep(min(2 ** attempt, 30))
                attempt += 1
                continue
            raise RuntimeError(
                f"Hevy API {method} {path} failed: {e.reason}") from None


def _paged(path, collection_key, params=None, page_size=None):
    """Yield every item across all pages of a paginated collection endpoint."""
    params = dict(params or {})
    page_size = page_size or config.hevy_settings()["page_size"]
    page = 1
    while True:
        params["page"] = page
        params["pageSize"] = page_size
        data = _request("GET", path, params=params)
        if isinstance(data, list):          # defensive: un-enveloped list
            items, page_count = data, 1
        else:
            items = data.get(collection_key, []) or []
            page_count = data.get("page_count") or page
        for it in items:
            yield it
        if page >= page_count or not items:
            break
        page += 1


# ---- Reads -----------------------------------------------------------------

def iter_workouts(page_size=None):
    """All workouts, newest-first per the API, paged transparently."""
    return _paged("/workouts", "workouts", page_size=page_size)


def iter_workout_events(since, page_size=None):
    """Workout update/delete events since an ISO-8601 instant. Each item is
    {type:'updated', workout:{...}} or {type:'deleted', id, deleted_at}."""
    return _paged("/workouts/events", "events",
                  params={"since": since}, page_size=page_size)


def get_workout(workout_id):
    return _request("GET", f"/workouts/{workout_id}")


def iter_routines(page_size=None):
    return _paged("/routines", "routines", page_size=page_size)


def get_routine(routine_id):
    return _request("GET", f"/routines/{routine_id}")


def iter_routine_folders(page_size=None):
    return _paged("/routine_folders", "routine_folders", page_size=page_size)


def iter_exercise_templates(page_size=None):
    """The full exercise catalog (built-in + your custom), paged transparently.
    Each item: {id, title, type, primary_muscle_group, is_custom, ...}."""
    return _paged("/exercise_templates", "exercise_templates", page_size=page_size)


def iter_body_measurements(page_size=None):
    return _paged("/body_measurements", "body_measurements", page_size=page_size)


# ---- Writes ----------------------------------------------------------------

def update_routine(routine_id, payload):
    """PUT an updated routine. `payload` is a PutRoutinesRequestBody:
    {"routine": {"title", "notes", "exercises": [...]}}."""
    return _request("PUT", f"/routines/{routine_id}", body=payload)


def create_exercise_template(payload):
    """POST a custom exercise. `payload` is
    {"exercise": {"title", "muscle_group", "exercise_type", "equipment_category"}}
    (all four required; enums confirmed against the live API). Returns the
    created template, including its generated `id`."""
    return _request("POST", "/exercise_templates", body=payload)


def create_routine_folder(payload):
    """POST a routine folder. `payload` is {"routine_folder": {"title"}}.
    Returns the created folder, including its `id`."""
    return _request("POST", "/routine_folders", body=payload)


def create_routine(payload):
    """POST a new routine. `payload` is a PostRoutinesRequestBody:
    {"routine": {"title", "folder_id", "notes", "exercises": [...]}}."""
    return _request("POST", "/routines", body=payload)
