"""Per-exercise unit-epoch detection and relative-load indexing.

Absolute logged weight is unreliable: the same exercise can switch units
mid-history (e.g. Lat Pulldown 14 -> 110). We split each exercise into
contiguous "unit epochs" wherever the monthly-median load steps by more than
`unit_jump_ratio`, then index every set to its epoch's baseline.

v3 hardening:
- Epoch baselines are OUTLIER-ROBUST: per-epoch weight typos (e.g. a stray 211
  on an exercise that lives at ~23-87) are flagged and excluded from the
  baseline and from downstream e1RM/volume, instead of corrupting them.
- Tiny spurious epochs (< min_epoch_sets) are merged into their neighbour.
- A `unit_epochs` override in config/exercises.json is authoritative when set.
"""
import statistics
from collections import defaultdict, Counter
from . import config


def _monthly_medians(items):
    by_month = defaultdict(list)
    for m, w in items:
        if w is not None and w > 0:
            by_month[m].append(w)
    return [(m, statistics.median(by_month[m])) for m in sorted(by_month)]


def _auto_month_to_epoch(items, ratio):
    months = _monthly_medians(items)
    mapping, epoch, prev = {}, 0, None
    for m, med in months:
        if prev is not None and med > 0 and prev > 0:
            r = med / prev if med >= prev else prev / med
            if r >= ratio:
                epoch += 1
        mapping[m] = epoch
        prev = med
    return mapping


def _override_month_to_epoch(items, boundaries):
    """boundaries: ISO dates (YYYY-MM or YYYY-MM-DD) where a new epoch starts."""
    bnds = sorted(b[:7] for b in boundaries)
    return {m: sum(1 for b in bnds if m >= b) for m, _ in items if m}


def _merge_small(epochs, min_sets):
    """Collapse epochs with fewer than min_sets sets into the prior kept epoch."""
    cnt = Counter(epochs)
    uniq = sorted(cnt)
    if not uniq:
        return epochs
    kept = [e for e in uniq if e == uniq[0] or cnt[e] >= min_sets]
    newidx = {e: i for i, e in enumerate(kept)}
    mapping = {}
    for e in uniq:
        k = max(x for x in kept if x <= e)
        mapping[e] = newidx[k]
    return [mapping[e] for e in epochs]


def normalize_exercise(items, override=None):
    """items: list of (month_str, weight). Returns (epochs, norms, outliers)
    aligned to input order. norms = load indexed to the epoch baseline (1.0 =
    baseline); outliers[i] True for per-epoch weight typos (norm/e1rm excluded)."""
    s = config.settings()
    ratio = s["unit_jump_ratio"]
    k = s.get("weight_outlier_k", 2.5)
    min_sets = s.get("min_epoch_sets", 4)

    if override:
        m2e = _override_month_to_epoch(items, override)
    else:
        m2e = _auto_month_to_epoch(items, ratio)
    epochs = [m2e.get(m, 0) if m else 0 for m, _ in items]
    if not override:
        epochs = _merge_small(epochs, min_sets)

    by_ep = defaultdict(list)
    for i, (m, w) in enumerate(items):
        if w is not None and w > 0:
            by_ep[epochs[i]].append((i, m, w))

    baseline, outliers = {}, [False] * len(items)
    for ep, rows in by_ep.items():
        med = statistics.median([w for _, _, w in rows])
        lo, hi = med / k, med * k
        clean = []
        for i, m, w in rows:
            if w < lo or w > hi:
                outliers[i] = True
            else:
                clean.append((m, w))
        if clean:
            first = min(m for m, _ in clean)
            baseline[ep] = statistics.median([w for m, w in clean if m == first])
        else:
            baseline[ep] = med

    norms = []
    for i, (m, w) in enumerate(items):
        if w is None or w <= 0 or outliers[i]:
            norms.append(None)
            continue
        b = baseline.get(epochs[i]) or w
        norms.append(round(w / b, 4) if b else None)
    return epochs, norms, outliers
