"""Change-point / plateau detection and deload + detraining intelligence.

Operates on a per-exercise e1RM session series (current unit-epoch). Combines
segmented (piecewise-linear) regression, CUSUM, and an asymptotic-ceiling fit -
all pure Python - to answer "has this lift stalled, and how close is it to its
ceiling?", then derives evidence-based deload and detraining advice.
"""
import math
import statistics
from datetime import timedelta
from . import config, dates, progression, trend, individualize as ind


def _xy(series):
    """series: [(date_str, value)] -> (days_from_first, values, dates)."""
    if not series:
        return [], [], []
    base = dates.from_iso(series[0][0] + "T00:00:00")
    xs = [(dates.from_iso(d + "T00:00:00") - base).days for d, _ in series]
    ys = [v for _, v in series]
    return xs, ys, [d for d, _ in series]


def segmented(series, min_seg=3):
    """Best single breakpoint (min total SSE). Returns onset date + slopes."""
    xs, ys, ds = _xy(series)
    n = len(series)
    if n < 2 * min_seg:
        return None
    best = None
    for k in range(min_seg, n - min_seg + 1):
        left = ind.ols(xs[:k], ys[:k])
        right = ind.ols(xs[k:], ys[k:])
        if not left or not right:
            continue
        sse = (left["resid_std"] ** 2 * (k - 2) +
               right["resid_std"] ** 2 * (n - k - 2))
        if best is None or sse < best["sse"]:
            best = {"sse": sse, "k": k, "onset": ds[k],
                    "left_slope_wk": round(left["slope"] * 7, 3),
                    "right_slope_wk": round(right["slope"] * 7, 3)}
    return best


def cusum(series, threshold=4.0, baseline_n=None):
    """Detect a sustained downward level shift in e1RM. Returns onset date|None."""
    xs, ys, ds = _xy(series)
    if len(ys) < 6:
        return None
    bn = baseline_n or max(3, len(ys) // 3)
    mu = statistics.mean(ys[:bn])
    sd = statistics.pstdev(ys[:bn]) or (statistics.pstdev(ys) or 1.0)
    c = 0.0
    for i in range(bn, len(ys)):
        c = min(0.0, c + (ys[i] - mu) / sd)   # accumulate negative drift
        if -c > threshold:
            return ds[i]
    return None


def asymptotic(series):
    """Fit load(t)=A-(A-B)e^{-k t} via grid over k + linear LS for A,B.
    Returns estimated ceiling A, current value, and % of ceiling reached."""
    xs, ys, _ = _xy(series)
    if len(ys) < 5 or xs[-1] == 0:
        return None
    best = None
    span = xs[-1]
    for k in [g / span for g in (0.3, 0.6, 1.0, 1.5, 2.5, 4.0, 6.0)]:
        # load = A*(1-e^{-k t}) + B*e^{-k t}; linear in A,B
        feats = [(1 - math.exp(-k * t), math.exp(-k * t)) for t in xs]
        sa = sum(f[0] for f in feats); sb = sum(f[1] for f in feats)
        saa = sum(f[0] ** 2 for f in feats); sbb = sum(f[1] ** 2 for f in feats)
        sab = sum(f[0] * f[1] for f in feats)
        say = sum(f[0] * y for f, y in zip(feats, ys))
        sby = sum(f[1] * y for f, y in zip(feats, ys))
        det = saa * sbb - sab * sab
        if abs(det) < 1e-9:
            continue
        A = (say * sbb - sby * sab) / det
        B = (saa * sby - sab * say) / det
        sse = sum((y - (A * f[0] + B * f[1])) ** 2 for f, y in zip(feats, ys))
        if best is None or sse < best["sse"]:
            best = {"sse": sse, "ceiling": round(A, 1), "k": k, "base": round(B, 1)}
    if not best or best["ceiling"] <= 0:
        return None
    cur = ys[-1]
    pct = round(100 * cur / best["ceiling"]) if best["ceiling"] else None
    return {"ceiling": best["ceiling"], "current": round(cur, 1),
            "pct_of_ceiling": pct}


def status(series):
    """Combined plateau verdict for one lift."""
    if len(series) < config.settings()["forecast_min_points"]:
        return {"verdict": "insufficient"}
    seg = segmented(series)
    decline = cusum(series)
    asy = asymptotic(series)
    verdict, onset = "progressing", None
    if seg:
        rs = seg["right_slope_wk"]
        if rs < -0.05:
            verdict, onset = "declining", seg["onset"]
        elif abs(rs) <= 0.05 and seg["left_slope_wk"] > 0.05:
            verdict, onset = "plateau", seg["onset"]
    if decline:
        verdict = "declining"
        onset = onset or decline
    return {"verdict": verdict, "onset": onset,
            "segment": seg, "ceiling": asy}


# --------------------------------------------------------------------------
# Detraining + deload
# --------------------------------------------------------------------------
def detraining(conn, today=None):
    """Compare the REAL current date (not the last session) to the last session,
    so a stale gap surfaces. `today` is a 'YYYY-MM-DD' string (defaults to now)."""
    from datetime import datetime
    today = today or datetime.now().strftime("%Y-%m-%d")
    p = config.priors()["detraining"]
    last = conn.execute("SELECT MAX(date) d FROM sessions WHERE date<=?",
                        (today,)).fetchone()["d"]
    if not last:
        return None
    gap = (dates.from_iso(today + "T00:00:00") - dates.from_iso(last + "T00:00:00")).days
    if gap < p["days_flag"]:
        return None
    weeks = gap / 7.0
    table = {int(k): v for k, v in p["strength_loss_pct_by_week"].items()}
    keys = sorted(table)
    loss = table[keys[-1]]
    for wk in keys:
        if weeks <= wk:
            loss = table[wk]
            break
    return {"gap_days": gap, "weeks": round(weeks, 1),
            "est_strength_loss_pct": loss,
            "return_volume_pct": p["return_volume_pct"],
            "message": (f"{gap} days since your last session (~{round(weeks,1)} wks). "
                        f"Expect ~{loss}% strength dip; resume at "
                        f"~{p['return_volume_pct']}% of normal volume and ramp over 3-4 wks.")}


def deload_recommendation(conn, prog_map, plateau_map, fatigue_obj, balance_detail):
    """Advisory deload trigger from plateaus + fatigue + volume vs MRV."""
    p = config.priors()["deload"]
    reasons = []
    stalled = [ex for ex, st in plateau_map.items()
               if st.get("verdict") in ("plateau", "declining")]
    if len(stalled) >= 2:
        reasons.append(f"{len(stalled)} key lifts stalled or declining "
                       f"({', '.join(stalled[:4])})")
    if fatigue_obj.get("readiness") == "red":
        reasons.append("readiness is red (" + fatigue_obj["reasons"][0] + ")")
    over = [m for m, d in balance_detail.items() if d.get("status") == "over_MRV"]
    if over:
        reasons.append("volume over MRV for: " + ", ".join(over))
    if not reasons:
        return None
    return {"due": True, "reasons": reasons,
            "protocol": (f"Cut working-set volume ~{p['volume_drop_pct']}% for 1 week, "
                         "keep load/intensity, then resume."),
            "note": "Advisory - your call. Proactive deloads (every "
                    f"{p['proactive_block_weeks']} wks) beat waiting for a wall."}
