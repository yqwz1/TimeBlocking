"""Coaching continuity: recommendations (with adherence grading), goals, notes."""
from . import dates
from datetime import datetime


def save_recommendations(conn, summary, for_week):
    """Persist this run's next-session targets so adherence can be graded later.
    Idempotent per week: replaces ungraded recs for the same for_week."""
    conn.execute(
        "DELETE FROM recommendations WHERE for_week=? AND outcome IS NULL", (for_week,))
    now = dates.iso(datetime.now())
    for e in summary["exercises"]:
        nt = e["next_target"]
        if not nt.get("sets"):
            continue
        conn.execute(
            """INSERT INTO recommendations
               (created_at, for_week, exercise_title, rec_type, target_weight,
                target_reps, rationale) VALUES (?,?,?,?,?,?,?)""",
            (now, for_week, e["name"], nt["rec_type"], nt.get("weight"),
             nt["sets"][0]["reps"], nt.get("rationale")))
    conn.commit()


def grade_recommendations(conn, as_of):
    """Grade ungraded recs created before `as_of` against what was actually done."""
    pending = conn.execute(
        """SELECT * FROM recommendations
           WHERE outcome IS NULL AND for_week < ?""", (as_of,)).fetchall()
    for rec in pending:
        ex = rec["exercise_title"]
        nxt = conn.execute(
            """SELECT MIN(date) d FROM sets WHERE exercise_title=? AND date>?
               AND is_working=1""", (ex, rec["for_week"])).fetchone()["d"]
        if not nxt:
            continue  # not trained again yet; leave pending
        sets_ = conn.execute(
            """SELECT weight_raw, reps_clean FROM sets
               WHERE exercise_title=? AND date=? AND is_working=1""", (ex, nxt)).fetchall()
        tw = rec["target_weight"] or 0
        tr = rec["target_reps"] or 0
        hit = any((s["weight_raw"] or 0) >= tw - 1e-6 and (s["reps_clean"] or 0) >= tr
                  for s in sets_)
        exceeded = any((s["weight_raw"] or 0) > tw + 1e-6 or
                       ((s["weight_raw"] or 0) >= tw - 1e-6 and (s["reps_clean"] or 0) >= tr + 2)
                       for s in sets_)
        outcome = "exceeded" if (hit and exceeded) else ("hit" if hit else "missed")
        conn.execute(
            "UPDATE recommendations SET outcome=?, outcome_date=? WHERE rec_id=?",
            (outcome, nxt, rec["rec_id"]))
    conn.commit()


def add_goal(conn, exercise, metric, value, reps=None, target_date=None):
    conn.execute(
        """INSERT INTO goals(exercise_title, metric, target_value, target_reps,
           target_date, created_at) VALUES (?,?,?,?,?,?)""",
        (exercise, metric, value, reps, target_date, dates.iso(datetime.now())))
    conn.commit()


def log_bodyweight(conn, weight, date=None, unit="kg", note=None):
    date = date or datetime.now().strftime("%Y-%m-%d")
    conn.execute(
        """INSERT INTO bodyweight(date, weight, unit, note) VALUES (?,?,?,?)
           ON CONFLICT(date) DO UPDATE SET weight=excluded.weight,
           unit=excluded.unit, note=excluded.note""", (date, weight, unit, note))
    conn.commit()
    return date


def add_note(conn, category, body):
    conn.execute(
        "INSERT INTO coach_notes(created_at, category, body) VALUES (?,?,?)",
        (dates.iso(datetime.now()), category, body))
    conn.commit()


def adherence_pct(conn):
    rows = conn.execute(
        "SELECT outcome, COUNT(*) c FROM recommendations WHERE outcome IS NOT NULL GROUP BY outcome"
    ).fetchall()
    counts = {r["outcome"]: r["c"] for r in rows}
    done = counts.get("hit", 0) + counts.get("exceeded", 0)
    total = sum(counts.values())
    return (round(100 * done / total) if total else None), counts
