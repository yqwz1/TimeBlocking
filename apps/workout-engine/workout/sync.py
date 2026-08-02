"""Sync the local store from the Hevy API - the read path that replaces the
weekly CSV drop.

First run (or `full=True`) backfills the entire workout history via /workouts.
Later runs are incremental via /workouts/events, which - unlike a CSV
re-export - also reports DELETIONS, so a workout removed in the app stops
inflating volume/ACWR locally. Everything lands through the same
ingest._upsert_set write path the CSV uses, and ingest.recompute (which is
input-agnostic) rebuilds every derived column afterward, so all downstream
analytics are unchanged. RPE rides in on each set for free; bodyweight is
pulled from /body_measurements.

The title<->exercise_template_id map is learned here from the user's own synced
history and is what routine_push uses to resolve exercises back to Hevy UUIDs.
"""
from datetime import datetime

from . import config, dates, hevy_client, ingest, memory


# ---- sync_state cursor store ----------------------------------------------

def get_state(conn, key, default=None):
    row = conn.execute("SELECT value FROM sync_state WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_state(conn, key, value):
    conn.execute(
        "INSERT INTO sync_state(key, value) VALUES (?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(value)))


# ---- API workout -> normalized records ------------------------------------

def _workout_to_recs(w):
    """Map one API Workout dict to (session_meta, [set rec, ...]). The recs feed
    ingest._upsert_set; session_meta feeds ingest._ensure_session. Timestamps
    are normalized to local wall-clock so dedup lines up with CSV history."""
    start_dt = dates.parse_api(w.get("start_time"))
    if not start_dt:
        return None, []
    start_iso = dates.iso(start_dt)
    end_dt = dates.parse_api(w.get("end_time"))
    date = dates.day(start_dt)

    duration = None
    if end_dt and end_dt > start_dt:
        mins = (end_dt - start_dt).total_seconds() / 60.0
        clamp = config.settings()["session_duration_clamp_hours"] * 60.0
        if 0 < mins <= clamp:
            duration = round(mins, 1)

    meta = {"start_iso": start_iso, "start_raw": w.get("start_time") or start_iso,
            "title": (w.get("title") or "").strip(), "end_iso": dates.iso(end_dt),
            "duration": duration, "date": date, "workout_id": w.get("id")}

    recs = []
    for ex in (w.get("exercises") or []):
        title = config.canonical_exercise_name((ex.get("title") or "").strip())
        tid = ex.get("exercise_template_id")
        for s in (ex.get("sets") or []):
            recs.append({
                "start_iso": start_iso, "exercise_title": title,
                "set_index": s.get("index"), "set_type": s.get("type") or "normal",
                "weight": s.get("weight_kg"), "reps": s.get("reps"),
                "rpe": s.get("rpe"), "date": date, "exercise_template_id": tid})
    return meta, recs


def _learn_exercise(cur, title, template_id, last_seen):
    """Remember title <-> template_id (most-recent wins) for routine_push."""
    if not title or not template_id:
        return
    cur.execute(
        "INSERT INTO exercise_map(exercise_title, exercise_template_id, last_seen) "
        "VALUES (?,?,?) ON CONFLICT(exercise_title) DO UPDATE SET "
        "exercise_template_id=excluded.exercise_template_id, "
        "last_seen=excluded.last_seen", (title, template_id, last_seen))


def _delete_workout(cur, workout_id):
    """Remove a workout deleted in Hevy. The event carries only the workout id,
    so we map it via sessions.workout_id (recorded at ingest) to the local
    start_time, then drop its sets + session. Returns 1 if anything was removed."""
    if not workout_id:
        return 0
    row = cur.execute(
        "SELECT session_id, start_time FROM sessions WHERE workout_id=?",
        (workout_id,)).fetchone()
    if not row:
        return 0
    cur.execute("DELETE FROM sets WHERE start_time=?", (row["start_time"],))
    cur.execute("DELETE FROM sessions WHERE session_id=?", (row["session_id"],))
    return 1


def _sync_body_measurements(conn):
    """Pull bodyweight from /body_measurements into the bodyweight table. A bonus
    on top of the workout sync - never fails the whole run if it misbehaves."""
    n = 0
    try:
        for m in hevy_client.iter_body_measurements():
            date = (m.get("date") or "")[:10]
            wkg = m.get("weight_kg")
            if date and wkg is not None:
                memory.log_bodyweight(conn, wkg, date, unit="kg", note="hevy")
                n += 1
    except RuntimeError:
        pass
    return n


def run(conn, now=None, full=False):
    """Pull from the Hevy API into the local store. Returns a counts dict.
    Mirrors ingest.run()'s contract so coach.py can report it the same way."""
    now = now or datetime.now()
    now_iso = dates.iso(now)
    cur = conn.cursor()

    backfilled = get_state(conn, "backfilled") == "1"
    mode = "backfill" if (full or not backfilled) else "incremental"

    cur.execute(
        "INSERT INTO imports(imported_at, source_path, file_sha256) VALUES (?,?,?)",
        (now_iso, f"hevy-api://{mode}", f"api-{mode}-{now_iso}"))
    import_id = cur.lastrowid

    seen = {}
    counts = {"inserted": 0, "updated": 0, "noop": 0}
    seen_count = deleted = 0

    def apply_workout(w):
        nonlocal seen_count
        # Some list endpoints return summaries without sets; fetch detail then.
        if "exercises" not in w and w.get("id"):
            detail = hevy_client.get_workout(w["id"])
            w = detail.get("workout", detail) if isinstance(detail, dict) else w
        meta, recs = _workout_to_recs(w)
        if not meta:
            return
        sid = ingest._ensure_session(
            cur, seen, meta["start_iso"], meta["start_raw"], meta["title"],
            meta["end_iso"], meta["duration"], meta["date"])
        if meta.get("workout_id"):
            cur.execute("UPDATE sessions SET workout_id=? WHERE session_id=?",
                        (meta["workout_id"], sid))
        for rec in recs:
            if rec["set_index"] is None:
                continue
            seen_count += 1
            counts[ingest._upsert_set(cur, sid, rec, import_id)] += 1
            _learn_exercise(cur, rec["exercise_title"],
                            rec["exercise_template_id"], meta["date"])

    if mode == "backfill":
        for w in hevy_client.iter_workouts():
            apply_workout(w)
    else:
        since = get_state(conn, "last_events_cursor") or "1970-01-01T00:00:00Z"
        for ev in hevy_client.iter_workout_events(since):
            if ev.get("type") == "deleted":
                deleted += _delete_workout(cur, ev.get("id"))
            elif ev.get("workout"):
                apply_workout(ev["workout"])

    flagged = ingest.recompute(conn)
    measurements = _sync_body_measurements(conn)

    set_state(conn, "backfilled", "1")
    set_state(conn, "last_events_cursor", now_iso)
    set_state(conn, "last_sync_at", now_iso)

    cur.execute(
        "UPDATE imports SET rows_seen=?, rows_inserted=?, rows_updated=?, "
        "rows_flagged=? WHERE import_id=?",
        (seen_count, counts["inserted"], counts["updated"], flagged, import_id))
    conn.commit()
    return {"mode": mode, "rows_seen": seen_count, "inserted": counts["inserted"],
            "updated": counts["updated"], "duplicate_noop": counts["noop"],
            "deleted": deleted, "flagged": flagged, "measurements": measurements}
