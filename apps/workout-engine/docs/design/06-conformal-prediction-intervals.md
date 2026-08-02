# Design spec: Conformal prediction intervals for reps & forecast (#6)

**Status:** design only — not wired into the engine. Targets roadmap item #6.
**Goal:** replace the engine's distribution-assuming prediction intervals with
**conformal** intervals — calibrated, finite-sample, distribution-free — for (a)
rep predictions and (b) the e1RM forecast band, and unify both behind the one
calibration mechanism `forecast.accuracy()` already has. The load-bearing idea for
this single user's tiny per-lift calibration sets is **Mondrian (group-conditional)
conformal by exercise-type**, which reuses the exact grouping from #2.

---

## 0. What we're fixing

Two interval-makers in the engine, with opposite levels of honesty:

1. **Rep intervals are uncalibrated and unmeasured.** `individualize.predict_reps`
   returns `pt ± 1.96·se` with the textbook OLS prediction-interval standard error
   `se = resid_std·sqrt(1 + 1/n + (x−x̄)²/ssx)`, and `predict_reps_anchored` returns
   `pred ± 1.96·resid_std`. Both bake in a **Gaussian, homoscedastic** assumption:
   residuals are Normal, with one variance for all loads. Reps are integer-valued,
   bounded below by ~1, right-skewed near failure, and noisier far from the trained
   load — none of which is Gaussian-homoscedastic. Worse, **nothing checks the
   coverage of these intervals.** `backtest.rep_prediction` scores the *point* MAE
   vs the naive baseline and reports `coverage_pct` — but that field is the fraction
   of eligible sessions for which a prediction could be *made*, not the fraction of
   realized reps that *landed inside the interval*. The interval is asserted, never
   audited.

2. **The forecast band is already half-conformal.** `forecast.accuracy()` does a full
   walk-forward replay (`_walk_forward_errors`), collects the **relative** forecast
   residuals `rel_err = |model − actual|/anchor`, and takes their empirical quantile
   at the configured level via `trend._percentile(rels, level)` to get a *calibrated
   relative half-width* `rel_halfwidth`. `_band()` then applies `anchor·rel_halfwidth`
   around the point. It even self-audits: `band_coverage` is the in-sample fraction of
   realized forecasts with `model_err ≤ anchor·half`. That is **split conformal in all
   but name** — an absolute-residual nonconformity score, an empirical quantile, a
   symmetric band — missing only (i) the finite-sample `1/(n+1)` correction, (ii)
   out-of-sample (purged) calibration, and (iii) a shared implementation with the rep
   side.

**This spec does three things:** (a) reframe `forecast.accuracy`'s band as conformal
and add the finite-sample correction; (b) replace the rep intervals' Gaussian `±1.96·se`
with conformal intervals **calibrated against the same walk-forward residuals
`backtest.rep_prediction` already produces**; (c) make both call one shared
`conformal` helper. The honest tension — per-lift calibration sets are tiny — is the
subject of §2 and is solved by §1c.

---

## 1. The model

### 1a. Split / inductive conformal for the rep predictor

Split (inductive) conformal — Vovk, Gammerman & Shafer; tutorial in Angelopoulos &
Bates — gives a finite-sample marginal coverage guarantee under only **exchangeability**
of the calibration and test points, no distributional form.

Fix a target miscoverage `α` (e.g. `α = 0.2` for 80% intervals, to match
`forecast_band_level = 0.8`). For the rep predictor:

1. **Nonconformity score.** For a calibration example `(load_j, reps_j)` with point
   prediction `r̂_j` (from `predict_reps_anchored` fit on *prior* data only — see §3),

   ```
   s_j = | reps_j − r̂_j |                              # absolute residual
   ```

   This is exactly the absolute walk-forward residual `abs(ap[0] − r_i)` that
   `backtest.rep_prediction` already computes inside its loop. We are not inventing a
   new quantity — we are keeping those residuals instead of averaging them into an MAE.

2. **Conformal quantile with the finite-sample correction.** With `n` calibration
   scores, sort them ascending and take the rank-`k` value where

   ```
   k = ⌈ (n + 1)(1 − α) ⌉                              # ceiling — the +1 is load-bearing
   q = s_(k)            (the k-th smallest score; q = +∞ if k > n)
   ```

   Equivalently, `q` is the empirical quantile at level `(1 − α)(n+1)/n`. The
   `(n+1)` accounts for the unseen test point being exchangeable with the `n`
   calibration points; it **inflates** the quantile level above the naive `1 − α`,
   and when `n` is small that inflation is large (see §2). `trend._percentile`
   computes a plain empirical quantile, so we pass it the *corrected* level
   `q_level = min(1.0, (1 − α)·(n + 1)/n)` rather than `1 − α`. When
   `(n+1)(1−α) > n` (i.e. `n < (1−α)/α`, which for α=0.2 means `n < 4`) the formula
   demands the `(n+1)`-th of `n` scores, which does not exist — the honest output is
   `q = ∞`, i.e. *no finite interval at this confidence*. The engine must surface that
   as "not enough calibration data for an 80% interval" rather than fabricate a band.

3. **Interval.** Symmetric around the point estimate:

   ```
   [ r̂(load) − q ,  r̂(load) + q ]
   ```

   then clamp to the physically admissible rep range (`reps ≥ 1`; cap at the model's
   sane upper bound, e.g. 20 to match the `reps_clean BETWEEN 1 AND 20` filter used in
   `fresh_points`). Clamping after conformalizing is safe — it only ever *shrinks* a
   one-sided over-reach into the feasible set and cannot break the marginal guarantee
   on the unclamped side.

**Guarantee.** If the calibration residuals and the test residual are exchangeable,
then `P(reps ∈ interval) ≥ 1 − α`, exactly, for finite `n` — averaged over draws
(*marginal*, not per-load; see §2). No Gaussianity, no homoscedasticity.

### 1b. CQR — adaptive (heteroscedastic) intervals

Constant-width conformal (§1a) adds the *same* `q` everywhere, so it is wide where the
data is clean and too narrow nowhere only on average. But rep noise is genuinely
heteroscedastic: predictions are tighter at the user's habitual working load and
sloppier far from it (extrapolation) and near failure (the reps→load curve steepens
and integer rounding bites). **Conformalized Quantile Regression** (Romano, Patterson
& Candès 2019, NeurIPS / arXiv:1905.03222) makes the *width* adapt while keeping the
finite-sample guarantee.

1. Fit two **conditional quantile** regressors of reps on load at the lower/upper
   levels `α/2` and `1 − α/2`: `q̂_lo(load)`, `q̂_hi(load)`.
2. Conformal score is the **signed distance outside** the predicted quantile band:

   ```
   E_j = max( q̂_lo(load_j) − reps_j ,  reps_j − q̂_hi(load_j) )
   ```

   (positive when the true value falls outside the band, negative when comfortably
   inside).
3. Take the conformal quantile `Q` of `{E_j}` with the same `⌈(n+1)(1−α)⌉/n` rule, and
   widen/shrink the band:

   ```
   [ q̂_lo(load) − Q ,  q̂_hi(load) + Q ]
   ```

CQR inherits the marginal guarantee of §1a and tends to produce **shorter** intervals
than constant-width conformal when heteroscedasticity is real, because it spends width
where it is needed.

**Quantile regressor in the numpy/sklearn stack.** Two options:
- `statsmodels.regression.quantile_regression.QuantReg` (pinball-loss linear quantile
  fit) — matches the engine's linear, low-dependency ethos; a single `load` covariate,
  two fits (`q=α/2`, `q=1−α/2`). ~15 lines, no tree ensemble.
- `sklearn.ensemble.GradientBoostingRegressor(loss="quantile", alpha=…)` — flexible
  non-linear quantiles, but needs hundreds of points and tuning.

**When CQR is overkill for one user.** With a single covariate (load) and typically
5–80 points per lift, two quantile regressors are barely identifiable; their own
estimation noise can *exceed* the heteroscedasticity they are meant to capture. A
robust middle ground that keeps adaptivity without fitting quantile curves is the
**normalized (locally-weighted) conformal** score:

```
s_j = | reps_j − r̂_j | / σ̂(load_j)
interval = r̂(load) ± q · σ̂(load)
```

where `σ̂(load)` is a cheap, monotone heteroscedastic scale — e.g. the OLS
prediction-interval shape factor the engine *already* computes in `predict_reps`,
`σ̂(load) = resid_std·sqrt(1 + 1/n + (load − mean_x)²/ssx)`. This recycles a quantity
the code has in hand, makes the band fan out away from `mean_x` exactly where reps get
noisier, and conformalizes the *normalized* residual so coverage is still calibrated.
**Recommendation:** ship normalized-residual conformal first (adaptive, ~free, robust
at small `n`); reserve full CQR (QuantReg) for the data-rich lifts (T-Bar Row: 80 pts)
where the quantile fits are stable, and only if the §3 backtest shows it actually
shortens intervals at fixed coverage.

### 1c. THE SMALL-n FIX — Mondrian (group-conditional) conformal by exercise-type

This is the central idea of the spec. **Per-lift split conformal fails on this data**:
25/71 lifts have enough load-varied points to fit a slope at all, and many have `n < 12`
calibration residuals after the walk-forward warm-up (`forecast_min_points = 5`
consumes the first 5). With `n = 8`, the §1a correction forces `q_level =
0.8·9/8 = 0.9` — you are reading the 90th-percentile *of 8 numbers*, i.e. essentially
the max, so the interval is both **unstable** (one bad session swings it) and
**conservative** (over-wide). With `n < 4` there is no finite 80% interval at all.

**Mondrian / group-conditional conformal** (Angelopoulos & Bates §4, "group-conditional
coverage") rescues this. Partition the calibration residuals into groups and compute a
*separate* conformal quantile per group, but choose the groups coarse enough that each
has a stable `n`. Here the natural partition is **exercise-type** — the *same*
`default / lower_compound / upper_press` grouping that #2's hierarchical pooling and
#4's type-level spline already use (`exercises.json` exercise→type map; pooling group
sizes from the roadmap profile: back 13, chest 11, biceps 7, triceps 5, shoulders 5).

```
for test point on exercise e in type g:
    S_g = { all walk-forward |residual| scores from every lift in type g }   # pooled
    q_g = conformal_quantile(S_g, alpha)        # ⌈(|S_g|+1)(1−α)⌉ rule
    interval = r̂_e(load) ± q_g
```

Pooling residuals across a type multiplies the calibration count by the number of lifts
in the group, so a 5-point lift inside an 11-lift chest group draws on dozens of
residuals — enough for a stable quantile and a finite 80% band. The guarantee upgrades
from purely marginal to **marginal-within-type** (conditional on `g`): coverage holds
*for each exercise-type*, which is far more useful than one global rate that could be
90% on presses and 65% on machines.

This ties to #2 and #4 directly and **must** share the same exercise→type map:
- #2 pools the load→reps *slope* by type → the point estimate `r̂_e` borrows its slope
  from type `g`.
- #6 pools the *residual* by type → the interval around that point borrows its width
  from type `g`.
- A mislabeled lift therefore borrows both the wrong slope *and* the wrong interval
  width — the one-time `exercises.json` audit #2 already calls for covers #6 too.

**Mondrian validity caveat (be precise):** group-conditional conformal is only valid if
the *group label is known before seeing the score* and the exchangeability holds
*within each group*. Both are satisfied here — type is a fixed property of the exercise,
assigned before any residual is computed. The honest cost is that a type must clear a
**minimum pooled `n`** to get a finite interval; a lone machine in a singleton type
(no same-type siblings, no load variation) still cannot be calibrated and is correctly
flagged "no calibrated interval — naive point only." Optionally back off one level
(type → global) for such orphans, mirroring #2's 3-level option, accepting that the
guarantee then degrades to marginal-global for those few lifts.

### 1d. Unify with the forecast band — one shared conformal utility

`forecast.accuracy()` already computes a calibrated relative half-width; this spec
**reframes it as conformal** and factors the shared logic out of both `_band` and
`predict_reps`. Introduce a small pure module (sketch `conformal.py`, or a section of
`trend.py` since it reuses `_percentile`):

```
conformal_quantile(scores, alpha):   # the ⌈(n+1)(1−α)⌉/n empirical-quantile rule
conformal_interval(point, q, scale=1.0, clamp=None):
mondrian_quantiles(scores_by_group, alpha):   # {group: q_g}
```

Then:
- **Forecast band.** `forecast.accuracy` keeps building `rels` exactly as today, but
  replaces `trend._percentile(rels, level)` with `conformal_quantile(rels, 1−level)`,
  i.e. it requests the *corrected* level `(level)·(n+1)/n` instead of `level`. The
  result `rel_halfwidth` flows unchanged into `_band()` via the existing `calib` dict,
  so `forecast_exercise` and the report need **no** change. The only visible effect is
  a slightly wider band at small `n` (the finite-sample honesty the current code
  omits). `_band`'s existing fallback to the slope-quartile spread stays as the
  "no calibration yet" path.
- **Forecast band, Mondrian variant (optional).** `_walk_forward_errors` already tags
  each residual with its exercise; bucket `rels` by exercise-type and store
  `{type: rel_halfwidth_g}` so a forecast band is calibrated to its lift's type rather
  than to all lifts globally. Same mechanism as the rep side — one utility, two callers.
- **Rep band.** `predict_reps_anchored` (and `predict_reps`) stop computing `±1.96·se`
  and instead call `conformal_interval(point, q_g, scale)` where `q_g` is the Mondrian
  quantile for the lift's type from §1c and `scale` is `1` (constant-width) or
  `σ̂(load)` (normalized, §1b).

The single source of truth for "what quantile, with what finite-sample correction"
becomes `conformal_quantile`, used identically by reps and forecast. This is the
"unify them" deliverable: today the forecast side is calibrated and the rep side is
not; after this, both are calibrated by the *same* function.

### 1e. Tie to #5 — RIR-inflated observation variance

#5 folds RIR (reps-in-reserve) noise into the rep/1RM fit, inflating the observation
variance for sets logged far from failure (high RIR, where the rep↔load mapping is
loose). When #5 lands, the conformal score should be the **normalized** residual
(§1b form) so the interval automatically reflects that extra variance:

```
s_j = | reps_j − r̂_j | / σ̂_j ,   σ̂_j² = σ̂_model(load_j)² + σ̂_RIR,j²
interval = r̂(load) ± q_g · σ̂(load)
```

A set logged at RIR 4 then earns a proportionally wider interval than a near-failure
set at the same load, *and* coverage stays calibrated because the conformal quantile is
taken on the normalized scores. If #5 is not built, `σ̂_RIR,j = 0` and this degrades
gracefully to §1b. (Conformal does not *need* #5 — it is distribution-free — but
normalizing by a better variance model makes the intervals **sharper** at the same
coverage, which is the only lever conformal leaves on the table; see §6.)

---

## 2. Small-data caveats & honesty

This is the section that must not be oversold.

- **Marginal vs conditional coverage.** Split conformal guarantees `P(Y ∈ Ĉ(X)) ≥ 1−α`
  *averaged over X* (marginal). It does **not** guarantee `P(Y ∈ Ĉ(x) | X=x) ≥ 1−α` for
  every load (conditional) — distribution-free conditional coverage is provably
  impossible at finite `n` (Vovk; Foygel-Barber et al.). Mondrian-by-type buys
  coverage *within each type* (a coarsening toward conditional), and CQR/normalization
  make the width *track* `x` heuristically, but the formal promise stays marginal. We
  state coverage as "≈ nominal overall and per exercise-type," never "per load."

- **The `1/(n+1)` slack is real and large here.** The achievable coverage lives in
  `[1−α, 1−α + 1/(n+1)]`. At `n = 10`, that ceiling is `0.8 + 0.091 ≈ 0.89` — the
  interval can be up to ~9 points over-covered (hence wider than necessary). The
  `⌈(n+1)(1−α)⌉` ceiling is what creates the over-coverage; it is the price of an
  *honest* finite-sample guarantee, not a bug. Larger pooled `n` (Mondrian) shrinks the
  slack toward zero.

- **Why per-lift naive conformal fails, concretely.** With `n = 8` and α = 0.2, `k =
  ⌈9·0.8⌉ = 8` → `q = s_(8)` = the **largest** of 8 residuals. One outlier session sets
  the band for the whole lift, and the band is near-maximal width. With `n = 6`,
  `k = ⌈7·0.8⌉ = 6` = the max of 6 — same pathology, sparser. With `n ≤ 3`, no finite
  80% interval exists. So per-lift conformal is simultaneously **unstable** (max-driven)
  and **frequently undefined** — unusable for the ~42 starved lifts.

- **Why Mondrian-by-type rescues it.** Pooling a 5-point lift into an 11-lift chest
  group yields tens of residuals; the 80%-corrected quantile is then a genuine interior
  order statistic, stable to any single session, and always finite. The cost is the
  exchangeability assumption *within type* — fine for the slope (#2 already assumes
  same-type lifts share the reps↔load relationship) and reasonable for the residual
  scale, but it does assume a press's rep-noise magnitude is comparable to another
  press's. That is an *assumption*, stated as one.

- **Autocorrelation breaks naive exchangeability.** The series are autocorrelated
  (consecutive sessions on a lift are correlated), so calibration and test residuals
  are not perfectly exchangeable → coverage can be slightly optimistic. The fix is
  **purged / embargoed** walk-forward splits (López de Prado 2018): when scoring a
  forecast at session `i`, drop calibration residuals whose training/target window
  overlaps `i` (purge) and leave a gap (embargo) so leakage across the horizon can't
  inflate coverage. `_walk_forward_errors` already trains on strictly-prior data and
  matches the target within ±21 days — the embargo is an explicit extension of that
  windowing, not a new harness.

- **What coverage we can realistically guarantee.** Honestly: **≈ nominal marginal
  coverage, per exercise-type, with up to `1/(n_g+1)` upward slack, modulo mild
  autocorrelation optimism.** For data-rich types (back, chest) the pooled `n_g` is
  large enough that the band is both calibrated and reasonably sharp. For sparse types
  the band will be *honestly wide* (or undefined for orphans). That is the deal:
  conformal trades the Gaussian fiction's false precision for an interval that tells the
  truth about how little we know.

---

## 3. Validation

Extend the validation the engine already has rather than build a new harness.

- **Add a coverage track for rep intervals.** `backtest.rep_prediction` currently keeps
  only `abs(ap[0] − r_i)` (the point error). In the same loop, also compute the
  conformal interval `[lo_i, hi_i]` for session `i` using **only residuals from
  sessions < i** (and, for Mondrian, from the lift's type), and record the hit
  indicator `lo_i ≤ r_i ≤ hi_i` and the width `hi_i − lo_i`. Report
  `rep_band_coverage = mean(hits)` and `rep_band_median_width` — mirroring the
  existing `forecast.band_coverage`, which becomes the rep side's template.

- **Purged / embargoed walk-forward.** Calibrate each session's quantile from strictly
  prior, non-overlapping residuals with an embargo gap (§2). Both `rep_prediction` and
  `_walk_forward_errors` already iterate `for i in range(minp, len(...))` on
  time-ordered series — the change is *which prior residuals enter the calibration
  set*, not the loop structure.

- **Compare against the incumbent Gaussian band.** For the rep side, also record the
  coverage and width of the current `±1.96·se` interval over the same walk-forward, so
  the before/after is on identical data. The whole claim is "calibrated AND no wider
  than the thing it replaces."

**Pre-registered success bar (set before looking):**
> Adopt conformal rep intervals iff, on the walk-forward backtest at nominal 80%:
> (1) empirical `rep_band_coverage ∈ [0.75, 0.85]` overall **and** within each
> exercise-type that has `n_g ≥ 20` pooled residuals (the `±5%` coverage tolerance);
> **and** (2) median conformal width `≤` median current Gaussian `±1.96·se` width on
> the same sessions. For the forecast band: adopt the finite-sample-corrected /
> Mondrian variant iff `band_coverage` moves **toward** nominal (the current in-sample
> number is optimistic) **without** median band width increasing by more than ~10%.

**Honest null is an acceptable outcome.** If conformal coverage lands at nominal but the
intervals come out *wider* than the Gaussian ones, that means **the Gaussian intervals
were over-confident** (under-covering) and the honest interval is genuinely wider — we
report that and keep conformal, because coverage is the guarantee we actually want. If
Mondrian-by-type cannot reach `n_g ≥ 20` for the sparse types even after pooling, those
types keep the naive point with an explicit "interval not calibrated" flag rather than a
fabricated band — also an acceptable, honest outcome.

---

## 4. Pseudocode (numpy / stdlib-flavored)

Reuses `trend._percentile`; no hard numpy dependency for the basic path.

```python
import math

# --- shared conformal core (new conformal.py, or a block in trend.py) -----------

def conformal_quantile(scores, alpha):
    """Finite-sample split-conformal quantile of nonconformity scores.
    Returns +inf when n is too small for a finite (1-alpha) interval."""
    s = sorted(v for v in scores if v is not None)
    n = len(s)
    if n == 0:
        return float("inf")
    k = math.ceil((n + 1) * (1.0 - alpha))      # rank with the +1 correction
    if k > n:
        return float("inf")                      # no finite interval at this level
    # corrected empirical-quantile level, fed to the engine's existing _percentile
    q_level = min(1.0, (1.0 - alpha) * (n + 1) / n)
    from .trend import _percentile
    return _percentile(s, q_level)               # == s[k-1] up to interpolation

def conformal_interval(point, q, scale=1.0, clamp=None):
    if q == float("inf"):
        return None                              # honest: no calibrated interval
    half = q * scale
    lo, hi = point - half, point + half
    if clamp is not None:
        lo, hi = max(clamp[0], lo), min(clamp[1], hi)
    return [lo, hi]

def mondrian_quantiles(scores_by_group, alpha, min_n=20, fallback=None):
    """One conformal quantile per group; groups below min_n inherit `fallback`
    (e.g. the global pooled quantile) or stay None (orphan -> no interval)."""
    out = {}
    for g, scores in scores_by_group.items():
        q = conformal_quantile(scores, alpha) if len(scores) >= min_n else float("inf")
        out[g] = q if q != float("inf") else (fallback if fallback is not None else None)
    return out

# --- rep-interval calibration, Mondrian-by-type, walk-forward --------------------

def rep_conformal_quantiles(conn, alpha, ex_type):
    """Pooled |residual| scores per exercise-TYPE from a walk-forward replay,
    using ONLY prior sessions for each residual (purged)."""
    scores_by_type = defaultdict(list)
    for ex in exercises(conn):
        pts = fresh_series(conn, ex, cur_epoch(conn, ex))   # [(date, load, reps)]
        g = ex_type(ex)
        for i in range(MINP, len(pts)):
            train = [(w, r) for _, w, r in pts[:i]]          # strictly prior
            model = fit_load_rep(train)                      # may be None -> slope 0
            # (with #2: model slope := shrink_load_rep_slope(... , group_slopes ...))
            last_load, last_reps = pts[i-1][1], pts[i-1][2]
            ap = predict_reps_anchored(model, last_load, last_reps, pts[i][1])
            if ap:
                scores_by_type[g].append(abs(ap[0] - pts[i][2]))   # nonconformity
    g_all = [v for arr in scores_by_type.values() for v in arr]
    fallback = conformal_quantile(g_all, alpha)              # global pooled backstop
    return mondrian_quantiles(scores_by_type, alpha, min_n=20, fallback=fallback)

def predict_reps_conformal(model, last_load, last_reps, target_load, q_g,
                           normalized=False, clamp=(1.0, 20.0)):
    """Drop-in for predict_reps_anchored's interval: conformal, not +-1.96*se."""
    ap = predict_reps_anchored(model, last_load, last_reps, target_load)
    if ap is None or q_g is None:
        return ap                                            # point-only / no band
    point = ap[0]
    if normalized and model:                                 # §1b adaptive width
        scale = model["resid_std"] * math.sqrt(
            1 + 1/model["n"] + (target_load - model["mean_x"])**2 / model["ssx"])
        scale = scale / (model["resid_std"] or 1.0)          # normalize: q_g is on r/sigma
    else:
        scale = 1.0
    band = conformal_interval(point, q_g, scale=scale, clamp=clamp)
    return point if band is None else (point, band[0], band[1])

# --- forecast band: reframe accuracy()'s rel_halfwidth as conformal --------------

def forecast_rel_halfwidth(rels, level):
    """Replaces `trend._percentile(rels, level)` in forecast.accuracy().
    Same inputs, now with the finite-sample (1-level) conformal correction."""
    return conformal_quantile(rels, alpha=1.0 - level)       # feeds calib['rel_halfwidth']
```

The forecast change is a **one-line swap** in `forecast.accuracy`:
`half = conformal_quantile(rels, 1 - level)` in place of
`trend._percentile(rels, level)` (guarded by the existing `len(rels) >= 8` gate, which
also keeps `conformal_quantile` away from its `n`-too-small `inf` branch). Everything
downstream — `calib["rel_halfwidth"]`, `_band`, `forecast_exercise`, the report — is
untouched. The Mondrian-by-type forecast variant buckets `rels` by exercise-type and
stores a `{type: rel_halfwidth_g}` dict that `_band` indexes by the lift's type.

---

## 5. Integration points

- **`individualize.py`** — the main change. `predict_reps` and
  `predict_reps_anchored` stop returning `pt ± 1.96·se` and call
  `predict_reps_conformal` (above) with the lift's Mondrian quantile `q_g`. The point
  estimate is unchanged (so the strong point-accuracy result of the rep model is
  preserved); only the interval becomes calibrated. `analyze_exercise` gains the type's
  `q_g` (and, if normalized, leaves `resid_std/ssx` in place — already there).
- **`forecast.py`** — `accuracy()` swaps `trend._percentile(rels, level)` for
  `conformal_quantile(rels, 1−level)`; `_band` is unchanged unless the Mondrian-by-type
  forecast variant is adopted, in which case `_band` selects `rel_halfwidth_g` by the
  exercise's type. `forecast_exercise` and the report consume the same `band` keys as
  today — **no schema change**.
- **`backtest.py`** — `rep_prediction` adds `rep_band_coverage` and
  `rep_band_median_width` (computed walk-forward, prior-only, purged) alongside the
  existing `model_mae`/`naive_mae`/`beats_naive`; `forecast` already surfaces
  `band_coverage` via `fc.accuracy`, which now reflects the corrected quantile. This is
  the validation harness the §3 success bar reads.
- **`trend.py` / new `conformal.py`** — host `conformal_quantile`,
  `conformal_interval`, `mondrian_quantiles`. Reuses `_percentile`; pure stdlib for the
  constant-width and normalized paths. numpy only enters if the optional CQR/QuantReg
  path (§1b) is built for data-rich lifts.
- **`config/settings.json`** — the level already exists: `forecast_band_level = 0.8`
  drives `α = 1 − 0.8 = 0.2` for **both** sides (one knob, two callers — the unification
  in user-visible config). Optional additions: `conformal_min_group_n` (default 20, the
  Mondrian `min_n` gate) and `conformal_normalized` (bool, §1b). `forecast_min_points`
  still defines the walk-forward warm-up that the calibration set excludes.
- **Exercise→type map (`exercises.json`)** — shared with #2/#4. Its quality now also
  governs interval width; the one-time audit #2 calls for is a prerequisite for #6.

---

## 6. Honest expectation / ceiling

- **Conformal guarantees coverage, not sharpness.** It will make the stated 80%
  intervals *actually* cover ~80% (per type), which the Gaussian `±1.96·se` intervals
  are not checked to do. It will **not** make them narrow. If a lift's reps are
  genuinely noisy, the honest 80% interval is *wide* — and that width is a **feature**:
  it tells the user the truth about how uncertain the prediction is, instead of a
  precise-looking `±1.96·se` that quietly under-covers. The only way to *shrink* an
  honest interval is a better point model (#2, #4) or a better variance model (#5, via
  §1b/§1e normalization) — conformal then calibrates *whatever* sharpness those provide.
- **Marginal, not conditional.** Even Mondrian-by-type only delivers coverage *per
  type*, not per individual load — distribution-free conditional coverage is impossible
  at finite `n`. A user asking "is *this specific* heavy single's interval trustworthy?"
  gets a type-level, not point-level, guarantee. We will not claim otherwise.
- **Small-`n` means the guarantee is approximate.** The `1/(n+1)` slack makes sparse
  types over-cover (over-wide), and mild autocorrelation can make coverage slightly
  optimistic even after embargo. The pooled-by-type design is what keeps `n` large
  enough for the approximation to be good on the data-rich types; the sparse types are
  honestly labeled rather than fixed.
- **Orphans stay uncovered.** A lone lift in a singleton type with no load variation has
  neither a slope (#2 can't pool it) nor a calibratable interval (#6 can't pool it) —
  it correctly returns a naive point with "no calibrated interval," not a fake band.
- **Net.** #6 is a *medium* item by design (roadmap: Impact Med, Effort Low): the
  forecast side is ~80% there already, so most of the work is the rep side and the
  shared utility. The payoff is **honesty**, not accuracy — the engine stops asserting
  unverified intervals and starts reporting calibrated ones, with the truth-telling
  width that implies.

---

## References (verified 2026-06-28; see roadmap 00 for the sweep)

- Vovk, Gammerman & Shafer — *Algorithmic Learning in a Random World* (conformal
  prediction; distribution-free, finite-sample marginal coverage; split/inductive
  conformal).
- Romano, Patterson & Candès 2019 — *Conformalized Quantile Regression* (CQR), NeurIPS
  2019 / arXiv:1905.03222 — heteroscedastic, adaptive-width intervals; typically
  shorter than constant-width conformal.
- Angelopoulos & Bates — *A Gentle Introduction to Conformal Prediction and
  Distribution-Free Uncertainty Quantification* — split/inductive and group-conditional
  (Mondrian) conformal; impossibility of distribution-free conditional coverage.
- López de Prado 2018 — *Advances in Financial Machine Learning* — purged / embargoed
  cross-validation for autocorrelated series.
- Cross-refs: roadmap items **#2** (hierarchical pooling by exercise-type — same
  grouping), **#4** (type-level spline), **#5** (RIR observation variance → normalized
  score).
