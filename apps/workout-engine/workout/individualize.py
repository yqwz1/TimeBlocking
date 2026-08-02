"""Individualization core: per-exercise load<->reps model, individualized 1RM,
Bayesian (Normal-Normal) shrinkage, grace-period confidence, set-order fatigue.

Pure-Python statistics. With one user's sparse data this is a small-data
inference problem, not a deep-learning one: start from population priors and
shrink toward the personal posterior as data accumulates (the "grace period").
"""
import math
import statistics
from collections import defaultdict
from datetime import datetime, timedelta
from . import config, dates, conformal


# --------------------------------------------------------------------------
# Exercise TYPE (the only meaningful moderator of reps-vs-load; Nuzzo 2024).
# Maps each exercise's movement pattern to one of the three reps_at_pct1rm
# buckets priors.json already uses, so same-type lifts can share a load->reps
# slope (design 02 hierarchical pooling).
# --------------------------------------------------------------------------
_TYPE_BY_PATTERN = {
    "squat": "lower_compound", "hinge": "lower_compound",
    "horizontal_push": "upper_press", "incline_push": "upper_press",
    "vertical_push": "upper_press",
}


def ex_type(ex):
    """Exercise -> reps_at_pct1rm type ('lower_compound' / 'upper_press' /
    'default'). Lower-body compounds and presses tolerate more reps per %1RM
    than the rest; everything else (pulls, isolation, core) is 'default'."""
    return _TYPE_BY_PATTERN.get(config.exercise_info(ex).get("pattern"), "default")


def _rep_pooling_cfg():
    """Hierarchical-pooling knobs from priors.json over safe defaults."""
    base = {"enabled": True, "rich_min_points": 8, "rich_min_ratio": 1.15,
            "borrowed_conf_base": 25, "borrowed_conf_per_lift": 5,
            "borrowed_conf_cap": 55, "min_n_starved": 12, "rich_tol": 0.02}
    base.update({k: v for k, v in config.priors().get("rep_pooling", {}).items()
                 if not k.startswith("_")})
    return base


# --------------------------------------------------------------------------
# Ordinary least squares (pure python)
# --------------------------------------------------------------------------
def ols(xs, ys):
    """Fit y = slope*x + intercept. Returns a dict or None if x has no spread."""
    pts = [(float(x), float(y)) for x, y in zip(xs, ys) if x is not None and y is not None]
    n = len(pts)
    if n < 3:
        return None
    mx = statistics.mean(x for x, _ in pts)
    my = statistics.mean(y for _, y in pts)
    ssx = sum((x - mx) ** 2 for x, _ in pts)
    if ssx <= 0:
        return None  # no load variation -> can't fit reps vs load
    sxy = sum((x - mx) * (y - my) for x, y in pts)
    slope = sxy / ssx
    intercept = my - slope * mx
    resid = [y - (slope * x + intercept) for x, y in pts]
    sse = sum(r * r for r in resid)
    sst = sum((y - my) ** 2 for _, y in pts)
    r2 = 1 - sse / sst if sst > 0 else 0.0
    resid_std = math.sqrt(sse / (n - 2)) if n > 2 else 0.0
    return {"slope": slope, "intercept": intercept, "n": n, "r2": max(0.0, r2),
            "resid_std": resid_std, "mean_x": mx, "ssx": ssx,
            "min_x": min(x for x, _ in pts), "max_x": max(x for x, _ in pts)}


# --------------------------------------------------------------------------
# Per-exercise load<->reps model (fit on fresh / first working set per session)
# --------------------------------------------------------------------------
def _fresh_rows_dated(conn, ex, epoch):
    """[(date, load, reps, rpe)] first working set per session in the current
    epoch, recent-window-filtered with the grace fallback. fresh_points drops the
    date; the conformal walk-forward validator (design 06) keeps it so its
    calibration set can be purged/embargoed by DAYS, not just by index."""
    rows = conn.execute(
        """SELECT date, weight_raw w, reps_clean r, rpe FROM sets
           WHERE exercise_title=? AND epoch=? AND is_working=1 AND set_index=0
             AND weight_raw IS NOT NULL AND reps_clean IS NOT NULL
             AND reps_clean BETWEEN 1 AND 20
           ORDER BY date""", (ex, epoch)).fetchall()
    if not rows:
        return []
    weeks = config.settings()["forecast_window_weeks"]
    last = dates.from_iso(rows[-1]["date"] + "T00:00:00")
    cut = (last - timedelta(weeks=weeks)).strftime("%Y-%m-%d")
    win = [(r["date"], r["w"], r["r"], r["rpe"]) for r in rows if r["date"] >= cut]
    g = config.priors()["grace"]
    if len(win) < g["n_learn"]:
        win = [(r["date"], r["w"], r["r"], r["rpe"]) for r in rows[-max(g["n_learn"], 12):]]
    return win


def fresh_points(conn, ex, epoch):
    """First working set per session in the current epoch: [(load, reps, rpe)].

    Fits on a RECENT window so that long-run strength gains don't flatten the
    load-rep relationship (which would inflate the 1RM extrapolation). Falls
    back to the most recent points if the window is too thin.

    `rpe` (may be None on legacy sets) rides along so the curvilinear 1RM model
    (design 04) can build a reps-to-failure anchor; the linear fit (ols /
    fit_load_rep) ignores it, reading only the first two tuple elements.
    """
    return [(w, r, rpe) for _, w, r, rpe in _fresh_rows_dated(conn, ex, epoch)]


def fit_load_rep(points):
    fit = ols([p[0] for p in points], [p[1] for p in points])
    if not fit or fit["slope"] >= 0:
        return None  # reps must fall as load rises
    return fit


def predict_reps(model, load):
    """Point estimate + ~95% prediction interval for reps at a given load."""
    pt = model["intercept"] + model["slope"] * load
    se = model["resid_std"] * math.sqrt(1 + 1 / model["n"] +
                                        (load - model["mean_x"]) ** 2 / model["ssx"])
    return pt, pt - 1.96 * se, pt + 1.96 * se


def predict_reps_anchored(model, last_load, last_reps, target_load, pooled=None):
    """Anchor on the most recent actual top-set, then adjust for the load change
    using the personal load-rep slope. Beats both pure-model and naive: equals
    'same reps as last time' when the load is unchanged, and corrects for it when
    you add/drop weight. Falls back to naive if there's no fitted slope.

    `pooled = (slope, resid_std)` lets a caller supply a partially-pooled /
    borrowed slope (design 02) for a weak or starved lift; when given it takes
    precedence over the raw fit (the raw fit is what gets shrunk into it)."""
    if last_reps is None or last_load is None:
        return None
    if pooled is not None:
        slope, se = pooled
    elif model:
        slope, se = model["slope"], model["resid_std"]
    else:
        slope, se = 0.0, 1.0
    pred = last_reps + slope * (target_load - last_load)
    return pred, pred - 1.96 * se, pred + 1.96 * se


def load_for_reps(model, reps):
    if model["slope"] == 0:
        return None
    return (reps - model["intercept"]) / model["slope"]


def individual_1rm(model):
    """Personalized 1RM = load predicted to allow exactly 1 rep. Reported only
    when the fit is decent and 1RM is a reasonable extrapolation from the loads
    actually trained (otherwise we defer to the Epley-based estimate)."""
    g = config.priors()["grace"]
    if not model or model["slope"] >= -0.02 or model["r2"] < g["min_r2"]:
        return None
    v = load_for_reps(model, 1)
    if not v or v <= 0 or v > model["max_x"] * 1.4:
        return None  # too far beyond loads actually used -> unreliable
    return round(v, 1)


def in_range(model, load):
    """True if a load sits within (or just outside) the trained range -> a
    prediction there is interpolation, not fragile extrapolation."""
    if not model:
        return False
    span = model["max_x"] - model["min_x"]
    pad = 0.15 * span if span > 0 else max(2.0, 0.1 * load)
    return model["min_x"] - pad <= load <= model["max_x"] + pad


# --------------------------------------------------------------------------
# Grace period / confidence
# --------------------------------------------------------------------------
def grace(model):
    """Return (state, confidence_pct). State machine: calibrating -> learning
    -> confident, gated on sample size and fit quality. Confidence grows ~1/sqrt(n)."""
    g = config.priors()["grace"]
    if not model:
        return "calibrating", 0
    n, r2 = model["n"], model["r2"]
    base = 1 - 1 / math.sqrt(n)            # 0.55 @5, 0.71 @12, 0.78 @20
    conf = round(100 * base * (0.5 + 0.5 * min(1.0, r2)))
    if n < g["n_learn"]:
        return "calibrating", conf
    if n >= g["n_confident"] and r2 >= g["min_r2"]:
        return "confident", conf
    return "learning", conf


# --------------------------------------------------------------------------
# Bayesian Normal-Normal conjugate update (population prior -> personal posterior)
# --------------------------------------------------------------------------
def normal_normal_update(prior_mean, prior_var, obs_mean, obs_var, n):
    """Closed-form conjugate update of a mean. Returns (post_mean, post_var)."""
    if n <= 0 or obs_var <= 0:
        return prior_mean, prior_var
    prior_prec = 1 / prior_var
    obs_prec = n / obs_var
    post_prec = prior_prec + obs_prec
    post_mean = (prior_prec * prior_mean + obs_prec * obs_mean) / post_prec
    return post_mean, 1 / post_prec


def shrink_slope(obs_slope, obs_slope_sd, n):
    """Blend an observed weekly e1RM slope toward the population gain-rate prior.
    Early on the prior dominates; with more data the personal estimate wins."""
    p = config.priors()
    age = p["training_age"]
    prior_mean = p["gain_rate_e1rm_per_week"].get(age, 1.0)
    prior_var = p["gain_rate_sd_per_week"] ** 2
    if obs_slope is None:
        return prior_mean, prior_var
    obs_var = (obs_slope_sd ** 2) if obs_slope_sd and obs_slope_sd > 0 else prior_var
    return normal_normal_update(prior_mean, prior_var, obs_slope, obs_var, max(1, n))


# --------------------------------------------------------------------------
# Hierarchical partial pooling of the load->reps SLOPE (design 02)
#
# Two-level empirical Bayes: a starved exercise (no load variation -> no slope)
# borrows its type's slope; a data-rich one keeps its own. Closed-form
# DerSimonian-Laird heterogeneity, so it stays pure-Python and transparent. We
# pool the SLOPE only - the intercept/anchor (the user's real rep level at their
# working weight) stays local; only the load->reps tradeoff is unidentifiable.
# --------------------------------------------------------------------------
def _all_exercises(conn):
    return [r["exercise_title"] for r in conn.execute(
        "SELECT DISTINCT exercise_title FROM sets WHERE is_working=1")]


def _cur_epoch(conn, ex):
    return conn.execute("SELECT MAX(epoch) e FROM sets WHERE exercise_title=?",
                        (ex,)).fetchone()["e"] or 0


def _eb_level(arr):
    """DerSimonian-Laird pooled (mu, tau2) + a representative rep-residual std for
    one set of (beta_hat, se, resid_std) triples. tau2 is the between-exercise
    slope variance; 0 means the group looks homogeneous."""
    if not arr:
        return None
    b = [x[0] for x in arr]
    w = [1.0 / x[1] ** 2 for x in arr]          # precision weights 1/se^2
    W = sum(w)
    mu = sum(wi * bi for wi, bi in zip(w, b)) / W
    if len(arr) > 1:
        Q = sum(wi * (bi - mu) ** 2 for wi, bi in zip(w, b))
        denom = W - sum(wi ** 2 for wi in w) / W
        tau2 = max(0.0, (Q - (len(arr) - 1)) / denom) if denom > 0 else 0.0
    else:
        tau2 = 0.0
    return {"mu": mu, "tau2": tau2,
            "resid_std": statistics.median(x[2] for x in arr), "k": len(arr)}


def group_slopes(conn):
    """Empirical-Bayes pooled load->reps slope per exercise TYPE, plus a global
    level (the 3-level fallback so a sparse type - e.g. one lone lift - still
    borrows). Only WELL-IDENTIFIED lifts (real load spread -> finite slope SE)
    inform a level; starved lifts borrow from it. Returns
    {type: {mu, tau2, resid_std, k}, '__global__': {...}}. (design 02 sections 1-2.)"""
    by_type = defaultdict(list)     # type -> [(beta_hat, se, resid_std)]
    allarr = []
    for ex in _all_exercises(conn):
        fit = fit_load_rep(fresh_points(conn, ex, _cur_epoch(conn, ex)))
        if fit and fit["ssx"] > 0 and fit["resid_std"] > 0:
            se = fit["resid_std"] / math.sqrt(fit["ssx"])     # SE of the OLS slope
            if math.isfinite(se) and se > 0:
                rec = (fit["slope"], se, fit["resid_std"])
                by_type[ex_type(ex)].append(rec)
                allarr.append(rec)
    out = {g: _eb_level(arr) for g, arr in by_type.items()}
    out["__global__"] = _eb_level(allarr)
    return out


def shrink_load_rep_slope(beta_hat, se, mu_g, tau2):
    """Posterior (shrunken) slope + variance for one exercise given its OLS slope
    estimate (beta_hat +/- se) and its type level (mu_g, tau2). Starved lift
    (se None/inf -> shrink weight B=1): returns mu_g - full borrow, the rescue.
    Strong lift (se << sqrt(tau2) -> B~0): ~unchanged. (design 02 section 2.)"""
    if beta_hat is None or se is None or not math.isfinite(se) or se <= 0:
        return mu_g, tau2                                  # starved -> full borrow
    if tau2 <= 0:
        return mu_g, se ** 2                               # homogeneous -> common slope
    B = se ** 2 / (se ** 2 + tau2)                         # shrinkage weight in [0,1]
    beta_star = (1 - B) * beta_hat + B * mu_g
    var_star = 1.0 / (1.0 / se ** 2 + 1.0 / tau2)          # tighter, calibrated (feeds #6)
    return beta_star, var_star


def _personal_strong(model, cfg):
    """A lift's OWN data identifies its slope well enough to keep it un-pooled."""
    if not model:
        return False
    g = config.priors()["grace"]
    ratio = (model["max_x"] / model["min_x"]) if model.get("min_x") else 1.0
    return (model["r2"] >= g["min_r2"] and model["n"] >= cfg["rich_min_points"]
            and ratio >= cfg["rich_min_ratio"])


def pooled_slope_for(ex, model, groups, cfg=None):
    """Resolve the load->reps slope to actually USE for `ex`, partially pooling a
    weak/starved per-exercise fit toward its exercise-type level (design 02 s.4).
    Strong lifts are left untouched (apply=False, byte-identical predictions).
    Returns {slope, resid_std, var, basis, apply, confidence}, or None when there
    is neither a usable personal slope nor any group level to borrow."""
    cfg = cfg or _rep_pooling_cfg()
    if _personal_strong(model, cfg):
        return {"slope": model["slope"], "resid_std": model["resid_std"],
                "var": (model["resid_std"] ** 2 / model["ssx"]) if model["ssx"] > 0 else None,
                "basis": "personal", "apply": False, "confidence": None}
    level = (groups or {}).get(ex_type(ex)) or (groups or {}).get("__global__")
    if not level:
        return None
    se = (model["resid_std"] / math.sqrt(model["ssx"])
          if model and model.get("ssx", 0) > 0 and model["resid_std"] > 0 else None)
    beta_star, var_star = shrink_load_rep_slope(
        model["slope"] if model else None, se, level["mu"], level["tau2"])
    resid_std = model["resid_std"] if (model and model["resid_std"] > 0) else level["resid_std"]
    conf = min(cfg["borrowed_conf_cap"],
               cfg["borrowed_conf_base"] + cfg["borrowed_conf_per_lift"] * level["k"])
    return {"slope": beta_star, "resid_std": resid_std, "var": var_star,
            "basis": ("borrowed" if model is None else "shrunk"),
            "apply": True, "confidence": conf}


# --------------------------------------------------------------------------
# Set-order fatigue (rep decay across sets within a session)
# --------------------------------------------------------------------------
def set_order_fatigue(conn, ex, epoch):
    """Average rep change vs the first set, per set index. Falls back to the
    population default until enough personal data exists."""
    rows = conn.execute(
        """SELECT set_index, reps_clean FROM sets
           WHERE exercise_title=? AND epoch=? AND is_working=1
             AND reps_clean IS NOT NULL""", (ex, epoch)).fetchall()
    by_idx = {}
    for r in rows:
        by_idx.setdefault(r["set_index"], []).append(r["reps_clean"])
    base = by_idx.get(0)
    default = {int(k): v for k, v in config.priors()["set_order_fatigue_default"].items()}
    if not base or len(base) < 3:
        return default
    base_mean = statistics.mean(base)
    out = {0: 0.0}
    for idx, reps in sorted(by_idx.items()):
        if idx == 0:
            continue
        if len(reps) >= 3:
            out[idx] = round(statistics.mean(reps) - base_mean, 2)
        else:
            out[idx] = default.get(idx, default.get(max(default), -3.0))
    return out


# --------------------------------------------------------------------------
# RPE / RIR helpers
# --------------------------------------------------------------------------
def rir_from_rpe(rpe):
    if rpe is None:
        return None
    return max(0.0, 10.0 - rpe)


def rir_reliable(reps, rir):
    p = config.priors()
    if reps is not None and reps > p["rir_reliable_max_reps"]:
        return False
    if rir is not None and rir > p["rir_reliable_max_rir"]:
        return False
    return True


# --------------------------------------------------------------------------
# Curvilinear, regularized load->reps / 1RM model (design 04)
#
# The linear model extrapolates a straight reps-vs-load line out to 1 rep, which
# OVERSHOOTS the 1RM because the true reps-vs-%1RM curve is convex near the top
# (Nuzzo 2024). We borrow that CURVATURE at the exercise-TYPE level (a fixed
# Nuzzo shape, read through a monotone PCHIP interpolator) and let each lift fit
# only ONE local parameter: the anchor M = 1RM. Curvature is a group parameter
# (never identified per lift, where the data can't support it); the anchor is
# lift-local and shrunk toward a heaviest-reliable-set prior. Only the ratio
# p = W/M ever touches the curve, so it is UNIT-SAFE within one epoch.
# --------------------------------------------------------------------------
def _curvilinear_cfg():
    base = {"enabled": False, "prior_sd_frac": 0.15, "min_spread": 1.15,
            "legacy_weight": 0.25, "p_floor": 0.30, "p_ceil": 1.05,
            "search_max_ratio": 2.5, "min_heavy_targets": 5,
            "adopt_min_rel_improve": 0.15, "adopt_max_inband_regress": 0.02}
    base.update({k: v for k, v in config.priors().get("curvilinear_1rm", {}).items()
                 if not k.startswith("_")})
    return base


def _pchip_tangents(xs, ys):
    """Fritsch-Carlson monotone cubic-Hermite tangents (the PCHIP rule SciPy
    uses) - pure Python. Guarantees the interpolant is monotone wherever the
    knots are, so the reps-to-failure curve stays strictly decreasing and is
    invertible by bisection (the design-04 review's hardening over a plain
    natural cubic spline, which can wiggle and break invertibility)."""
    n = len(xs)
    if n == 2:
        s = (ys[1] - ys[0]) / (xs[1] - xs[0])
        return [s, s]
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]   # secant slopes
    m = [0.0] * n
    for i in range(1, n - 1):
        if d[i - 1] == 0 or d[i] == 0 or (d[i - 1] < 0) != (d[i] < 0):
            m[i] = 0.0                                       # local extremum -> flat
        else:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])   # weighted harmonic mean

    def edge(hh0, hh1, dd0, dd1):
        e = ((2 * hh0 + hh1) * dd0 - hh0 * dd1) / (hh0 + hh1)
        if (e < 0) != (dd0 < 0):
            return 0.0                                       # opposite sign -> flat
        if (dd0 < 0) != (dd1 < 0) and abs(e) > 3 * abs(dd0):
            return 3 * dd0                                   # clamp to keep monotone
        return e
    m[0] = edge(h[0], h[1], d[0], d[1])
    m[-1] = edge(h[-1], h[-2], d[-1], d[-2])
    return m


class _MonotoneCurve:
    """Strictly-decreasing reps-to-failure curve r = f(p), p = W/1RM, built by
    monotone PCHIP through the Nuzzo knots. Callable; linear (tangent)
    extrapolation beyond the boundary knots keeps it monotone everywhere, so
    `inverse` is a safe bisection."""
    __slots__ = ("xs", "ys", "m")

    def __init__(self, xs, ys):
        self.xs, self.ys, self.m = xs, ys, _pchip_tangents(xs, ys)

    def __call__(self, p):
        xs, ys, m = self.xs, self.ys, self.m
        if p <= xs[0]:
            return ys[0] + m[0] * (p - xs[0])
        if p >= xs[-1]:
            return ys[-1] + m[-1] * (p - xs[-1])
        lo, hi = 0, len(xs) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if xs[mid] <= p:
                lo = mid
            else:
                hi = mid
        h = xs[hi] - xs[lo]
        t = (p - xs[lo]) / h
        h00 = (1 + 2 * t) * (1 - t) ** 2
        h10 = t * (1 - t) ** 2
        h01 = t * t * (3 - 2 * t)
        h11 = t * t * (t - 1)
        return h00 * ys[lo] + h10 * h * m[lo] + h01 * ys[hi] + h11 * h * m[hi]

    def deriv(self, p, eps=1e-4):
        a, b = max(0.0, p - eps), p + eps
        return (self(b) - self(a)) / (b - a)

    def inverse(self, reps, p_lo, p_hi, iters=60):
        """Find p with f(p)=reps. f decreasing -> unique; bisection."""
        lo, hi = p_lo, p_hi
        for _ in range(iters):
            mid = 0.5 * (lo + hi)
            if self(mid) > reps:      # too many reps -> need a heavier (higher p)
                lo = mid
            else:
                hi = mid
        return 0.5 * (lo + hi)


_CURVE_CACHE = {}


def spline_for_type(etype):
    """Reps-to-failure as a function of p = W/1RM, per exercise TYPE
    ('default'/'lower_compound'/'upper_press'). ROADMAP #2 SEAM: reads the fixed
    Nuzzo reps_at_pct1rm table today; later returns #2's fitted group-level
    posterior with NO change to any caller (they only ever see f(p))."""
    tbl = config.priors()["reps_at_pct1rm"]
    t = etype if etype in tbl else "default"
    key = (t, tuple(sorted(tbl[t].items())))
    cur = _CURVE_CACHE.get(key)
    if cur is None:
        pcts = sorted(int(k) for k in tbl[t])
        cur = _MonotoneCurve([p / 100.0 for p in pcts],
                             [float(tbl[t][str(p)]) for p in pcts])
        _CURVE_CACHE[key] = cur
    return cur


def failure_reps(reps, rpe):
    """(r*, reliable): reps-to-failure r* = reps + RIR when a reliable RPE
    exists, else `reps` (a one-sided lower bound - the set could have gone
    longer). Mirrors metrics.e1rm's `cand = reps + rir` and rir_reliable gate."""
    if reps is None:
        return None, False
    if rpe is None:
        return float(reps), False
    rir = rir_from_rpe(rpe)
    if rir is not None and rir_reliable(reps, rir):
        return float(reps) + rir, True
    return float(reps), False


def _golden_min(f, a, b, iters=60):
    """Golden-section minimization of a unimodal f on [a, b] (pure Python; the
    design's golden-section/Brent for the 1-D anchor fit, no scipy)."""
    invphi = (math.sqrt(5.0) - 1.0) / 2.0
    c, d = b - invphi * (b - a), a + invphi * (b - a)
    fc, fd = f(c), f(d)
    for _ in range(iters):
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - invphi * (b - a)
            fc = f(c)
        else:
            a, c, fc = c, d, fd
            d = a + invphi * (b - a)
            fd = f(d)
    return 0.5 * (a + b)


def fit_anchor(points, etype, cfg=None):
    """Per-lift 1RM anchor M from (load, reps, rpe) points in ONE epoch - the
    only free parameter (curvature is borrowed from the type curve). Returns
    {M, ex_type, n_eff, spread, max_x, resid_std, basis} or None. basis='fit'
    when load spread identifies M; 'prior' when it leans on the heaviest-set
    prior alone (fixed-load lift). UNIT-SAFE: only ratios W/M touch the curve."""
    cfg = cfg or _curvilinear_cfg()
    s = spline_for_type(etype)
    p_lo, p_hi = cfg["p_floor"], cfg["p_ceil"]
    rows = []
    for pt in points:
        W, reps = pt[0], pt[1]
        rpe = pt[2] if len(pt) > 2 else None
        if W is None or reps is None or W <= 0 or reps <= 0:
            continue
        rstar, reliable = failure_reps(reps, rpe)
        w = 1.0 / (1.0 + max(0.0, rstar - reps))     # downweight high-RIR (far from failure)
        if not reliable:
            w *= cfg["legacy_weight"]                 # legacy/no-RPE: weak (~one-sided)
        rows.append((float(W), rstar, w, reliable))
    if not rows:
        return None
    maxW = max(r[0] for r in rows)
    spread = maxW / min(r[0] for r in rows)

    # prior anchor from the single heaviest reliable set (needs NO load spread)
    reliable_rows = [r for r in rows if r[3]]
    if reliable_rows:
        heavy = max(reliable_rows, key=lambda r: r[0])
        M_prior = heavy[0] / max(s.inverse(heavy[1], p_lo, p_hi), 1e-6)
    else:
        heavy = max(rows, key=lambda r: r[0])         # one-sided: assume heaviest <= ~90%
        M_prior = heavy[0] / max(min(s.inverse(heavy[1], p_lo, p_hi), 0.90), 1e-6)

    resid_std = None
    if spread >= cfg["min_spread"]:
        def loss(M):
            return sum(w * (rstar - s(min(max(W / M, p_lo), p_hi))) ** 2
                       for (W, rstar, w, _) in rows)
        M_raw = _golden_min(loss, maxW * 1.0001, maxW * cfg["search_max_ratio"])
        n_eff = sum(r[2] for r in rows)
        sigma_r2 = loss(M_raw) / max(1e-9, n_eff)     # weighted reps-residual variance
        # tightened Var(M) (design-04 review): Fisher-style info from the local
        # sensitivity dr/dM = s'(p)*(-W/M^2) at each point, p = W/M.
        info = 0.0
        for (W, _, w, _) in rows:
            p = min(max(W / M_raw, p_lo), p_hi)
            dr_dM = s.deriv(p) * (-W / (M_raw * M_raw))
            info += w * dr_dM * dr_dM
        sigma2_M = (sigma_r2 / info) if info > 0 else float("inf")
        resid_std = math.sqrt(sigma_r2)
        basis = "fit"
    else:
        M_raw, sigma2_M, n_eff, basis = M_prior, float("inf"), 0.0, "prior"

    tau2 = (cfg["prior_sd_frac"] * M_prior) ** 2      # prior SD ~15% of the anchor
    # sigma2_M is already the variance of the M ESTIMATE (it pools all points via
    # the Fisher info), so combine with the prior at n=1 (no double-counting).
    M, _ = normal_normal_update(M_prior, tau2, M_raw,
                                sigma2_M if math.isfinite(sigma2_M) else tau2 * 1e9, 1)
    if M <= maxW:                                      # a 1RM must exceed the top load lifted
        M = maxW * 1.001
    return {"M": float(M), "ex_type": etype, "n_eff": float(n_eff),
            "spread": float(spread), "max_x": float(maxW),
            "resid_std": resid_std, "basis": basis}


def reps_at_load_spline(anchor, load):
    """Curvilinear reps-to-failure point estimate at a load (the convex
    replacement for predict_reps's point estimate on the heavy end)."""
    cfg = _curvilinear_cfg()
    s = spline_for_type(anchor["ex_type"])
    return float(s(min(max(load / anchor["M"], cfg["p_floor"]), cfg["p_ceil"])))


def load_for_reps_spline(anchor, reps):
    """Curvilinear inverse: the load predicted to allow `reps` to failure."""
    cfg = _curvilinear_cfg()
    s = spline_for_type(anchor["ex_type"])
    return float(anchor["M"] * s.inverse(reps, cfg["p_floor"], cfg["p_ceil"]))


def individual_1rm_spline(anchor):
    """Curvilinear 1RM = the anchor M itself: the type curve is built so
    f(1.0)=1 rep, so there is nothing to overshoot and the linear model's `1.4x`
    clamp is retired. Gated to lifts with real load spread (basis='fit') - the
    only lifts whose 1RM #4 is designed (and validated) to change; fixed-load
    lifts fall through to the linear rung (unchanged behavior)."""
    if not anchor or anchor.get("basis") != "fit":
        return None
    return round(anchor["M"], 1)


def individ_1rm_dispatch(anchor, model, cfg=None):
    """The fallback ladder (design 04 s.5): curvilinear anchor -> linear (gated,
    `1.4x` clamp) -> None (callers then fall to the per-set best e1RM). Each rung
    is strictly safer / less individualized than the one above. Returns
    (value, basis) with basis in {'spline','linear','none'}."""
    cfg = cfg or _curvilinear_cfg()
    if cfg["enabled"]:
        v = individual_1rm_spline(anchor)
        if v is not None:
            return v, "spline"
    v = individual_1rm(model) if model else None
    return v, ("linear" if v is not None else "none")


# --------------------------------------------------------------------------
# RIR into the in-band rep model: the capacity curve + predict-at-effort
# (design 05)
#
# The linear/pooled load->reps fit is blind to how close to failure each set
# was: 8 reps @ RPE 7 (RIR 3) and 8 reps @ RPE 10 (RIR 0) are the SAME point to
# it, though they sit far apart on the true capacity curve. #5 fixes the
# PREDICTION semantics. Anchor on the last set's CAPACITY r* = reps + reliable
# RIR (reusing failure_reps - the same r* #4 anchors its 1RM on), project it
# along the personal/pooled slope, then predict the reps the user will actually
# PERFORM at their intended effort = capacity(W) - target_RIR. When the anchor
# set has no reliable RIR its capacity is censored (a lower bound, not a value)
# and we fall back to the raw-reps predictor - BYTE-IDENTICAL to today, so legacy
# lifts are untouched and the win is concentrated in the RIR era. The slope stays
# the one #2 already validated (capacity- and performed-slope coincide under
# roughly constant training effort - the RIR transform lives in the anchor and
# the offset, not the slope), and the inflated obs-variance (resid + RIR noise)
# is exactly the nonconformity input #6 will wrap in a calibrated interval.
# --------------------------------------------------------------------------
def _rir_rep_cfg():
    """RIR-rep-model knobs from priors.json over safe defaults."""
    base = {"enabled": False, "min_rir_points": 3, "rir_var": 1.0,
            "min_recent_targets": 8, "adopt_min_rel_improve": 0.0,
            "adopt_max_legacy_regress": 0.02}
    base.update({k: v for k, v in config.priors().get("rir_rep_model", {}).items()
                 if not k.startswith("_")})
    return base


def median_target_rir(rep_rpe_points, default):
    """Median reliable RIR over (reps, rpe) points - the user's typical training
    effort. Falls back to `default` (settings.progression_min_rir) until enough
    reliable-RIR sets exist. Pure so the live target_rir and the walk-forward
    validator share one definition (neither leaks the other's logic)."""
    cfg = _rir_rep_cfg()
    rirs = []
    for reps, rpe in rep_rpe_points:
        rir = rir_from_rpe(rpe)
        if rir is not None and rir_reliable(reps, rir):
            rirs.append(rir)
    if len(rirs) >= cfg["min_rir_points"]:
        return float(statistics.median(rirs))
    return float(default)


def target_rir(conn, ex, epoch):
    """The user's typical top-set RIR for `ex` in this epoch (median reliable
    RIR), or settings.progression_min_rir when RPE is still too sparse. This is
    the effort offset subtracted from capacity in predict_reps_at_effort."""
    default = config.settings().get("progression_min_rir", 2.0)
    rows = conn.execute(
        """SELECT reps_clean r, rpe FROM sets
           WHERE exercise_title=? AND epoch=? AND is_working=1 AND set_index=0
             AND rpe IS NOT NULL AND reps_clean IS NOT NULL""",
        (ex, epoch)).fetchall()
    return median_target_rir([(row["r"], row["rpe"]) for row in rows], default)


def predict_reps_at_effort(model, last_load, last_reps, last_rpe, target_load,
                           target_rir, pooled=None, rir_var=None):
    """Predict the reps the user will PERFORM at their intended effort.

    Anchors on the last set's CAPACITY r* = last_reps + reliable RIR, projects it
    along the personal/pooled load->reps slope to `target_load` (reusing
    predict_reps_anchored), then drops to the intended effort:
        performed ~= capacity(target_load) - target_rir.
    When the anchor set has NO reliable RIR its capacity is censored, so we defer
    to the raw-reps predict_reps_anchored - byte-identical to today's behavior.

    Returns (pt, lo, hi, at_effort): at_effort is True iff the capacity/effort
    path engaged (a reliable RIR on the anchor set). The interval inflates the
    slope SE by the RIR self-report noise Var(RIR) (design 05 section 1c) - the
    nonconformity input #6 calibrates. Returns None only when there is no anchor
    to predict from at all."""
    last_cap, reliable = failure_reps(last_reps, last_rpe)
    if not reliable:
        ap = predict_reps_anchored(model, last_load, last_reps, target_load, pooled=pooled)
        return None if ap is None else (ap[0], ap[1], ap[2], False)
    cap = predict_reps_anchored(model, last_load, last_cap, target_load, pooled=pooled)
    if cap is None:
        return None
    if rir_var is None:
        rir_var = _rir_rep_cfg()["rir_var"]
    slope_se = pooled[1] if pooled is not None else (model["resid_std"] if model else 1.0)
    pt = max(0.0, cap[0] - target_rir)
    se = math.sqrt(slope_se ** 2 + rir_var)
    return pt, pt - 1.96 * se, pt + 1.96 * se, True


# --------------------------------------------------------------------------
# Conformal prediction intervals for the rep predictor (design 06)
#
# predict_reps_anchored returns pt +- 1.96*se: a Gaussian, homoscedastic,
# NEVER-AUDITED interval. Reps are integer, bounded below, right-skewed near
# failure, and noisier far from the trained load - none of that is Gaussian. #6
# keeps the POINT estimate (so #2's validated accuracy is preserved) and replaces
# only the BAND with a calibrated, distribution-free conformal interval. The
# nonconformity score is exactly the walk-forward |residual| the backtest already
# computes; we keep those residuals instead of averaging them into an MAE, pool
# them by exercise-TYPE (Mondrian - the small-n fix, since per-lift calibration
# sets are far too small), and read the finite-sample quantile. q is the lift's
# type-level conformal quantile from rep_conformal_quantiles.
# --------------------------------------------------------------------------
def _norm_scale(model, load):
    """Heteroscedastic width factor for normalized conformal (design 06 section
    1b): the OLS prediction-interval SHAPE sqrt(1 + 1/n + (load-mean_x)^2/ssx),
    which fans out away from the trained load exactly where reps get noisier.
    resid_std is deliberately EXCLUDED (it is absorbed into the conformal quantile,
    which is taken on residuals already divided by this same factor - so calibration
    and prediction stay dimensionally consistent). 1.0 when there is no fitted
    model (constant-width fallback)."""
    if not model or not model.get("ssx") or model["ssx"] <= 0 or not model.get("n"):
        return 1.0
    return math.sqrt(1.0 + 1.0 / model["n"] + (load - model["mean_x"]) ** 2 / model["ssx"])


def predict_reps_conformal(model, last_load, last_reps, target_load, q_g,
                           pooled=None, normalized=False, clamp=(1.0, 20.0)):
    """Conformal drop-in for predict_reps_anchored's interval. The POINT is
    predict_reps_anchored's (unchanged); only the band is recomputed as
    point +- q_g (* the §1b scale when normalized), clamped to a feasible rep
    range. Returns (pt, lo, hi); (pt, None, None) when q_g is None/inf (orphan
    type -> honest point-only, no fabricated band). Returns None when there is no
    anchor to predict from at all."""
    ap = predict_reps_anchored(model, last_load, last_reps, target_load, pooled=pooled)
    if ap is None:
        return None
    point = ap[0]
    scale = _norm_scale(model, target_load) if normalized else 1.0
    band = conformal.conformal_interval(point, q_g, scale=scale, clamp=clamp)
    if band is None:
        return point, None, None
    return point, band[0], band[1]


def rep_conformal_quantiles(conn, alpha=None, groups=None, normalized=None):
    """Mondrian-by-type conformal quantiles {type: q_g, '__global__': q} of the
    walk-forward |residual| nonconformity scores (design 06 section 1c). Replays
    history per lift with ONLY prior data at each step - the same residuals the
    backtest produces - using the SAME pooled slope #2 deploys live (so the scores
    match production), then POOLS them across all lifts of an exercise-TYPE. A
    5-point lift inside an 11-lift chest group thus draws on dozens of residuals:
    enough for a stable, finite quantile. Types below `min_group_n` inherit the
    global pooled quantile; a true orphan stays None (point-only). Computed once
    and threaded through prediction_for like group_slopes, so it is not an O(N^2)
    per-call cost."""
    cfg = conformal._conformal_cfg()
    if alpha is None:
        alpha = conformal.alpha_from_settings()
    if normalized is None:
        normalized = cfg["normalized"]
    if groups is None:
        groups = group_slopes(conn)
    minp = config.settings()["forecast_min_points"]
    pcfg = _rep_pooling_cfg()
    scores_by_type = defaultdict(list)
    allscores = []
    for ex in _all_exercises(conn):
        pts = fresh_points(conn, ex, _cur_epoch(conn, ex))
        if len(pts) <= minp:
            continue
        g = ex_type(ex)
        level = groups.get(g) or groups.get("__global__")
        live_pools = bool(level) and not _personal_strong(fit_load_rep(pts), pcfg)
        for i in range(minp, len(pts)):
            fit = fit_load_rep(pts[:i])                    # prior-only (walk-forward)
            last_load, last_reps = pts[i - 1][0], pts[i - 1][1]
            w_i, r_i = pts[i][0], pts[i][1]
            pooled = None
            if live_pools and level:
                se = (fit["resid_std"] / math.sqrt(fit["ssx"])
                      if fit and fit.get("ssx", 0) > 0 and fit["resid_std"] > 0 else None)
                bstar, _ = shrink_load_rep_slope(
                    fit["slope"] if fit else None, se, level["mu"], level["tau2"])
                rstd = fit["resid_std"] if (fit and fit["resid_std"] > 0) else level["resid_std"]
                pooled = (bstar, rstd)
            ap = predict_reps_anchored(fit, last_load, last_reps, w_i, pooled=pooled)
            if ap is None:
                continue
            score = abs(ap[0] - r_i)
            if normalized:
                sc = _norm_scale(fit, w_i)
                if sc and sc > 0:
                    score = score / sc
            scores_by_type[g].append(score)
            allscores.append(score)
    glob = conformal.conformal_quantile(allscores, alpha)
    fallback = glob if math.isfinite(glob) else None
    out = conformal.mondrian_quantiles(scores_by_type, alpha,
                                       min_n=cfg["min_group_n"], fallback=fallback)
    out["__global__"] = fallback
    return out


# --------------------------------------------------------------------------
# Top-level per-exercise analysis + persistence
# --------------------------------------------------------------------------
def analyze_exercise(conn, ex, epoch, groups=None):
    """Per-exercise load->reps model + grace, plus the partially-pooled slope
    (design 02). Pass `groups` (from group_slopes) to avoid recomputing it per
    call when looping many exercises; omit it for a one-off lookup."""
    points = fresh_points(conn, ex, epoch)
    model = fit_load_rep(points)
    state, conf = grace(model)
    if groups is None:
        groups = group_slopes(conn)
    pooled = pooled_slope_for(ex, model, groups)
    cv = _curvilinear_cfg()
    anchor = fit_anchor(points, ex_type(ex), cv)
    i1rm, i1rm_basis = individ_1rm_dispatch(anchor, model, cv)
    out = {"exercise": ex, "epoch": epoch, "n_fresh": len(points),
           "grace_state": state, "confidence": conf, "model": model,
           "individ_1rm": i1rm, "individ_1rm_basis": i1rm_basis,
           "anchor": ({"M": round(anchor["M"], 1), "ex_type": anchor["ex_type"],
                       "n_eff": round(anchor["n_eff"], 2),
                       "spread": round(anchor["spread"], 3),
                       "basis": anchor["basis"]} if anchor else None),
           "pooled_slope": pooled["slope"] if pooled else None,
           "pooled_resid_std": pooled["resid_std"] if pooled else None,
           "pooled_var": pooled["var"] if pooled else None,
           "slope_basis": pooled["basis"] if pooled else "naive",
           "slope_apply": bool(pooled and pooled["apply"]),
           "borrowed_confidence": pooled["confidence"] if pooled else None}
    return out


def calibration_protocol(conn, ex=None, min_sessions=4):
    """Optional calibration suggestions for lifts not yet 'confident'. Hybrid
    grace period: passive learning + a nudge to map the curve faster."""
    if ex:
        names = [ex]
    else:
        names = [r["exercise_title"] for r in conn.execute(
            """SELECT exercise_title, COUNT(*) c FROM sets WHERE is_working=1
               GROUP BY exercise_title HAVING c>=? ORDER BY c DESC""", (min_sessions,))]
    groups = group_slopes(conn)
    out = []
    for name in names:
        epoch = conn.execute(
            "SELECT MAX(epoch) e FROM sets WHERE exercise_title=?", (name,)).fetchone()["e"] or 0
        a = analyze_exercise(conn, name, epoch, groups)
        if a["grace_state"] == "confident":
            continue
        m = a["model"]
        rpe_n = conn.execute(
            "SELECT COUNT(*) c FROM sets WHERE exercise_title=? AND rpe IS NOT NULL",
            (name,)).fetchone()["c"]
        tips = []
        if a["n_fresh"] < config.priors()["grace"]["n_learn"]:
            tips.append("log a few more normal sessions")
        if not m:
            tips.append("add ONE lighter high-rep set (~10-12) or one heavier near-max "
                        "set so reps clearly trade off with load")
        elif (m["max_x"] / m["min_x"]) < 1.15:
            tips.append("vary the load: after your top set, do one back-off set "
                        "~15-20% lighter to widen the curve")
        if rpe_n == 0:
            tips.append("log RPE on your top set (how many reps were left)")
        if tips:
            out.append({"exercise": name, "grace_state": a["grace_state"],
                        "confidence": a["confidence"], "tips": tips})
    return out


def refresh_models(conn):
    """Fit and persist a load-rep model per exercise (current epoch)."""
    exs = [r["exercise_title"] for r in conn.execute(
        "SELECT DISTINCT exercise_title FROM sets")]
    now = dates.iso(datetime.now())
    groups = group_slopes(conn)
    for ex in exs:
        epoch = conn.execute(
            "SELECT MAX(epoch) e FROM sets WHERE exercise_title=?", (ex,)
        ).fetchone()["e"] or 0
        a = analyze_exercise(conn, ex, epoch, groups)
        m = a["model"]
        anc = a.get("anchor")
        conn.execute(
            """INSERT INTO exercise_models
               (exercise_title, epoch, n_fresh, slope, intercept, r2, resid_std,
                mean_load, ssx, individ_1rm, grace_state, confidence,
                anchor_m, anchor_type, anchor_n_eff, anchor_spread,
                individ_1rm_basis, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(exercise_title) DO UPDATE SET
                 epoch=excluded.epoch, n_fresh=excluded.n_fresh, slope=excluded.slope,
                 intercept=excluded.intercept, r2=excluded.r2, resid_std=excluded.resid_std,
                 mean_load=excluded.mean_load, ssx=excluded.ssx,
                 individ_1rm=excluded.individ_1rm, grace_state=excluded.grace_state,
                 confidence=excluded.confidence, anchor_m=excluded.anchor_m,
                 anchor_type=excluded.anchor_type, anchor_n_eff=excluded.anchor_n_eff,
                 anchor_spread=excluded.anchor_spread,
                 individ_1rm_basis=excluded.individ_1rm_basis, updated_at=excluded.updated_at""",
            (ex, epoch, a["n_fresh"],
             m["slope"] if m else None, m["intercept"] if m else None,
             m["r2"] if m else None, m["resid_std"] if m else None,
             m["mean_x"] if m else None, m["ssx"] if m else None,
             a["individ_1rm"], a["grace_state"], a["confidence"],
             anc["M"] if anc else None, anc["ex_type"] if anc else None,
             anc["n_eff"] if anc else None, anc["spread"] if anc else None,
             a["individ_1rm_basis"], now))
    conn.commit()
