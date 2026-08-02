"""Muscle-group balance: weekly sets vs MEV/MAV/MRV, push/pull & upper/lower."""
from datetime import timedelta
from collections import defaultdict
from . import config, dates, progression


def _window_bounds(conn, weeks, as_of=None):
    as_of = as_of or progression.latest_date(conn)
    end = dates.from_iso(as_of + "T23:59:59")
    start = end - timedelta(weeks=weeks)
    return start.strftime("%Y-%m-%d"), as_of


def muscle_credits(conn, start_date, end_date):
    """Credited set counts per muscle in [start,end]: primary 1.0, secondary
    (config secondary_set_credit, default 0.5)."""
    sec_credit = config.settings().get("secondary_set_credit", 0.5)
    rows = conn.execute(
        """SELECT exercise_title, COUNT(*) n FROM sets
           WHERE is_working=1 AND date > ? AND date <= ?
           GROUP BY exercise_title""", (start_date, end_date)).fetchall()
    credits = defaultdict(float)
    for r in rows:
        info = config.exercise_info(r["exercise_title"])
        credits[info["primary"]] += r["n"]
        for sec in info.get("secondary", []):
            credits[sec] += sec_credit * r["n"]
    return credits


def weekly_buckets(conn, weeks=4, as_of=None):
    """Credited sets per muscle, bucketed into the last `weeks` 7-day windows.
    Returns {muscle: [c_recent, ..., c_oldest]} (index 0 = most recent week)."""
    as_of = as_of or progression.latest_date(conn)
    end = dates.from_iso(as_of + "T23:59:59")
    buckets = defaultdict(lambda: [0.0] * weeks)
    for i in range(weeks):
        wk_end = (end - timedelta(weeks=i)).strftime("%Y-%m-%d")
        wk_start = (end - timedelta(weeks=i + 1)).strftime("%Y-%m-%d")
        for m, c in muscle_credits(conn, wk_start, wk_end).items():
            buckets[m][i] = c
    return buckets


def _ewma(buckets, halflife):
    """Recency-weighted mean over weekly buckets (index 0 = most recent). Empty
    weeks count toward the denominator, so a frequency collapse pulls it down."""
    if not buckets:
        return 0.0
    weights = [0.5 ** (i / halflife) for i in range(len(buckets))]
    wsum = sum(weights)
    return sum(w * c for w, c in zip(weights, buckets)) / wsum if wsum else 0.0


def weekly_balance(conn, weeks=4, as_of=None):
    s = config.settings()
    halflife = s.get("volume_ewma_halflife_weeks", 2)
    buckets = weekly_buckets(conn, weeks, as_of)
    lm = config.landmarks()["muscles"]
    out = {}

    def detail(muscle, bk):
        per_week = round(sum(bk) / weeks, 1)
        return {"sets_per_week": per_week,
                "sets_per_week_ewma": round(_ewma(bk, halflife), 1),
                "sets_recent_7d": round(bk[0], 1),
                "active_weeks_4wk": sum(1 for c in bk if c > 0)}

    for muscle, mk in lm.items():
        bk = buckets.get(muscle, [0.0] * weeks)
        d = detail(muscle, bk)
        per_week = d["sets_per_week"]
        if per_week < mk["mev"]:
            status = "under_MEV"
        elif per_week > mk["mrv"]:
            status = "over_MRV"
        else:
            status = "in_range"
        d.update({"status": status, "mev": mk["mev"], "mav": mk["mav"],
                  "mrv": mk["mrv"], "region": mk["region"]})
        out[muscle] = d
    # muscles not in landmarks (e.g. 'other')
    for muscle, bk in buckets.items():
        if muscle not in out:
            d = detail(muscle, bk)
            d.update({"status": "untracked", "mev": None, "mav": None,
                      "mrv": None, "region": None})
            out[muscle] = d
    return out


def ratios(conn, weeks=4, as_of=None):
    start, end = _window_bounds(conn, weeks, as_of)
    credits = muscle_credits(conn, start, end)
    lm = config.landmarks()["muscles"]
    push = pull = upper = lower = 0.0
    for muscle, c in credits.items():
        mk = lm.get(muscle)
        if not mk:
            continue
        if mk["side"] == "push":
            push += c
        elif mk["side"] == "pull":
            pull += c
        if mk["region"] == "upper":
            upper += c
        elif mk["region"] == "lower":
            lower += c
    rcfg = config.landmarks()["ratios"]
    return {
        "push_pull": round(push / pull, 2) if pull else None,
        "push_pull_target": rcfg["push_pull_target"],
        "upper_lower": round(upper / lower, 2) if lower else None,
        "upper_lower_target": rcfg["upper_lower_target"],
        "push_sets": round(push, 1), "pull_sets": round(pull, 1),
        "upper_sets": round(upper, 1), "lower_sets": round(lower, 1),
    }


def this_week_sets(conn, as_of=None):
    """Credited sets per muscle over the last 7 days (rounded)."""
    start, end = _window_bounds(conn, 1, as_of)
    credits = muscle_credits(conn, start, end)
    return {m: round(c, 1) for m, c in sorted(credits.items(), key=lambda x: -x[1])}


def neglected(conn, weeks=4, as_of=None):
    """Muscles below MEV, worst first."""
    wb = weekly_balance(conn, weeks, as_of)
    out = [(m, d) for m, d in wb.items() if d["status"] == "under_MEV"]
    out.sort(key=lambda x: (x[1]["sets_per_week"] - x[1]["mev"]))
    return out
