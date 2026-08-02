"""Experiment-and-compare engine: does higher volume (or higher effort) actually
produce faster progress for THIS user? Advisory only - never changes anything.

Method: for each muscle, track its most-trained lift's month-over-month e1RM
gain against that muscle's weekly set volume, then compare gains in higher- vs
lower-volume months. Sparse single-user data -> conservative, low-confidence
verdicts, clearly labeled.
"""
import statistics
from collections import defaultdict
from . import config, dates

WEEKS_PER_MONTH = 4.345


def representative_lift(conn, muscle):
    row = conn.execute(
        """SELECT exercise_title, COUNT(*) c FROM sets
           WHERE primary_muscle=? AND is_working=1 AND e1rm IS NOT NULL
           GROUP BY exercise_title ORDER BY c DESC LIMIT 1""", (muscle,)).fetchone()
    return row["exercise_title"] if row else None


def _monthly_volume(conn, muscle):
    """Credited weekly sets per month for a muscle (primary 1.0 + secondary 0.5)."""
    rows = conn.execute(
        "SELECT date, exercise_title FROM sets WHERE is_working=1").fetchall()
    by_month = defaultdict(float)
    for r in rows:
        info = config.exercise_info(r["exercise_title"])
        if info["primary"] == muscle:
            by_month[r["date"][:7]] += 1.0
        elif muscle in info.get("secondary", []):
            by_month[r["date"][:7]] += 0.5
    return {m: v / WEEKS_PER_MONTH for m, v in by_month.items()}


def _monthly_e1rm(conn, lift):
    rows = conn.execute(
        """SELECT substr(date,1,7) m, MAX(e1rm) e FROM sets
           WHERE exercise_title=? AND e1rm IS NOT NULL
             AND epoch=(SELECT MAX(epoch) FROM sets WHERE exercise_title=?)
           GROUP BY m ORDER BY m""", (lift, lift)).fetchall()
    return {r["m"]: r["e"] for r in rows}


def analyze_muscle(conn, muscle):
    lift = representative_lift(conn, muscle)
    if not lift:
        return None
    vol = _monthly_volume(conn, muscle)
    e1 = _monthly_e1rm(conn, lift)
    months = sorted(e1)
    pairs = []  # (volume_that_month, e1rm_gain_vs_prev_month)
    for i in range(1, len(months)):
        m, prev = months[i], months[i - 1]
        if m in vol:
            pairs.append((vol[m], e1[m] - e1[prev]))
    if len(pairs) < 4:
        return {"muscle": muscle, "lift": lift, "verdict": "insufficient",
                "months": len(pairs)}
    med = statistics.median(v for v, _ in pairs)
    high = [g for v, g in pairs if v >= med]
    low = [g for v, g in pairs if v < med]
    if not high or not low:
        return {"muscle": muscle, "lift": lift, "verdict": "insufficient",
                "months": len(pairs)}
    hi_gain, lo_gain = statistics.mean(high), statistics.mean(low)
    diff = hi_gain - lo_gain
    if diff > 0.3:
        verdict = "more_volume_better"
    elif diff < -0.3:
        verdict = "less_volume_as_good"
    else:
        verdict = "no_clear_difference"
    return {"muscle": muscle, "lift": lift, "verdict": verdict,
            "months": len(pairs),
            "high_vol_sets": round(statistics.mean([v for v, _ in pairs if v >= med]), 1),
            "low_vol_sets": round(statistics.mean([v for v, _ in pairs if v < med]), 1),
            "high_vol_gain": round(hi_gain, 2), "low_vol_gain": round(lo_gain, 2),
            "confidence": "low" if len(pairs) < 8 else "moderate"}


_VERDICT_TEXT = {
    "more_volume_better": "higher volume drove faster gains",
    "less_volume_as_good": "lower volume produced equal-or-better gains (less may be more here)",
    "no_clear_difference": "volume level didn't clearly change your rate of gain",
}


def analyze(conn):
    muscles = ["chest", "back", "shoulders", "biceps", "triceps", "quads", "hamstrings"]
    out = []
    for m in muscles:
        a = analyze_muscle(conn, m)
        if a and a["verdict"] != "insufficient":
            a["text"] = (f"For {m} ({a['lift']}): {_VERDICT_TEXT[a['verdict']]} "
                         f"(~{a['high_vol_sets']} vs ~{a['low_vol_sets']} sets/wk -> "
                         f"+{a['high_vol_gain']} vs +{a['low_vol_gain']} e1RM/mo; "
                         f"{a['confidence']} confidence, {a['months']} mo).")
            out.append(a)
    rpe_present = conn.execute(
        "SELECT COUNT(*) c FROM sets WHERE rpe IS NOT NULL").fetchone()["c"] > 0
    return {"muscles": out,
            "effort_comparison_available": rpe_present,
            "note": ("Log RPE to also compare high-effort vs high-volume styles."
                     if not rpe_present else None)}
