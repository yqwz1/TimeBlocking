"""Per-set derived metrics: estimated 1RM and volume."""
import math
from . import config, individualize


def epley(weight, reps):
    """Epley estimated 1RM. reps=1 returns the weight itself."""
    if weight is None or reps is None or reps <= 0:
        return None
    return weight * (1 + reps / 30.0)


def e1rm_weightdep(weight, reps):
    """arXiv 2603.17495 weight-dependent 1RM (design 04 section 1b):
        1RM = w * (1 + (r-1)^beta / (a + b*ln w))
    The Epley-style multiplier's denominator grows with the load, so heavier
    sets get a smaller per-rep correction (less heavy-end overshoot).

    DORMANT - exposed for the design-04 bake-off only, NOT the default e1RM:
    the constants were fit on near-failure sets (feed reps-to-failure, not
    reps-performed) and `ln(w)` is unit-sensitive (valid for real-kg barbell
    loads, not machine/stack epochs). Returns None outside its valid domain."""
    if weight is None or reps is None or reps <= 0 or weight <= 0:
        return None
    p = config.priors().get("weightdep_1rm", {})
    a, b, beta = p.get("a", -2.55), p.get("b", 4.58), p.get("beta", 0.85)
    denom = a + b * math.log(weight)
    if denom <= 0:                       # below the formula's load floor -> undefined
        return None
    return round(weight * (1 + (reps - 1) ** beta / denom), 2)


def e1rm(weight, reps_clean, is_bodyweight, rpe=None):
    """Estimated 1RM, only meaningful for loaded sets at <= rep cap.

    When a reliable RPE is logged, Epley is applied to reps-to-failure
    (reps + reps-in-reserve) instead of the reps performed - a set taken to
    RPE 8 understates the true max, so this sharpens the estimate. With no RPE
    (all historical data) the result is byte-identical to plain Epley(reps)."""
    cap = config.settings()["e1rm_rep_cap"]
    if is_bodyweight or weight is None or reps_clean is None:
        return None
    if reps_clean <= 0 or reps_clean > cap:
        return None
    eff_reps = reps_clean
    if rpe is not None:
        rir = individualize.rir_from_rpe(rpe)
        if rir is not None and individualize.rir_reliable(reps_clean, rir):
            cand = reps_clean + rir
            if 1 <= cand <= cap:   # keep Epley inside its reliable range
                eff_reps = cand
    return round(epley(weight, eff_reps), 2)


def volume(weight_norm, reps_clean, is_bodyweight):
    """Relative-load volume = normalized weight x reps. Unit-free, so it is
    safe to sum across exercises. Bodyweight sets contribute reps as a proxy."""
    if reps_clean is None:
        return None
    if is_bodyweight or weight_norm is None:
        return float(reps_clean)
    return round(weight_norm * reps_clean, 4)
