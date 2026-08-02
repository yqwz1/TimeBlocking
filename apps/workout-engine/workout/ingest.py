"""Parse a Hevy CSV export, merge it idempotently, and recompute derived data.

Each weekly export is a FULL re-export of all history, so ingest is a pure
UPSERT keyed on (start_time, exercise_title, set_index):
  - new key            -> insert
  - same key, no change -> no-op (the common case for ~1900 historical rows)
  - same key, changed   -> the user edited a past set in Hevy -> update
"""
import csv
import hashlib
from collections import defaultdict
from datetime import datetime

from . import config, dates, normalize, quality, metrics


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _f(s):
    s = (s or "").strip()
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _i(s):
    v = _f(s)
    return int(v) if v is not None else None


def last_import_sha(conn):
    row = conn.execute(
        "SELECT file_sha256 FROM imports ORDER BY import_id DESC LIMIT 1"
    ).fetchone()
    return row["file_sha256"] if row else None


def _session_duration_min(start_dt, end_dt):
    if not start_dt or not end_dt:
        return None
    mins = (end_dt - start_dt).total_seconds() / 60.0
    clamp = config.settings()["session_duration_clamp_hours"] * 60.0
    if mins <= 0 or mins > clamp:
        return None
    return round(mins, 1)


def _ensure_session(cur, seen, start_iso, start_raw, title, end_iso, duration, date):
    """Insert the session if unseen; return its session_id. Shared by CSV + API."""
    if start_iso not in seen:
        cur.execute(
            """INSERT OR IGNORE INTO sessions
               (start_time, start_raw, title, end_time, duration_min, date)
               VALUES (?,?,?,?,?,?)""",
            (start_iso, start_raw, title, end_iso, duration, date))
        seen[start_iso] = cur.execute(
            "SELECT session_id FROM sessions WHERE start_time=?", (start_iso,)
        ).fetchone()["session_id"]
    return seen[start_iso]


def _upsert_set(cur, sid, rec, import_id):
    """UPSERT one set on the (start_time, exercise_title, set_index) key.

    `rec` is a normalized dict with keys: start_iso, exercise_title, set_index,
    set_type, weight, reps, rpe, date, and optional exercise_template_id (None
    for CSV rows, the Hevy UUID for API rows). Returns 'inserted'|'updated'|
    'noop'. This is the single write path for both the CSV importer and the
    Hevy API sync, so dedup behaves identically regardless of source."""
    tid = rec.get("exercise_template_id")
    existing = cur.execute(
        """SELECT set_id, weight_raw, reps_raw, rpe, exercise_template_id FROM sets
           WHERE start_time=? AND exercise_title=? AND set_index=?""",
        (rec["start_iso"], rec["exercise_title"], rec["set_index"])).fetchone()
    if existing is None:
        cur.execute(
            """INSERT INTO sets
               (session_id, start_time, exercise_title, set_index, set_type,
                weight_raw, reps_raw, rpe, exercise_template_id,
                source_import_id, date)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (sid, rec["start_iso"], rec["exercise_title"], rec["set_index"],
             rec["set_type"], rec["weight"], rec["reps"], rec["rpe"], tid,
             import_id, rec["date"]))
        return "inserted"
    # Backfilling a template_id onto an existing CSV row counts as a change so the
    # learned map fills in; weight/reps/rpe edits behave exactly as before.
    changed = (existing["weight_raw"] != rec["weight"]
               or existing["reps_raw"] != rec["reps"]
               or existing["rpe"] != rec["rpe"]
               or (tid and existing["exercise_template_id"] != tid))
    if changed:
        cur.execute(
            """UPDATE sets SET weight_raw=?, reps_raw=?, rpe=?, set_type=?,
               exercise_template_id=COALESCE(?, exercise_template_id),
               source_import_id=? WHERE set_id=?""",
            (rec["weight"], rec["reps"], rec["rpe"], rec["set_type"], tid,
             import_id, existing["set_id"]))
        return "updated"
    return "noop"


def run(conn, csv_path, now=None, force=False):
    """Ingest one export. Returns a dict of import counts.
    force=True bypasses the identical-file short-circuit (used for tests and
    for deliberate re-processing)."""
    now = now or datetime.now()
    sha = sha256_file(csv_path)
    if not force and sha == last_import_sha(conn):
        return {"no_change": True, "inserted": 0, "updated": 0,
                "duplicate_noop": 0, "flagged": 0, "rows_seen": 0}

    with open(csv_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    cur = conn.cursor()
    cur.execute(
        "INSERT INTO imports(imported_at, source_path, file_sha256) VALUES (?,?,?)",
        (dates.iso(now), csv_path, sha),
    )
    import_id = cur.lastrowid

    inserted = updated = noop = 0
    seen_sessions = {}

    for r in rows:
        start_raw = (r.get("start_time") or "").strip()
        start_dt = dates.parse_hevy(start_raw)
        if not start_dt:
            continue
        start_iso = dates.iso(start_dt)
        end_dt = dates.parse_hevy((r.get("end_time") or "").strip())
        date = dates.day(start_dt)

        sid = _ensure_session(
            cur, seen_sessions, start_iso, start_raw,
            (r.get("title") or "").strip(), dates.iso(end_dt),
            _session_duration_min(start_dt, end_dt), date)

        rec = {
            "start_iso": start_iso,
            "exercise_title": config.canonical_exercise_name(
                (r.get("exercise_title") or "").strip()),
            "set_index": _i(r.get("set_index")),
            "set_type": (r.get("set_type") or "normal").strip(),
            "weight": _f(r.get("weight_kg")),
            "reps": _i(r.get("reps")),
            "rpe": _f(r.get("rpe")),
            "date": date,
            "exercise_template_id": None,  # CSV has no template id
        }
        outcome = _upsert_set(cur, sid, rec, import_id)
        if outcome == "inserted":
            inserted += 1
        elif outcome == "updated":
            updated += 1
        else:
            noop += 1

    flagged = recompute(conn)

    cur.execute(
        """UPDATE imports SET rows_seen=?, rows_inserted=?, rows_updated=?,
           rows_flagged=? WHERE import_id=?""",
        (len(rows), inserted, updated, flagged, import_id),
    )
    conn.commit()
    return {"no_change": False, "rows_seen": len(rows), "inserted": inserted,
            "updated": updated, "duplicate_noop": noop, "flagged": flagged}


def recompute(conn):
    """Recompute all derived columns for every set. Full recompute is cheap at
    this scale (~2k rows) and avoids partial-update bugs. Returns flagged count."""
    rows = conn.execute(
        """SELECT s.set_id, s.exercise_title, s.set_type, s.weight_raw,
                  s.reps_raw, s.rpe, s.date
           FROM sets s ORDER BY s.exercise_title, s.date, s.set_index"""
    ).fetchall()

    by_ex = defaultdict(list)
    for row in rows:
        by_ex[row["exercise_title"]].append(row)

    updates = []
    flagged = 0
    for ex, ex_rows in by_ex.items():
        info = config.exercise_info(ex)
        primary = info["primary"]
        pattern = info["pattern"]
        all_reps = [r["reps_raw"] for r in ex_rows]
        items = [((r["date"] or "")[:7], r["weight_raw"]) for r in ex_rows]
        override = info.get("unit_epochs")
        epochs, norms, outliers = normalize.normalize_exercise(items, override)

        for i, r in enumerate(ex_rows):
            is_bw, wflag = quality.classify_weight(r["weight_raw"])
            reps_clean, rflag = quality.correct_reps(r["reps_raw"], all_reps)
            woutlier = outliers[i]
            qflag = quality.combine_flags(
                wflag, rflag, "weight_outlier" if woutlier else None)
            if qflag:
                flagged += 1
            wnorm = norms[i]
            # weight typos are excluded from e1RM/volume so they can't pollute
            # PRs, trends, or per-muscle recovery; the raw value is retained.
            e = None if woutlier else metrics.e1rm(r["weight_raw"], reps_clean, is_bw, r["rpe"])
            vol = None if woutlier else metrics.volume(wnorm, reps_clean, is_bw)
            is_working = 0 if r["set_type"] in ("warmup", "warm up", "Warm up") else 1
            updates.append((primary, pattern, epochs[i], wnorm, reps_clean, e, vol,
                            1 if is_bw else 0, is_working, qflag, r["set_id"]))

    conn.executemany(
        """UPDATE sets SET primary_muscle=?, pattern=?, epoch=?, weight_norm=?,
           reps_clean=?, e1rm=?, volume=?, is_bodyweight=?, is_working=?,
           quality_flag=? WHERE set_id=?""",
        updates,
    )
    conn.commit()
    return flagged
