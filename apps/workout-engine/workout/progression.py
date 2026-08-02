"""Per-exercise progression: e1RM trend, PRs, plateau / decline detection."""
from datetime import timedelta
from . import config, trend, dates


def latest_date(conn):
    row = conn.execute("SELECT MAX(date) d FROM sessions").fetchone()
    return row["d"]


def exercise_names(conn, min_sets=None):
    """Exercises worth analysing, most-recently-trained first.

    min_sets is the minimum number of working sets (lifetime) for a lift to be
    tracked. Defaults to the `min_sets_to_track` setting (1) so any lift you've
    actually performed shows up - lifts with <2 sessions just can't chart a
    trend yet and read as "building" until a second session lands."""
    if min_sets is None:
        min_sets = config.settings().get("min_sets_to_track", 1)
    rows = conn.execute(
        """SELECT exercise_title, COUNT(*) n, MAX(date) last
           FROM sets WHERE is_working=1 GROUP BY exercise_title
           HAVING n >= ? ORDER BY last DESC, n DESC""", (min_sets,)
    ).fetchall()
    return [r["exercise_title"] for r in rows]


def _session_best_e1rm(conn, ex, epoch=None):
    """[(date, best_e1rm)] one point per session, optionally a single epoch."""
    q = ("SELECT date, MAX(e1rm) e FROM sets WHERE exercise_title=? "
         "AND e1rm IS NOT NULL")
    args = [ex]
    if epoch is not None:
        q += " AND epoch=?"
        args.append(epoch)
    q += " GROUP BY date ORDER BY date"
    return [(r["date"], r["e"]) for r in conn.execute(q, args)]


def current_epoch(conn, ex):
    row = conn.execute(
        "SELECT MAX(epoch) e FROM sets WHERE exercise_title=?", (ex,)
    ).fetchone()
    return row["e"] if row and row["e"] is not None else 0


def analyze_exercise(conn, ex, as_of=None):
    s = config.settings()
    as_of = as_of or latest_date(conn)
    as_of_dt = dates.from_iso(as_of + "T00:00:00")
    epoch = current_epoch(conn, ex)

    series = _session_best_e1rm(conn, ex, epoch)
    # Trend over the trailing window, within the current unit-epoch. If the
    # calendar window is too thin (sparse recent training), fall back to the
    # last few sessions of this epoch so established lifts still show a trend.
    min_pts = s["forecast_min_points"]
    win_start = as_of_dt - timedelta(weeks=s["forecast_window_weeks"])
    win = [(d, e) for d, e in series
           if dates.from_iso(d + "T00:00:00") >= win_start]
    if len(win) < min_pts and len(series) >= min_pts:
        win = series[-max(min_pts, 8):]
    if win:
        base_dt = dates.from_iso(win[0][0] + "T00:00:00")
        points = [((dates.from_iso(d + "T00:00:00") - base_dt).days, e) for d, e in win]
    else:
        points = []
    fit = trend.theil_sen(points) if len(points) >= 2 else None
    status = trend.classify(fit) if len(win) >= min_pts else "building"

    slope_wk = round(fit["slope"] * 7, 3) if fit else None
    band = ([round(fit["slope_lo"] * 7, 3), round(fit["slope_hi"] * 7, 3)]
            if fit else None)
    conf = trend.confidence(len(win)) if fit else "low"

    # PRs (within current epoch where load comparisons make sense)
    best = conn.execute(
        """SELECT weight_raw, reps_clean, e1rm, date FROM sets
           WHERE exercise_title=? AND epoch=? AND e1rm IS NOT NULL
           ORDER BY e1rm DESC LIMIT 1""", (ex, epoch)).fetchone()
    heaviest = conn.execute(
        """SELECT weight_raw, reps_clean, date FROM sets
           WHERE exercise_title=? AND epoch=? AND weight_raw IS NOT NULL
           ORDER BY weight_raw DESC, reps_clean DESC LIMIT 1""", (ex, epoch)).fetchone()
    best_vol = conn.execute(
        """SELECT date, ROUND(SUM(volume),1) v FROM sets
           WHERE exercise_title=? AND epoch=? GROUP BY date
           ORDER BY v DESC LIMIT 1""", (ex, epoch)).fetchone()

    recent_cut = (as_of_dt - timedelta(days=s["recent_pr_window_days"])).strftime("%Y-%m-%d")
    recent_pr = None
    if best and best["date"] >= recent_cut:
        recent_pr = {"type": "e1rm", "value": best["e1rm"], "date": best["date"]}
    elif heaviest and heaviest["date"] >= recent_cut:
        recent_pr = {"type": "weight", "value": heaviest["weight_raw"],
                     "reps": heaviest["reps_clean"], "date": heaviest["date"]}

    # Decline cross-check: latest below trailing median by > threshold
    if status not in ("declining", "building") and len(win) >= 4:
        import statistics as st
        med = st.median([e for _, e in win[:-1]]) if len(win) > 1 else win[-1][1]
        if med and win[-1][1] < med * (1 - s["regression_drop_pct"] / 100.0):
            status = "declining"

    return {
        "name": ex,
        "epoch": epoch,
        "last_trained": series[-1][0] if series else None,
        "n_sessions": len(series),
        "best_e1rm": best["e1rm"] if best else None,
        "best_e1rm_set": (f"{best['weight_raw']:g}x{best['reps_clean']}"
                          if best else None),
        "heaviest": (f"{heaviest['weight_raw']:g}x{heaviest['reps_clean']}"
                     if heaviest else None),
        "best_session_volume": best_vol["v"] if best_vol else None,
        "e1rm_trend_per_week": slope_wk,
        "trend_band": band,
        "trend_confidence": conf,
        "status": status,
        "recent_pr": recent_pr,
        "series": series,
    }


def analyze_all(conn, as_of=None):
    return {ex: analyze_exercise(conn, ex, as_of) for ex in exercise_names(conn)}
