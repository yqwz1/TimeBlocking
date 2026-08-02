#!/usr/bin/env python
"""Versioned JSON bridge between TimeBlock and the WorkOut coaching engine."""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import sys
from pathlib import Path

from workout import (
    autoregulation,
    backtest,
    balance,
    compare,
    db,
    fatigue,
    individualize,
    ingest,
    memory,
    progression,
    report,
    routine_push,
    summary,
    sync,
    volume,
)
from workout import config as workout_config

BRIDGE_SCHEMA_VERSION = 1


def _open():
    conn = db.connect()
    db.init(conn)
    return conn


def _payload() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("Request payload must be a JSON object")
    return value


def _latest_path() -> Path:
    return Path(workout_config.DATA_DIR) / "latest-summary.json"


def _persist_latest(obj: dict) -> None:
    path = _latest_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2), encoding="utf-8")


def _rebuild(conn, as_of=None) -> dict:
    as_of = as_of or progression.latest_date(conn)
    if not as_of:
        return {}
    memory.grade_recommendations(conn, as_of)
    individualize.refresh_models(conn)
    obj, outdir = summary.write(conn, as_of)
    memory.save_recommendations(conn, obj, as_of)
    report.write_all(obj, outdir)
    _persist_latest(obj)
    return obj


def _preview_hash(updates: list) -> str:
    canonical = json.dumps(updates, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _status(conn) -> dict:
    sets = conn.execute("SELECT COUNT(*) c FROM sets").fetchone()["c"]
    sessions = conn.execute("SELECT COUNT(*) c FROM sessions").fetchone()["c"]
    latest = progression.latest_date(conn)
    adherence, counts = memory.adherence_pct(conn)
    return {
        "sets": sets,
        "sessions": sessions,
        "latestSession": latest,
        "adherencePct": adherence,
        "adherence": dict(counts),
        "hevyConnected": bool(os.environ.get("HEVY_API_KEY") or workout_config.secrets().get("hevy_api_key")),
        "summaryAvailable": _latest_path().exists(),
    }


def _exercise_history(conn, payload: dict) -> dict:
    """Return read-only, set-level history for one exercise.

    The dashboard fetches this lazily so the main summary stays compact. Dates
    are ISO strings, which makes lexical range filtering safe and keeps the
    query parameterized.
    """
    exercise = str(payload.get("exercise", "")).strip()
    if not exercise:
        raise ValueError("An exercise name is required")
    exists = conn.execute(
        "SELECT 1 FROM sets WHERE exercise_title=? LIMIT 1", (exercise,)
    ).fetchone()
    if not exists:
        raise ValueError(f"No workout history exists for '{exercise}'")

    from_date = payload.get("from")
    to_date = payload.get("to")
    clauses = ["s.exercise_title=?"]
    params = [exercise]
    if from_date:
        clauses.append("s.date>=?")
        params.append(str(from_date))
    if to_date:
        clauses.append("s.date<=?")
        params.append(str(to_date))

    rows = conn.execute(
        f"""SELECT s.date, s.set_index, s.set_type, s.weight_raw,
                    s.reps_clean, s.rpe, s.rest_seconds, s.e1rm, s.volume,
                    s.epoch, s.is_working, s.quality_flag,
                    COALESCE(sess.title, 'Workout') title, sess.duration_min
             FROM sets s
             LEFT JOIN sessions sess ON sess.session_id=s.session_id
             WHERE {' AND '.join(clauses)}
             ORDER BY s.date DESC, s.set_index ASC""",
        tuple(params),
    ).fetchall()

    grouped = {}
    for row in rows:
        session = grouped.setdefault(row["date"], {
            "date": row["date"], "title": row["title"] or "Workout",
            "duration_min": row["duration_min"], "sets": [],
        })
        rpe = row["rpe"]
        rir = individualize.rir_from_rpe(rpe) if rpe is not None else None
        session["sets"].append({
            "index": row["set_index"], "type": row["set_type"],
            "weight": row["weight_raw"], "reps": row["reps_clean"],
            "rpe": rpe, "rir": rir, "rest_seconds": row["rest_seconds"],
            "e1rm": round(row["e1rm"], 1) if row["e1rm"] is not None else None,
            "volume": round(row["volume"], 1) if row["volume"] is not None else None,
            "epoch": row["epoch"] or 0, "is_working": bool(row["is_working"]),
            "quality_flag": row["quality_flag"],
        })

    sessions = []
    epoch_dates = {}
    for session in grouped.values():
        working = [item for item in session["sets"] if item["is_working"]]
        candidates = working or session["sets"]
        top = max(candidates, key=lambda item: (
            item["e1rm"] if item["e1rm"] is not None else -1,
            item["weight"] if item["weight"] is not None else -1,
        ), default=None)
        session.update({
            "total_volume": round(sum(item["volume"] or 0 for item in working), 1),
            "working_sets": len(working),
            "top_weight": top["weight"] if top else None,
            "top_reps": top["reps"] if top else None,
            "top_e1rm": top["e1rm"] if top else None,
        })
        sessions.append(session)
        for epoch in {item["epoch"] for item in session["sets"]}:
            epoch_dates.setdefault(epoch, set()).add(session["date"])

    epochs = [{
        "epoch": epoch,
        "first_date": min(day_set),
        "last_date": max(day_set),
        "sessions": len(day_set),
    } for epoch, day_set in sorted(epoch_dates.items())]
    return {
        "schema_version": 1,
        "exercise": exercise,
        "muscle": workout_config.exercise_info(exercise)["primary"],
        "epochs": epochs,
        "sessions": sessions,
    }


def execute(command: str, payload: dict):
    conn = _open()
    try:
        if command == "status":
            return _status(conn)
        if command == "settings":
            # Configuration is intentionally limited to non-secret files. The
            # credential store is write-only from the TimeBlock API.
            return {
                "settings": workout_config.settings(),
                "powerlifting": workout_config.powerlifting(),
            }
        if command == "summary":
            if payload.get("cached", True) and _latest_path().exists():
                return json.loads(_latest_path().read_text(encoding="utf-8"))
            return _rebuild(conn, payload.get("date"))
        if command == "exercise-history":
            return _exercise_history(conn, payload)
        if command == "report":
            obj = _rebuild(conn, payload.get("date"))
            return {"summary": obj, "status": _status(conn)}
        if command == "sync":
            result = sync.run(conn, full=bool(payload.get("full", False)))
            return {"sync": result, "summary": _rebuild(conn, payload.get("date"))}
        if command == "import-csv":
            csv_path = Path(str(payload.get("path", ""))).resolve()
            if not csv_path.is_file() or csv_path.suffix.lower() != ".csv":
                raise ValueError("A readable CSV export is required")
            try:
                result = ingest.run(conn, str(csv_path), force=bool(payload.get("force", False)))
            finally:
                if payload.get("deleteAfterImport", True):
                    csv_path.unlink(missing_ok=True)
            return {"import": result, "summary": _rebuild(conn, payload.get("date"))}
        if command == "log-bodyweight":
            date = memory.log_bodyweight(conn, float(payload["weight"]), payload.get("date"), note=payload.get("note"))
            return {"date": date, "weight": float(payload["weight"]), "summary": _rebuild(conn)}
        if command == "set-goal":
            memory.add_goal(
                conn,
                str(payload["exercise"]),
                str(payload["metric"]),
                float(payload["value"]),
                payload.get("reps"),
                payload.get("targetDate"),
            )
            return {"summary": _rebuild(conn)}
        if command == "note":
            memory.add_note(conn, str(payload["category"]), str(payload["text"]))
            return {"saved": True}
        if command == "predict":
            exercise = str(payload["exercise"])
            epoch_row = conn.execute(
                "SELECT MAX(epoch) e FROM sets WHERE exercise_title=?", (exercise,)
            ).fetchone()
            if epoch_row["e"] is None:
                raise ValueError(f"No data for '{exercise}'")
            verdict = autoregulation.weight_verdict(conn, exercise, epoch_row["e"], float(payload["weight"]))
            analysis = individualize.analyze_exercise(conn, exercise, epoch_row["e"])
            return {"exercise": exercise, "weight": float(payload["weight"]), "verdict": verdict, "analysis": analysis}
        if command == "calibrate":
            return {
                "tips": individualize.calibration_protocol(conn, payload.get("exercise")),
                "cutoffs": backtest.suggested_cutoffs(conn),
            }
        if command == "compare":
            result = compare.analyze(conn)
            muscle = payload.get("muscle")
            if muscle:
                result["muscles"] = [item for item in result.get("muscles", []) if item.get("muscle") == muscle]
            return result
        if command == "set-plan":
            as_of = payload.get("date") or progression.latest_date(conn)
            prog_map = progression.analyze_all(conn, as_of)
            fatigue_obj = fatigue.assess(conn, as_of)
            muscle_detail = balance.weekly_balance(conn, weeks=4, as_of=as_of)
            recovery_accuracy = backtest.form_validity(conn)
            result = volume.recommend(conn, as_of, prog_map, fatigue_obj, muscle_detail, recovery_accuracy)
            muscle = payload.get("muscle")
            if muscle:
                result["recommendations"] = [r for r in result.get("recommendations", []) if r.get("muscle") == muscle]
            return result
        if command == "backtest":
            return backtest.run(conn)
        if command == "routine-preview":
            updates = routine_push.build_updates(conn, payload.get("date"))
            return {"updates": updates, "previewHash": _preview_hash(updates)}
        if command == "routine-push":
            if payload.get("confirm") is not True:
                raise ValueError("Routine push requires explicit confirmation")
            updates = routine_push.build_updates(conn, payload.get("date"))
            current_hash = _preview_hash(updates)
            if not payload.get("previewHash") or payload["previewHash"] != current_hash:
                raise ValueError("Routine preview is stale; preview again before pushing")
            return {"pushed": routine_push.push(conn, updates), "previewHash": current_hash}
        raise ValueError(f"Unknown workout command: {command}")
    finally:
        conn.close()


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        payload = _payload()
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured):
            data = execute(command, payload)
        warnings = [line for line in captured.getvalue().splitlines() if line.strip()]
        print(json.dumps({"ok": True, "schemaVersion": BRIDGE_SCHEMA_VERSION, "data": data, "warnings": warnings}))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "schemaVersion": BRIDGE_SCHEMA_VERSION, "error": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
