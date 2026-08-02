"""Robust trend estimation (Theil-Sen) - pure Python, no numpy.

Theil-Sen takes the median of all pairwise slopes, so a few outliers or a
unit-jump can't drag the line the way ordinary least squares would.
"""
import statistics


def _percentile(sorted_vals, q):
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    pos = q * (len(sorted_vals) - 1)
    lo = int(pos)
    frac = pos - lo
    if lo + 1 < len(sorted_vals):
        return sorted_vals[lo] * (1 - frac) + sorted_vals[lo + 1] * frac
    return sorted_vals[lo]


def theil_sen(points):
    """points: list of (x, y). Returns dict with slope, intercept, and the
    25th/75th-percentile slope band, or None if <2 distinct x."""
    pts = [(float(x), float(y)) for x, y in points if x is not None and y is not None]
    if len({x for x, _ in pts}) < 2:
        return None
    slopes = []
    n = len(pts)
    for i in range(n):
        for j in range(i + 1, n):
            dx = pts[j][0] - pts[i][0]
            if dx != 0:
                slopes.append((pts[j][1] - pts[i][1]) / dx)
    if not slopes:
        return None
    slopes.sort()
    slope = statistics.median(slopes)
    intercept = statistics.median([y - slope * x for x, y in pts])
    return {
        "slope": slope,
        "intercept": intercept,
        "slope_lo": _percentile(slopes, 0.25),
        "slope_hi": _percentile(slopes, 0.75),
        "n": n,
    }


def classify(fit):
    """Map a Theil-Sen fit to progressing / plateau / declining."""
    if fit is None:
        return "insufficient"
    if fit["slope_lo"] > 0:
        return "progressing"
    if fit["slope_hi"] < 0:
        return "declining"
    return "plateau"


def confidence(n):
    if n >= 8:
        return "high"
    if n >= 5:
        return "medium"
    return "low"
