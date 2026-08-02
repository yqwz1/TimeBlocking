"""Fitness-Fatigue "Form" model: a gap-robust acute-vs-chronic recovery read.

Design: docs/design/01-fitness-fatigue-form-model.md. This is the TrainingPeaks-
style normalized Banister model (CTL/ATL/Form) - two exponentially-weighted
moving averages of daily normalized load, one slow (fitness/chronic, tau~42 d)
and one fast (fatigue/acute, tau~7 d). Form = CTL - ATL is "freshness".

Why this and not ACWR: ACWR divides acute by chronic, so a near-zero chronic
baseline after a layoff makes it blow up (the 4.0 artifact). Form never divides -
it walks EVERY calendar day, rest days feed load=0, both traces decay toward 0,
and post-layoff Form settles at ~0 ("detrained / neutral") instead of spiking.
No free gains to overfit; one global (tau_fit, tau_fat) pair fixed from the
literature (Hellard 2006 / Sci Rep 2025 warn the full 5-param fit is ill-posed).

Load is summed NORMALIZED volume (metrics.volume), unit-safe across exercises and
unit epochs. Per-muscle Form is judged self-relative (z-score vs the muscle's own
Form history), since back >> calves in raw load magnitude.

Status per the design doc: this module is the model + its leakage-free validator
helper; it is NOT yet wired into the live recovery read (see design doc section 5).
"""
import math
import statistics
from datetime import timedelta
from collections import defaultdict
from . import config, dates, trend

TAU_FIT, TAU_FAT = 42.0, 7.0    # days; fixed per design 1.2 (do not free-fit)
Z_WELL, Z_UNDER = 0.5, -0.5     # self-relative Form z-score state cutoffs
_DAY = "%Y-%m-%d"


def _form_cfg():
    """Form params from priors.json merged over literature defaults, so an older
    config (or a missing block) never crashes the validator."""
    base = {"tau_fit": TAU_FIT, "tau_fat": TAU_FAT, "z_well": Z_WELL,
            "z_under": Z_UNDER, "embargo_days": 3, "horizon_days": 21,
            "min_points": 4, "trail_sessions": 6, "min_n": 8, "success_r": 0.15,
            "signal_scale": 2.0}
    base.update({k: v for k, v in config.priors().get("form", {}).items()
                 if not k.startswith("_")})
    return base


def densify_daily(daily_loads):
    """Yield (date, load) for EVERY calendar day from the first to the last dated
    load, filling missing days with 0.0. This daily-dense walk is the whole point:
    rest days decay both traces so post-layoff Form is ~0, not a spike. Input may
    be unsorted or carry duplicate dates (summed). Empty input yields nothing."""
    agg = defaultdict(float)
    for d, load in daily_loads:
        agg[d] += load or 0.0
    if not agg:
        return
    days = sorted(agg)
    cur = dates.from_iso(days[0] + "T00:00:00")
    end = dates.from_iso(days[-1] + "T00:00:00")
    while cur <= end:
        key = cur.strftime(_DAY)
        yield key, agg.get(key, 0.0)
        cur += timedelta(days=1)


def daily_muscle_load(conn, muscle):
    """Summed normalized working-set volume per day for a muscle: [(date, load)].
    Reuses metrics.volume (already unit-safe across exercises / unit epochs)."""
    rows = conn.execute(
        "SELECT date, SUM(COALESCE(volume,0)) v FROM sets "
        "WHERE primary_muscle=? AND is_working=1 AND date IS NOT NULL "
        "GROUP BY date ORDER BY date", (muscle,)).fetchall()
    return [(r["date"], r["v"]) for r in rows]


def form_series(daily_loads, tau_fit=TAU_FIT, tau_fat=TAU_FAT):
    """[(date, ctl, atl, form)] over the daily-dense walk. `form` is the PRE-update
    CTL-ATL: the readiness you'd act on that morning, before that day's session
    lands (so using Form as a predictor can't peek at the same day's load). The
    ctl/atl in each tuple are POST-update values that carry into the next day.

    On a daily walk (dt = 1 day) the EWMA smoothing factors are the exact
    discretization of the continuous decay: alpha = 1 - exp(-1/tau)."""
    a_f = 1 - math.exp(-1 / tau_fit)
    a_a = 1 - math.exp(-1 / tau_fat)
    ctl = atl = 0.0
    out = []
    for date, load in densify_daily(daily_loads):
        form = ctl - atl                 # pre-update -> no same-day leakage
        ctl += a_f * (load - ctl)
        atl += a_a * (load - atl)
        out.append((date, ctl, atl, form))
    return out


def form_by_date(daily_loads, tau_fit=TAU_FIT, tau_fat=TAU_FAT):
    """{date: pre-update form} for O(1) lookup of the readiness as of any day."""
    return {d: f for d, _c, _a, f in form_series(daily_loads, tau_fit, tau_fat)}


def readiness_from_form(form_today, form_history, z_well=Z_WELL, z_under=Z_UNDER):
    """Self-relative readiness: z-score today's Form against the muscle's OWN Form
    history (raw Form scale tracks load magnitude, so absolute cutoffs don't
    transfer across muscles). Returns (state, z). With <2 history points or zero
    spread, sd falls back to 1.0 and the read stays 'borderline'."""
    hist = [f for f in form_history if f is not None]
    if len(hist) < 2:
        return "borderline", 0.0
    mu = statistics.mean(hist)
    sd = statistics.stdev(hist) or 1.0
    z = (form_today - mu) / sd
    state = ("recovering_well" if z >= z_well
             else "under_recovering" if z <= z_under else "borderline")
    return state, round(z, 2)


def leakage_free_pairs(e1rm_ser, form_lookup, cfg=None):
    """The design-section-2 windows for ONE lift, detrended on BOTH sides:
      X = pure load-based Form as of session i (no momentum; pre-update -> no peek)
      Y = next session's e1RM MINUS its expectation from the lift's PRIOR-only
          Theil-Sen trend (an embargo gap keeps the trend window off the outcome)
    so neither a steadily-rising lift nor Form's own drift can manufacture
    correlation. An honest r~0 on these pairs is the truth: readiness isn't
    recoverable from load alone for this user (the no-HRV/no-velocity ceiling).

    `e1rm_ser`  = [(date, e1rm)] one point per session, ascending.
    `form_lookup` = {date: form} from form_by_date. Returns [(x, y), ...]; pure
    (no DB / no I/O when `cfg` is passed), so it is unit-testable in isolation."""
    cfg = cfg or _form_cfg()
    embargo, horizon = cfg["embargo_days"], cfg["horizon_days"]
    minp, trail_n = cfg["min_points"], cfg["trail_sessions"]
    pairs = []
    for i in range(minp, len(e1rm_ser) - 1):
        d_i = e1rm_ser[i][0]
        f_i = form_lookup.get(d_i)
        if f_i is None:
            continue
        trail = e1rm_ser[max(0, i - trail_n):i]          # PRIOR sessions only
        if len(trail) < 3:
            continue
        t0 = dates.from_iso(trail[0][0] + "T00:00:00")
        fit = trend.theil_sen(
            [((dates.from_iso(d + "T00:00:00") - t0).days, e) for d, e in trail])
        if not fit:
            continue
        di_dt = dates.from_iso(d_i + "T00:00:00")
        nxt = None
        for d_j, e_j in e1rm_ser[i + 1:]:
            gap = (dates.from_iso(d_j + "T00:00:00") - di_dt).days
            if gap < embargo:                 # too close - inside the embargo
                continue
            if gap > horizon:                 # past the horizon - give up
                break
            nxt = (d_j, e_j)
            break
        if not nxt:
            continue
        d_j, e_j = nxt
        expected = fit["intercept"] + fit["slope"] * \
            (dates.from_iso(d_j + "T00:00:00") - t0).days
        pairs.append((f_i, e_j - expected))
    return pairs
