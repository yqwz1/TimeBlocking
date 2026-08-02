"""Forecast future e1RM and pace-vs-goal. Honest: reports plateau or
'insufficient data' rather than extrapolating noise.

The projection is a *damped* trend - the recent weekly slope, decayed over the
horizon so far-out weeks count for less - bounded by a fitted strength ceiling.
Lifting gains decelerate, so a raw linear extrapolation of a good recent slope
8 weeks out systematically over-shoots (the same lesson the rep-predictor
learned vs its naive baseline). The uncertainty band is *calibrated* from
walk-forward forecast errors (see accuracy()) rather than raw slope quartiles,
so a stated band covers about its nominal rate. Both the report and the
backtest project through project_point(), so they can never drift apart.
"""
import math
import statistics
from datetime import timedelta
from . import config, dates, progression, plateau, trend, conformal


# --------------------------------------------------------------------------
# Core projection (pure) - shared by the report and the backtest
# --------------------------------------------------------------------------
def _damped_horizon(phi, h):
    """Effective horizon in 'slope-weeks': sum_{t=1..h} phi^t.
    phi>=1 -> h (plain linear); 0<phi<1 -> geometric decay (gains taper off)."""
    if phi >= 1.0:
        return float(h)
    if phi <= 0.0:
        return 0.0
    return phi * (1.0 - phi ** h) / (1.0 - phi)


def project_point(anchor, slope_per_week, horizon_weeks, phi=1.0, ceiling=None):
    """Project e1RM `horizon_weeks` ahead. Damped trend, then capped so a rising
    lift can't be projected past a credible ceiling. phi=1 + no ceiling
    reproduces the old linear behavior, so the backtest can A/B them."""
    proj = anchor + slope_per_week * _damped_horizon(phi, horizon_weeks)
    if ceiling is not None and slope_per_week > 0 and ceiling > anchor:
        proj = min(proj, ceiling)
    return proj


def _credible_ceiling(series, anchor):
    """The asymptotic-fit ceiling, but only when it's a believable upper bound:
    above the current value and not absurdly far past the trained range. Returns
    None when ceilings shouldn't be applied (config) or the fit isn't credible."""
    s = config.settings()
    if not s.get("forecast_use_ceiling", True):
        return None
    asy = plateau.asymptotic(series)
    if not asy:
        return None
    c = asy["ceiling"]
    if c is None or c <= anchor or c > anchor * s.get("forecast_ceiling_max_ratio", 1.6):
        return None
    return c


# --------------------------------------------------------------------------
# Per-exercise forecast (what the report/dashboard render)
# --------------------------------------------------------------------------
def _band(point, anchor, calib, prog, h, flat):
    """Prediction band around the point estimate. Prefer the calibrated relative
    half-width from walk-forward errors; fall back to the trend's own
    slope-quartile spread (the pre-calibration behavior)."""
    if calib and calib.get("rel_halfwidth") is not None and anchor:
        half = anchor * calib["rel_halfwidth"]
        return [round(point - half, 1), round(point + half, 1)]
    if flat:
        return None
    lo, hi = prog["trend_band"] or (0.0, 0.0)
    return [round(anchor + lo * h, 1), round(anchor + hi * h, 1)]


def forecast_exercise(prog, calib=None):
    """prog: a progression.analyze_exercise() result. calib: optional
    {'rel_halfwidth', 'level'} from accuracy(); when absent (e.g. too little
    history) the band falls back to the slope-quartile spread. Returns a
    forecast dict with the same keys the report/dashboard already consume."""
    s = config.settings()
    h = s["forecast_horizon_weeks"]
    phi = s.get("forecast_damping", 1.0)
    status = prog["status"]
    slope = prog["e1rm_trend_per_week"]
    series = prog["series"]
    if status in ("building", "insufficient") or slope is None or not series:
        return {"trend": status, "horizon_weeks": h, "e1rm_in_horizon": None,
                "band": None, "note": "Not enough clean data in the current unit-epoch yet."}
    anchor = series[-1][1]
    if status == "plateau":
        point = round(anchor, 1)
        return {"trend": "plateau", "horizon_weeks": h, "e1rm_in_horizon": point,
                "band": _band(point, anchor, calib, prog, h, flat=True),
                "note": "Flat trend - projecting roughly steady; change a variable to break it."}
    ceiling = _credible_ceiling(series, anchor)
    point = round(project_point(anchor, slope, h, phi, ceiling), 1)
    note = None
    if ceiling is not None and point >= ceiling - 0.05:
        note = (f"Approaching an estimated ceiling near {round(ceiling, 1)} - "
                "gains likely to slow; change a variable to push past it.")
    return {"trend": status, "horizon_weeks": h, "e1rm_in_horizon": point,
            "band": _band(point, anchor, calib, prog, h, flat=False), "note": note}


# --------------------------------------------------------------------------
# Walk-forward accuracy + band calibration (the scoreboard)
# --------------------------------------------------------------------------
def _e1rm_series(conn, ex):
    epoch = progression.current_epoch(conn, ex)
    rows = conn.execute(
        """SELECT date, MAX(e1rm) e FROM sets WHERE exercise_title=? AND epoch=?
             AND e1rm IS NOT NULL GROUP BY date ORDER BY date""", (ex, epoch))
    return [(r["date"], r["e"]) for r in rows]


def _walk_forward_errors(conn):
    """Replay history with only-prior data: at each session, fit the trend on
    everything before it and forecast e1RM ~horizon weeks out, then compare to
    what actually happened. Returns one record per realized forecast with the
    error of the damped+ceiling model, a flat 'no change' baseline, and a linear
    (un-damped, no-ceiling) reference."""
    s = config.settings()
    minp, h = s["forecast_min_points"], s["forecast_horizon_weeks"]
    phi = s.get("forecast_damping", 1.0)
    out = []
    exs = [r["exercise_title"] for r in conn.execute(
        "SELECT DISTINCT exercise_title FROM sets WHERE is_working=1")]
    for ex in exs:
        ser = _e1rm_series(conn, ex)
        if len(ser) < minp + 1:
            continue
        base0 = dates.from_iso(ser[0][0] + "T00:00:00")
        for i in range(minp, len(ser)):
            di = dates.from_iso(ser[i - 1][0] + "T00:00:00")
            pts = [((dates.from_iso(d + "T00:00:00") - base0).days, e) for d, e in ser[:i]]
            fit = trend.theil_sen(pts)
            if not fit:
                continue
            slope_wk = fit["slope"] * 7.0
            anchor = ser[i - 1][1]
            target_day = di + timedelta(weeks=h)
            actual = next(((d, e) for d, e in ser[i:]
                           if abs((dates.from_iso(d + "T00:00:00") - target_day).days) <= 21),
                          None)
            if not actual:
                continue
            # project to the ACTUAL observation's horizon for a fair comparison
            wk = (dates.from_iso(actual[0] + "T00:00:00") - di).days / 7.0
            ceiling = _credible_ceiling(ser[:i], anchor)
            model = project_point(anchor, slope_wk, wk, phi, ceiling)
            linear = project_point(anchor, slope_wk, wk, 1.0, None)
            a = actual[1]
            out.append({"anchor": anchor,
                        "model_err": abs(model - a),
                        "flat_err": abs(anchor - a),
                        "linear_err": abs(linear - a),
                        "rel_err": (abs(model - a) / anchor) if anchor else None})
    return out


def accuracy(conn):
    """Forecast scoreboard + band calibration from one walk-forward pass.
    Reports model vs a flat 'no change' baseline (the key honesty check) and vs
    the old linear extrapolation, plus the relative band half-width at the
    configured level and its (in-sample) coverage."""
    s = config.settings()
    level = s.get("forecast_band_level", 0.8)
    rows = _walk_forward_errors(conn)
    if not rows:
        return {"n": 0, "note": "not enough data",
                "calib": {"rel_halfwidth": None, "level": level, "n": 0}}
    model = [r["model_err"] for r in rows]
    flat = [r["flat_err"] for r in rows]
    linear = [r["linear_err"] for r in rows]
    rels = sorted(r["rel_err"] for r in rows if r["rel_err"] is not None)
    # design 06: the band was already split-conformal in all but name (absolute-
    # residual nonconformity score, empirical quantile, symmetric band). When
    # conformal is enabled, read the finite-sample-corrected quantile instead of the
    # plain percentile - the only visible effect is a slightly wider band at small n
    # (the finite-sample honesty the plain percentile omits). Disabled = unchanged.
    if len(rels) < 8:
        half = None
    elif conformal._conformal_cfg()["enabled"]:
        q = conformal.conformal_quantile(rels, 1.0 - level)
        half = round(q, 4) if math.isfinite(q) else None
    else:
        half = round(trend._percentile(rels, level), 4)
    calib = {"rel_halfwidth": half, "level": level, "n": len(rels)}
    coverage = None
    if half is not None:
        inside = sum(1 for r in rows if r["anchor"] and r["model_err"] <= r["anchor"] * half)
        coverage = round(inside / len(rows), 2)
    return {"n": len(rows),
            "model_mae": round(statistics.mean(model), 2),
            "flat_mae": round(statistics.mean(flat), 2),
            "linear_mae": round(statistics.mean(linear), 2),
            "beats_flat": statistics.mean(model) < statistics.mean(flat),
            "beats_linear": statistics.mean(model) <= statistics.mean(linear),
            "median_ae": round(statistics.median(model), 2),
            "band_level": level, "band_coverage": coverage, "calib": calib}


# --------------------------------------------------------------------------
# Pace toward a goal (unchanged behavior)
# --------------------------------------------------------------------------
def pace_vs_goal(conn, goal, prog_map):
    """goal: a row from goals. prog_map: {exercise: progression result}.
    Returns pace assessment toward an e1rm or weight-for-reps target."""
    ex = goal["exercise_title"]
    prog = prog_map.get(ex)
    out = {"goal_id": goal["goal_id"], "exercise": ex, "metric": goal["metric"],
           "target_value": goal["target_value"], "target_reps": goal["target_reps"],
           "target_date": goal["target_date"], "current": None,
           "projected_date": None, "weeks_needed": None}
    if not prog or prog["best_e1rm"] is None:
        out.update(verdict="unknown", projected_date=None,
                   note="No trend yet for this lift.")
        return out
    current = prog["best_e1rm"]
    slope = prog["e1rm_trend_per_week"]
    target = goal["target_value"]
    out["current"] = current
    if current >= target:
        out.update(verdict="achieved", projected_date=None)
        return out
    if not slope or slope <= 0:
        out.update(verdict="off_track", projected_date=None,
                   note="Lift is flat/declining; current plan won't reach the goal.")
        return out
    weeks_needed = (target - current) / slope
    proj_dt = dates.from_iso(progression.latest_date(conn) + "T00:00:00") + \
        timedelta(weeks=weeks_needed)
    out["projected_date"] = proj_dt.strftime("%Y-%m-%d")
    out["weeks_needed"] = round(weeks_needed, 1)
    if goal["target_date"]:
        verdict = "on_track" if proj_dt <= dates.from_iso(goal["target_date"] + "T00:00:00") \
            else "behind"
    else:
        verdict = "on_track"
    out["verdict"] = verdict
    return out
