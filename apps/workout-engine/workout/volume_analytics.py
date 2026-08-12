"""Read-only time-series data for the Volume & recovery dashboard.

The command deliberately derives from the existing workout store and the same
credit/recovery primitives used by recommendations. It never persists targets
or lets present workouts alter a historical recovery reading.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

from . import backtest, balance, config, dates, fatigue, progression, volume


RANGE_WEEKS = {"4w": 4, "8w": 8, "12w": 12}


def _monday(day):
    return day - timedelta(days=day.weekday())


def _iso(day):
    return day.strftime("%Y-%m-%d")


def _period(conn, range_name):
    latest = progression.latest_date(conn)
    if not latest:
        raise ValueError("No workout history exists. Import or sync your history first.")
    latest_day = dates.from_iso(latest + "T00:00:00").date()
    first_row = conn.execute("SELECT MIN(date) first_date FROM sessions").fetchone()
    first_day = dates.from_iso(first_row["first_date"] + "T00:00:00").date()
    if range_name == "all":
        start = first_day
    else:
        start = _monday(latest_day) - timedelta(weeks=RANGE_WEEKS[range_name] - 1)
    return start, latest_day


def _weeks(start, end):
    cursor = _monday(start)
    last = _monday(end)
    out = []
    while cursor <= last:
        out.append(cursor)
        cursor += timedelta(days=7)
    return out


def _credit_rows(conn, start, end):
    """Return primary and configured-secondary credit without inventing load."""
    rows = conn.execute(
        """SELECT s.date, s.exercise_title, s.volume, s.session_id
           FROM sets s WHERE s.is_working=1 AND s.date>=? AND s.date<=?
           ORDER BY s.date, s.exercise_title, s.set_index""",
        (_iso(start), _iso(end)),
    ).fetchall()
    secondary_credit = config.settings().get("secondary_set_credit", 0.5)
    for row in rows:
        info = config.exercise_info(row["exercise_title"])
        yield row, info["primary"], 1.0
        for muscle in info.get("secondary", []):
            yield row, muscle, secondary_credit


def _series(conn, start, end):
    weekly = { _iso(w): {"week": _iso(w), "credited_sets": 0.0, "load_total": 0.0,
                           "has_load": False, "sessions": set(), "muscles": defaultdict(lambda: {"sets": 0.0, "load": 0.0, "has_load": False}),
                           "exercises": defaultdict(lambda: {"sets": 0.0, "load": 0.0, "has_load": False})}
               for w in _weeks(start, end) }
    for row, muscle, credit in _credit_rows(conn, start, end):
        key = _iso(_monday(dates.from_iso(row["date"] + "T00:00:00").date()))
        bucket = weekly[key]
        bucket["credited_sets"] += credit
        bucket["sessions"].add(row["session_id"])
        muscle_bucket = bucket["muscles"][muscle]
        muscle_bucket["sets"] += credit
        exercise_bucket = bucket["exercises"][(muscle, row["exercise_title"])]
        exercise_bucket["sets"] += credit
        if row["volume"] is not None:
            attributed = float(row["volume"]) * credit
            bucket["load_total"] += attributed
            bucket["has_load"] = True
            muscle_bucket["load"] += attributed
            muscle_bucket["has_load"] = True
            exercise_bucket["load"] += attributed
            exercise_bucket["has_load"] = True
    return weekly


def _recovery_at_week_end(conn, week, period_end):
    as_of = min(week + timedelta(days=6), period_end)
    as_of_iso = _iso(as_of)
    prog = progression.analyze_all(conn, as_of_iso)
    if not prog:
        return {}, "insufficient_data", None
    fat = fatigue.assess(conn, as_of_iso)
    detail = balance.weekly_balance(conn, weeks=4, as_of=as_of_iso)
    # Do not call the retrospective accuracy validator here: it intentionally
    # evaluates across the full database and would leak future observations into
    # a historical point. Recovery itself is computed strictly as-of week end.
    recovery = volume.recovery_by_muscle(conn, as_of_iso, prog, fat.get("acwr_by_muscle", {}))
    scores = [item["score"] for item in recovery.values() if item.get("score") is not None]
    if not scores:
        return recovery, "insufficient_data", None
    mean = round(sum(scores) / len(scores), 2)
    state = "recovering_well" if mean >= 0.25 else "under_recovering" if mean <= -0.25 else "borderline"
    return recovery, state, mean


def _ratio(credits):
    landmarks = config.landmarks()
    push = pull = upper = lower = 0.0
    for muscle, amount in credits.items():
        meta = landmarks["muscles"].get(muscle)
        if not meta:
            continue
        if meta.get("side") == "push": push += amount
        elif meta.get("side") == "pull": pull += amount
        if meta.get("region") == "upper": upper += amount
        elif meta.get("region") == "lower": lower += amount
    targets = landmarks.get("ratios", {})
    return {
        "push_pull": round(push / pull, 2) if pull else None,
        "push_pull_target": targets.get("push_pull_target"),
        "upper_lower": round(upper / lower, 2) if lower else None,
        "upper_lower_target": targets.get("upper_lower_target"),
    }


def _aggregate_muscles(weekly):
    muscles = defaultdict(lambda: {"sets": 0.0, "recent": 0.0, "active": 0, "load": 0.0, "has_load": False, "weeks": [], "exercises": defaultdict(lambda: {"sets": 0.0, "load": 0.0, "has_load": False})})
    last_key = next(reversed(weekly), None)
    for week, bucket in weekly.items():
        for muscle, point in bucket["muscles"].items():
            item = muscles[muscle]
            item["sets"] += point["sets"]
            item["recent"] += point["sets"] if week == last_key else 0
            item["active"] += 1 if point["sets"] > 0 else 0
            item["load"] += point["load"]
            item["has_load"] = item["has_load"] or point["has_load"]
            item["weeks"].append({"week": week, "credited_sets": round(point["sets"], 1), "load_index": round(point["load"], 1) if point["has_load"] else None})
        for (muscle, exercise), point in bucket["exercises"].items():
            ex = muscles[muscle]["exercises"][exercise]
            ex["sets"] += point["sets"]
            ex["load"] += point["load"]
            ex["has_load"] = ex["has_load"] or point["has_load"]
    return muscles


def build(conn, range_name="12w", compare_requested=False):
    if range_name not in {*RANGE_WEEKS, "all"}:
        raise ValueError("range must be one of 4w, 8w, 12w, or all")
    start, end = _period(conn, range_name)
    selected_weekly = _series(conn, start, end)
    selected_weeks = len(selected_weekly)
    comparison_available = range_name != "all"
    previous = None
    previous_weekly = {}
    if compare_requested and comparison_available:
        previous_end = start - timedelta(days=1)
        previous_start = start - timedelta(days=7 * selected_weeks)
        previous = (previous_start, previous_end)
        previous_weekly = _series(conn, previous_start, previous_end)

    recovery_by_week = {}
    for week in selected_weekly:
        _, state, score = _recovery_at_week_end(conn, dates.from_iso(week + "T00:00:00").date(), end)
        recovery_by_week[week] = (state, score)
    weekly_rows = [{"week": week, "credited_sets": round(item["credited_sets"], 1),
                    "load_index": round(item["load_total"], 1) if item["has_load"] else None,
                    "sessions": len(item["sessions"]), "recovery_state": recovery_by_week[week][0],
                    "recovery_score": recovery_by_week[week][1]} for week, item in selected_weekly.items()]
    previous_rows = [{"week": week, "credited_sets": round(item["credited_sets"], 1),
                      "load_index": round(item["load_total"], 1) if item["has_load"] else None,
                      "sessions": len(item["sessions"]), "recovery_state": "unavailable", "recovery_score": None}
                     for week, item in previous_weekly.items()]

    latest_iso = _iso(end)
    prog = progression.analyze_all(conn, latest_iso)
    fat = fatigue.assess(conn, latest_iso)
    detail = balance.weekly_balance(conn, weeks=4, as_of=latest_iso)
    accuracy = backtest.form_validity(conn)
    plan = volume.recommend(conn, latest_iso, prog, fat, detail, accuracy)
    recommendations = {item["muscle"]: item for item in plan["recommendations"]}
    selected_muscles = _aggregate_muscles(selected_weekly)
    previous_muscles = _aggregate_muscles(previous_weekly)
    landmarks = config.landmarks()["muscles"]
    muscle_names = sorted(set(selected_muscles) | set(recommendations) | set(landmarks))
    muscles = []
    for muscle in muscle_names:
        current = selected_muscles[muscle]
        prior = previous_muscles.get(muscle)
        meta = landmarks.get(muscle, {})
        contributions = [{"exercise": exercise, "credited_sets": round(item["sets"], 1),
                          "load_index": round(item["load"], 1) if item["has_load"] else None}
                         for exercise, item in current["exercises"].items()]
        contributions.sort(key=lambda item: item["credited_sets"], reverse=True)
        cur_load = round(current["load"], 1) if current["has_load"] else None
        prior_load = round(prior["load"], 1) if prior and prior["has_load"] else None
        muscles.append({"muscle": muscle, "region": meta.get("region"),
                        "landmarks": {"mev": meta.get("mev"), "mav": meta.get("mav"), "mrv": meta.get("mrv")},
                        "credited_sets": round(current["sets"], 1), "recent_sets": round(current["recent"], 1),
                        "active_weeks": current["active"], "load_index": cur_load,
                        "recommendation": recommendations.get(muscle), "weekly": current["weeks"],
                        "exercise_contributions": contributions,
                        "comparison_delta": ({"credited_sets": round(current["sets"] - prior["sets"], 1),
                                              "load_index": round(cur_load - prior_load, 1) if cur_load is not None and prior_load is not None else None}
                                             if prior else None)})
    muscles.sort(key=lambda item: (0 if item["recommendation"] and item["recommendation"]["action"] not in ("hold",) else 1, -item["credited_sets"], item["muscle"]))

    total_sets = round(sum(point["credited_sets"] for point in weekly_rows), 1)
    total_load_values = [point["load_index"] for point in weekly_rows if point["load_index"] is not None]
    comparison_sets = round(sum(point["credited_sets"] for point in previous_rows), 1) if previous else None
    comparison_loads = [point["load_index"] for point in previous_rows if point["load_index"] is not None]
    total_target_gap = sum(rec["target_sets"] - rec["current_sets"] for rec in recommendations.values()) if recommendations else None
    ratios = _ratio({muscle: item["sets"] for muscle, item in selected_muscles.items()})
    return {"schema_version": 1, "range": range_name,
            "selected": {"from": _iso(start), "to": _iso(end), "weeks": selected_weeks},
            "previous": ({"from": _iso(previous[0]), "to": _iso(previous[1]), "weeks": selected_weeks} if previous else None),
            "comparison_available": comparison_available,
            "comparison_reason": None if comparison_available else "All history has no equal preceding period to compare.",
            "overview": {"credited_sets": total_sets, "target_gap": round(total_target_gap, 1) if total_target_gap is not None else None,
                         "muscles_requiring_action": sum(1 for rec in recommendations.values() if rec["action"] != "hold"),
                         "recovery_confidence": plan["recovery_confidence"], "recovery_confidence_basis": plan["recovery_confidence_basis"], **ratios},
            "comparison_overview": ({"credited_sets": comparison_sets,
                                     "load_index": round(sum(comparison_loads), 1) if comparison_loads else None} if previous else None),
            "weekly": weekly_rows, "previous_weekly": previous_rows, "muscles": muscles}
