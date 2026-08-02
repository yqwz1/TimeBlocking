"""Objective fatigue / readiness without RPE.

Raw kg is unreliable across exercises, so every load here is normalized volume
(weight indexed to each exercise's epoch baseline). When RPE arrives later it
can replace the inferred load multiplier; until then these are honest proxies.
"""
import statistics
from datetime import timedelta
from collections import defaultdict, deque
from . import config, dates, progression


def _daterange(as_of, n):
    end = dates.from_iso(as_of + "T00:00:00")
    return [(end - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(n)]


def daily_load_total(conn):
    rows = conn.execute(
        """SELECT date, SUM(COALESCE(volume,0)) v FROM sets
           WHERE is_working=1 GROUP BY date""").fetchall()
    return {r["date"]: r["v"] for r in rows}


def daily_load_by_muscle(conn):
    rows = conn.execute(
        """SELECT date, primary_muscle, SUM(COALESCE(volume,0)) v FROM sets
           WHERE is_working=1 GROUP BY date, primary_muscle""").fetchall()
    out = defaultdict(dict)
    for r in rows:
        out[r["primary_muscle"]][r["date"]] = r["v"]
    return out


def _active_days(loads, as_of, n):
    """Count of days in the trailing n-day window that carried any load."""
    return sum(1 for d in _daterange(as_of, n) if loads.get(d, 0.0) > 0)


def acwr(loads, as_of):
    """Raw acute:chronic workload ratio with only the minimal anti-blow-up floor
    (chronic must hold >= `acwr_chronic_min_days` active days, else None). This is
    the legacy helper still used by the advisory recovery backtest; the live
    readiness path goes through `acwr_gated` (roadmap #3), which adds the full
    adequacy gate, uncoupling, EWMA and the state machine."""
    s = config.settings()
    acute_days, chronic_days = s["acwr_acute_days"], s["acwr_chronic_days"]
    min_chronic = s.get("acwr_chronic_min_days", 6)
    chronic_vals = [loads.get(d, 0.0) for d in _daterange(as_of, chronic_days)]
    acute = statistics.mean([loads.get(d, 0.0) for d in _daterange(as_of, acute_days)])
    chronic = statistics.mean(chronic_vals)
    if chronic <= 0 or sum(1 for v in chronic_vals if v > 0) < min_chronic:
        return None
    return round(acute / chronic, 2)


# --------------------------------------------------------------------------
# Gated ACWR + readiness state machine (roadmap #3): kill the 4.0 false alarm.
# The fix is the ADEQUACY GATE - ACWR is only interpretable when there is a
# credible chronic base for the acute load to be relative to. Without one the
# state is DETRAINED/RETURNING (ramp up), never SPIKING (back off). Uncoupling
# and EWMA are robustness polish, NOT the fix: a ratio of EWMAs still explodes as
# the chronic trace decays toward 0 after a gap - only the gate stops that.
# --------------------------------------------------------------------------
def _dense_daily(loads, first_day, as_of):
    """[(date, load)] for EVERY calendar day first_day..as_of inclusive (rest
    days = 0), so the EWMAs and the rolling reference decay across gaps."""
    out = []
    cur = dates.from_iso(first_day + "T00:00:00")
    end = dates.from_iso(as_of + "T00:00:00")
    while cur <= end:
        d = cur.strftime("%Y-%m-%d")
        out.append((d, loads.get(d, 0.0)))
        cur += timedelta(days=1)
    return out


def _date_band(as_of, lo, hi):
    """Days from (as_of - lo) up to but excluding (as_of - hi): the window
    [hi, lo) days back. Used to exclude the acute window from chronic (uncouple)."""
    end = dates.from_iso(as_of + "T00:00:00")
    return [(end - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(hi, lo)]


def _ewma_from_dense(dense, n):
    lam, v = 2.0 / (n + 1), 0.0
    for load in dense:
        v = lam * load + (1.0 - lam) * v
    return v


def ewma_load(loads, first_day, as_of, n):
    """Recency-weighted load (lambda = 2/(N+1)); rest days contribute 0 so it
    decays across gaps. NOTE: still needs the adequacy gate - a ratio of EWMAs
    explodes as the chronic EWMA -> 0 (EWMA improves shape, not the divide)."""
    return _ewma_from_dense([ld for _, ld in _dense_daily(loads, first_day, as_of)], n)


def _chronic_ref_from_dense(dense, cd, dmin):
    """L_ref over a precomputed dense daily-load list (rolling median of the
    28-day mean on adequately-covered windows)."""
    vals, window, ssum, active = [], deque(), 0.0, 0
    for load in dense:
        window.append(load)
        ssum += load
        if load > 0:
            active += 1
        if len(window) > cd:
            old = window.popleft()
            ssum -= old
            if old > 0:
                active -= 1
        if len(window) == cd and active >= dmin:
            vals.append(ssum / cd)
    return statistics.median(vals) if vals else 0.0


def chronic_ref(loads, as_of, s=None):
    """L_ref = the user's established chronic norm: the median 28-day mean load
    over days whose chronic window had an adequate number of training days. This
    anchors the level half of the adequacy gate so 'training again but at half
    your usual base' still reads as thin, not as a renewed spike."""
    s = s or config.settings()
    if not loads:
        return 0.0
    dense = [ld for _, ld in _dense_daily(loads, min(loads), as_of)]
    return _chronic_ref_from_dense(dense, s["acwr_chronic_days"],
                                   s.get("acwr_chronic_min_days", 6))


def chronic_adequacy(loads, as_of, s, l_ref):
    """Is there a credible chronic base? Coverage (enough training days) AND level
    (chronic mean is at least a fraction of the user's norm). Returns
    (adequate, d_chr, l_chr)."""
    win = [loads.get(d, 0.0) for d in _daterange(as_of, s["acwr_chronic_days"])]
    d_chr = sum(1 for v in win if v > 0)
    l_chr = statistics.mean(win) if win else 0.0
    adequate = (d_chr >= s.get("acwr_chronic_min_days", 6)
                and (l_ref <= 0 or l_chr >= s.get("acwr_chronic_min_frac", 0.5) * l_ref))
    return adequate, d_chr, l_chr


def classify_state(r, s):
    """Map an ACWR (on an ADEQUATE base) to a named readiness state + color. Only
    SPIKING ever says 'back off'. `acwr_spike_self` (a self-relative upper
    percentile) overrides the population constant when configured."""
    spike = s.get("acwr_spike_self") or s["acwr_spike"]
    if r is None:
        return {"state": "productive", "level": "green",
                "reason": "load steady on an adequate base"}
    if r >= spike:
        return {"state": "spiking", "level": "red",
                "reason": f"acute load well above your chronic base (ACWR {round(r, 2)}) "
                          "- the one genuine 'back off'"}
    if r >= 1.0 + (spike - 1.0) * 0.5:
        return {"state": "accumulating", "level": "amber",
                "reason": f"acute load building above base (ACWR {round(r, 2)}) "
                          "- watch it; plan a deload"}
    if r < s["acwr_low"]:
        return {"state": "fresh", "level": "green",
                "reason": f"acute below chronic (ACWR {round(r, 2)}) - fresh, room to push"}
    return {"state": "productive", "level": "green",
            "reason": f"acute about chronic (ACWR {round(r, 2)}) - productive, hold/progress"}


def acwr_gated(loads, as_of, s=None, l_ref=None, first_day=None):
    """The gated ACWR read: adequacy gate first (thin base -> DETRAINED, never a
    spike), then an uncoupled / EWMA ratio fed to the state machine. Returns
    {state, level, acwr, reason, d_chr}. `acwr` is None when the base is
    inadequate - which is exactly what downstream spike-cuts must see so they
    stop cutting volume on phantom spikes."""
    s = s or config.settings()
    if not loads:
        return {"state": "detrained", "level": "amber", "acwr": None, "d_chr": 0,
                "reason": "no training history yet - build a base"}
    first_day = first_day or min(loads)
    # Build the dense daily walk ONCE and reuse it for L_ref and both EWMAs.
    dense = [ld for _, ld in _dense_daily(loads, first_day, as_of)]
    if l_ref is None:
        l_ref = _chronic_ref_from_dense(dense, s["acwr_chronic_days"],
                                        s.get("acwr_chronic_min_days", 6))
    adequate, d_chr, _ = chronic_adequacy(loads, as_of, s, l_ref)
    if not adequate:
        return {"state": "detrained", "level": "amber", "acwr": None, "d_chr": d_chr,
                "reason": f"thin chronic base ({d_chr} training day(s) in "
                          f"{s['acwr_chronic_days']}d) - returning from a gap, ramp up "
                          "gradually (not a spike)"}
    if s.get("acwr_use_ewma", True):
        a = _ewma_from_dense(dense, s["acwr_acute_days"])
        c = _ewma_from_dense(dense, s["acwr_chronic_days"])
    else:
        a = statistics.mean([loads.get(d, 0.0) for d in _daterange(as_of, s["acwr_acute_days"])])
        if s.get("acwr_uncouple", True):
            band = _date_band(as_of, s["acwr_chronic_days"], s["acwr_acute_days"])
            c = statistics.mean([loads.get(d, 0.0) for d in band]) if band else 0.0
        else:
            c = statistics.mean([loads.get(d, 0.0) for d in _daterange(as_of, s["acwr_chronic_days"])])
    r = (a / c) if c > 0 else None
    out = classify_state(r, s)
    out["acwr"] = round(r, 2) if r is not None else None
    out["d_chr"] = d_chr
    return out


def readiness_signal(loads, as_of, s=None):
    """Single readiness read for a load series - the indirection seam (roadmap #3
    section 1d). Today it returns the gated ACWR state machine; because item #1's
    form is the SAME machinery with a difference (CTL-ATL) instead of a ratio
    (ATL/CTL), swapping readiness onto the gap-safe form is a one-line change here
    once form clears its own bar. Returns {state, level, acwr, reason, d_chr}."""
    return acwr_gated(loads, as_of, s)


def monotony_strain(loads, as_of):
    week = [loads.get(d, 0.0) for d in _daterange(as_of, 7)]
    mean = statistics.mean(week)
    sd = statistics.pstdev(week) if len(week) > 1 else 0.0
    if mean == 0:
        return None, None
    monotony = round(mean / sd, 2) if sd > 0 else None
    strain = round(sum(week) * monotony, 1) if monotony else None
    return monotony, strain


def intra_session_dropoff(conn, as_of=None):
    as_of = as_of or progression.latest_date(conn)
    sess = conn.execute(
        "SELECT start_time FROM sessions WHERE date=? ORDER BY start_time DESC LIMIT 1",
        (as_of,)).fetchone()
    if not sess:
        return {}, None
    rows = conn.execute(
        """SELECT exercise_title, set_index, reps_clean FROM sets
           WHERE start_time=? AND is_working=1 AND reps_clean IS NOT NULL
           ORDER BY exercise_title, set_index""", (sess["start_time"],)).fetchall()
    by_ex = defaultdict(list)
    for r in rows:
        by_ex[r["exercise_title"]].append(r["reps_clean"])
    out = {}
    for ex, reps in by_ex.items():
        if len(reps) >= 2 and reps[0] > 0:
            out[ex] = round((reps[0] - reps[-1]) / reps[0], 2)
    avg = round(statistics.mean(out.values()), 2) if out else None
    return out, avg


def frequency(conn, as_of=None):
    as_of = as_of or progression.latest_date(conn)
    last7 = conn.execute(
        """SELECT COUNT(DISTINCT date) n FROM sessions
           WHERE date > ? AND date <= ?""",
        ((dates.from_iso(as_of + "T00:00:00") - timedelta(days=7)).strftime("%Y-%m-%d"),
         as_of)).fetchone()["n"]
    last28 = conn.execute(
        """SELECT COUNT(DISTINCT date) n FROM sessions
           WHERE date > ? AND date <= ?""",
        ((dates.from_iso(as_of + "T00:00:00") - timedelta(days=28)).strftime("%Y-%m-%d"),
         as_of)).fetchone()["n"]
    return {"sessions_7d": last7, "sessions_28d": last28,
            "per_week_28d": round(last28 / 4.0, 1)}


def assess(conn, as_of=None):
    """Readiness driven by the gated ACWR state machine (roadmap #3). The adequacy
    gate means a thin post-layoff base reads DETRAINED (ramp up), never SPIKING -
    so the 4.0 artifact can no longer reach a 'back off' verdict. Monotony/strain
    and frequency are demoted to an advisory tail that never sets the color on its
    own (weakly evidenced in resistance training)."""
    s = config.settings()
    as_of = as_of or progression.latest_date(conn)
    total = daily_load_total(conn)
    monotony, strain = monotony_strain(total, as_of)
    dropoff, dropoff_avg = intra_session_dropoff(conn, as_of)
    freq = frequency(conn, as_of)

    g = readiness_signal(total, as_of, s)
    g_acwr = g["acwr"]

    # Per-muscle GATED ACWR. The gated value (None on a thin base) is exactly what
    # volume.recommend keys its hard spike-cut on, so phantom post-gap spikes can
    # no longer cut real volume (which used to poison the recovery inputs).
    by_muscle = daily_load_by_muscle(conn)
    muscle_acwr, muscle_states = {}, {}
    for m, loads in by_muscle.items():
        gm = acwr_gated(loads, as_of, s)
        muscle_states[m] = gm["state"]
        if gm["acwr"] is not None:
            muscle_acwr[m] = gm["acwr"]

    level = g["level"]
    reasons = [g["reason"]]

    def bump(target):
        nonlocal level
        order = {"green": 0, "amber": 1, "red": 2}
        if order[target] > order[level]:
            level = target

    # A genuine per-muscle spike ON AN ADEQUATE BASE is the only other thing that
    # warrants caution (the gate already excluded phantom spikes).
    spiking = [f"{m} {muscle_acwr[m]}" for m, st in muscle_states.items()
               if st == "spiking" and m in muscle_acwr]
    if spiking:
        reasons.append("Per-muscle load spike on an adequate base: " + ", ".join(spiking))
        bump("amber")

    # Advisory tail - NEVER sets the readiness level on its own (roadmap #3 1e):
    # Foster monotony/strain and bare frequency are thinly validated in resistance
    # training, so they inform but don't alarm.
    if monotony and monotony > s["monotony_flag"]:
        reasons.append(f"High training monotony ({monotony}) - vary loads/rep ranges (advisory)")
    if dropoff_avg is not None and dropoff_avg >= 0.30:
        reasons.append(f"Large in-session rep drop-off ({int(dropoff_avg*100)}%) - "
                       "fatigue or loads a touch high (advisory)")
    if freq["sessions_7d"] == 0 and g["state"] != "detrained":
        reasons.append("No sessions in the last 7 days (advisory)")

    return {
        "readiness": level,
        "readiness_state": g["state"],
        "reasons": reasons,
        "acwr_global": g_acwr,
        "acwr_by_muscle": muscle_acwr,
        "acwr_state_by_muscle": muscle_states,
        "monotony": monotony,
        "strain": strain,
        "intra_session_dropoff": dropoff,
        "intra_session_dropoff_avg": dropoff_avg,
        "frequency": freq,
    }
