"""Data-quality: anomaly detection and correction proposals.

Every correction keeps the raw value (already stored in *_raw columns) and sets
a quality_flag, so nothing is ever silently overwritten.
"""
import statistics
from . import config


def plausible_reps_cap(exercise_reps):
    """Per-exercise implausibility ceiling for reps."""
    s = config.settings()
    floor = s["implausible_reps_floor"]
    factor = s["implausible_reps_factor"]
    clean = [r for r in exercise_reps if r is not None and 0 < r <= 30]
    med = statistics.median(clean) if clean else 8
    return max(floor, factor * med), med


def _digit_drop_candidates(r):
    """Plausible values reachable by deleting one digit from r."""
    s = str(int(r))
    out = []
    for i in range(len(s)):
        d = s[:i] + s[i + 1:]
        if d:
            v = int(d)
            if 0 < v <= 20:
                out.append(v)
    return out


def correct_reps(reps_raw, exercise_reps):
    """Return (reps_clean, flag). flag is None when the value is plausible."""
    if reps_raw is None:
        return None, None
    cap, med = plausible_reps_cap(exercise_reps)
    if reps_raw <= cap:
        return int(reps_raw), None
    # Implausible: prefer a single-digit-deletion nearest the exercise median.
    cands = _digit_drop_candidates(reps_raw)
    if cands:
        best = min(cands, key=lambda v: abs(v - med))
        return best, "rep_typo_corrected"
    # No clean digit-drop -> fall back to exercise median, still flagged.
    return int(round(med)), "rep_typo_corrected"


def classify_weight(weight_raw):
    """Return (is_bodyweight, flag) for blank/zero loads."""
    if weight_raw is None:
        return True, "blank_weight"
    if weight_raw == 0:
        return True, "zero_weight"
    return False, None


def combine_flags(*flags):
    present = [f for f in flags if f]
    return "|".join(present) if present else None
