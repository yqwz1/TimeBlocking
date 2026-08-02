"""Split (inductive) conformal prediction - the shared, distribution-free
interval core for reps and the e1RM forecast (design 06).

Conformal intervals give a finite-sample *marginal* coverage guarantee under only
exchangeability of the calibration and test residuals - no Gaussianity, no
homoscedasticity. The single source of truth for "what quantile, with what
finite-sample correction" lives here and is used identically by the rep predictor
(individualize) and the forecast band (forecast.accuracy). This is the "unify
them" deliverable of #6: today the forecast side is calibrated and the rep side
is not; after this, both are calibrated by `conformal_quantile`.

Pure stdlib. The load-bearing small-n idea (Mondrian / group-conditional conformal
by exercise-TYPE) lives in `mondrian_quantiles`; the per-lift calibration sets on
this one user's sparse data are far too small to calibrate alone, so residuals are
pooled across same-type lifts (the SAME grouping #2 pools the slope by and #4 the
curve by).
"""
import math

from . import config


def conformal_quantile(scores, alpha):
    """Finite-sample split-conformal quantile of nonconformity scores at
    miscoverage `alpha` (so a 1-alpha interval).

    With n calibration scores, the guaranteeing quantile is the rank-k order
    statistic where k = ceil((n+1)(1-alpha)) - the EXACT order statistic, not an
    interpolated percentile, so the marginal guarantee P(Y in C) >= 1-alpha holds
    exactly for finite n. The +1 accounts for the unseen test point being
    exchangeable with the n calibration points; it inflates the level above the
    naive 1-alpha, and that inflation is large when n is small (the honest cost of
    a finite-sample guarantee). When (n+1)(1-alpha) > n the rule asks for the
    (n+1)-th of n scores, which does not exist -> +inf, i.e. NO finite interval at
    this confidence (for alpha=0.2 this is n < 4). Callers must surface that as
    "not enough calibration data" rather than fabricate a band."""
    s = sorted(v for v in scores if v is not None and math.isfinite(v))
    n = len(s)
    if n == 0:
        return float("inf")
    k = math.ceil((n + 1) * (1.0 - alpha))     # rank with the load-bearing +1
    if k > n:
        return float("inf")                    # no finite (1-alpha) interval yet
    return s[k - 1]                            # k-th smallest (1-indexed)


def conformal_interval(point, q, scale=1.0, clamp=None):
    """Symmetric conformal interval [point - q*scale, point + q*scale], optionally
    clamped to a physically admissible range. Returns None when q is +inf/None
    (honest: no calibrated interval). `scale` carries the §1b normalized
    (heteroscedastic) width; it is 1.0 for the constant-width band. Clamping after
    conformalizing only ever shrinks a one-sided over-reach into the feasible set,
    so it cannot break the marginal guarantee on the unclamped side."""
    if q is None or not math.isfinite(q):
        return None
    half = q * scale
    lo, hi = point - half, point + half
    if clamp is not None:
        lo, hi = max(clamp[0], lo), min(clamp[1], hi)
    return [lo, hi]


def mondrian_quantiles(scores_by_group, alpha, min_n=20, fallback=None):
    """Group-conditional (Mondrian) conformal: one quantile per group, but only
    for groups with a stable pooled n (>= min_n). Groups below the floor inherit
    `fallback` (e.g. the global pooled quantile) or stay None (an orphan type with
    no same-type siblings -> no calibrated interval). The guarantee upgrades from
    purely marginal to marginal-within-group, which is far more useful than one
    global rate that could be 89% on presses and 65% on machines. Valid because
    the group label (exercise-TYPE) is a fixed property known before any score is
    computed."""
    out = {}
    for g, scores in scores_by_group.items():
        q = conformal_quantile(scores, alpha) if len(scores) >= min_n else float("inf")
        out[g] = q if math.isfinite(q) else fallback
    return out


def lookup(quantiles, group):
    """Resolve a group's conformal quantile from a mondrian dict, falling back to
    the '__global__' pooled quantile when the group is absent or uncalibrated
    (None). Explicit None-check, not `or`, so a legitimately zero-width q (perfect
    predictions) is not mistaken for 'missing'."""
    q = quantiles.get(group)
    if q is None:
        q = quantiles.get("__global__")
    return q


def alpha_from_settings():
    """The one knob, two callers: the forecast band level drives alpha for BOTH
    the forecast band and the rep intervals (design 06 section 5)."""
    return 1.0 - config.settings().get("forecast_band_level", 0.8)


def _conformal_cfg():
    """Conformal knobs from priors.json over safe defaults. enabled gates the live
    swap (rep band + forecast band); when false everything is byte-identical to the
    pre-#6 Gaussian / plain-percentile behavior."""
    base = {"enabled": False, "min_group_n": 20, "normalized": False,
            "coverage_lo": 0.75, "coverage_hi": 0.85, "min_type_n": 20,
            "forecast_width_tol": 0.10}
    base.update({k: v for k, v in config.priors().get("conformal", {}).items()
                 if not k.startswith("_")})
    return base
