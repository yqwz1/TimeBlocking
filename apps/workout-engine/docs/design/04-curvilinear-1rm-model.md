# Roadmap #4 — Curvilinear, regularized load→reps / 1RM model

**Status:** design spec (math + pseudocode). No engine code changes in this document.
**Integration targets:** `workout/metrics.py` (`e1rm`, `epley`), `workout/individualize.py` (`fit_load_rep`, `individual_1rm`, `predict_reps`, `load_for_reps`, `ols`, `refresh_models`), `config/priors.json` (`reps_at_pct1rm`, `grace`).
**Companion:** mirrors the structure/rigor of item #1 (fitness–fatigue "form" model). Reads roadmap #2 (hierarchical partial pooling) as a hard dependency for the curvature term.

---

## 0. What we're fixing

`individual_1rm()` extrapolates a **straight line** of reps-vs-load out to reps = 1:

```
load_for_reps(model, 1) = (1 - intercept) / slope
```

A line fit on the user's *working* range (typically 5–10 reps, loads roughly 70–85% of true max) has a single slope `dr/dW`. Pushed to the 1RM end, a line **overshoots**: the true reps-vs-%1RM curve is convex (it flattens as you approach 1RM — the last ~10% of load costs disproportionately many reps), so a line tangent to the 6–10 rep region predicts a 1-rep load that is **too high**. The Nuzzo 2024 meta-regression confirms this shape directly: reps-vs-%1RM is best fit by **natural cubic splines**, not a line or a single exponential, and the curve steepens near 100%.

The current code half-knows this and papers over it with two clamps:

- `individual_1rm()` rejects the estimate when `v > max_x * 1.4` (more than 40% beyond the heaviest load actually trained), and
- it gates on `r2 ≥ 0.4` and `slope ≤ −0.02`.

So today the engine *suppresses* the linear 1RM whenever extrapolation gets fragile and silently falls back to the Epley `e1rm()` per-set number. That's safe but it throws away the per-exercise individualization exactly where we most want it (the heavy end), and the `1.4×` clamp is an arbitrary stand-in for "the line is the wrong shape out here."

**Why we can't just fit a curve per lift.** Curvature is a second-derivative feature. With a slope you need load *spread*; with curvature you need spread **and** points at *both ends* of the range, plus enough of them to separate quadratic-or-spline structure from noise. The data regime forbids this for almost every lift:

- Only **25 / 71** lifts have enough load variation to fit even a *slope* today (`ols` needs `ssx > 0` and `n ≥ 3`; `fit_load_rep` additionally needs `slope < 0`).
- Many isolations are trained at a **near-fixed load** (`calibration_protocol` already flags `max_x/min_x < 1.15`). With one load there is zero curvature signal.
- Even among the 25, most have load spread concentrated in a 3-rep-wide band (top set + one back-off). A per-lift quadratic there is dominated by the noise term `resid_std`; you'd be fitting curvature to residual wiggle.

So the design principle, identical in spirit to item #1's "don't free-fit the fitness–fatigue time constants": **do not estimate curvature per lift.** Borrow the *shape* from the population/exercise-type level (where Nuzzo gives us a strong prior and where roadmap #2 pools data across same-type lifts), and let each lift keep only its **local anchor** (one or two parameters it has the data to identify). Curvature is a group-level parameter; the anchor is lift-local. That single sentence is the whole spec.

---

## 1. The model

We want a function `reps(W)` (and its inverse `load_for_reps`, and the 1-rep special case `individual_1rm`) that is **convex near the top end** and **degrades gracefully** to the current linear behavior when a lift has no curvature signal. Three candidate forms.

### 1a. Natural cubic spline of reps ↔ %1RM, per exercise *type* (Nuzzo)

This is the research-backed shape. Work in **normalized load** `p = W / OneRM` (a percentage, unit-free — see §2 for why that matters) and model expected reps-to-failure:

```
E[reps_to_failure | p]  =  s_type(p)
```

where `s_type(·)` is a **natural cubic spline** (linear beyond the boundary knots) fit once per exercise type `type ∈ {default, lower_compound, upper_press}` — exactly the three buckets `priors.json → reps_at_pct1rm` already defines. The spline is **monotone decreasing** in `p` and convex over the working range.

We don't need to fit the spline from scratch — `priors.json` already stores Nuzzo's tabulated `reps_at_pct1rm` per type. Treat those as the spline's **knot values** and fit a natural cubic spline through them (knots at the tabulated percentages 65→100):

```
default:        {100:1, 95:2,  90:4,  85:6,  80:8,  75:10, 70:12, 65:15}
lower_compound: {100:1, 95:3,  90:5,  85:8,  80:13, 75:16, 70:19, 65:22}
upper_press:    {100:1, 95:2,  90:4,  85:6,  80:9,  75:11, 70:14, 65:18}
```

Because we observe sets as `(W, reps)` but the spline is in `p = W/OneRM`, and `OneRM` is the very thing we're solving for, fitting is **implicit**: find the `OneRM` that makes the user's observed `(W, reps)` points sit on the type spline. With the RIR correction (below) converting submax sets to reps-to-failure `r* = reps + RIR`, solve

```
OneRM  =  argmin_M  Σ_i  w_i · ( r*_i  −  s_type(W_i / M) )²
```

a 1-D robust fit (golden-section or Brent on `M`; the objective is smooth and unimodal in the working range because `s_type` is monotone). `w_i` downweights stale and high-RIR sets (§1d).

- **Pros:** literally the meta-analytic shape; the only moderator that matters (exercise type) is the seam the engine already has; one free parameter per lift (`OneRM`) so it's identifiable even with few points; no unit-sensitive term.
- **Cons:** the *between-individual* spread of reps-at-%1RM is real (Nuzzo quantifies it; this user may genuinely get more or fewer reps at 80% than the pooled curve). Pinning the *shape* to the population means the personal signal only moves the anchor `M`, not the curvature. For this user that's the right bias-variance trade given the data, but it is a modeling assumption, not a measurement.

### 1b. The weight-dependent arXiv equation

arXiv 2603.17495 (March 2026, preprint) fits, on 303,494 near-failure sets:

```
1RM  =  w · ( 1 + (r − 1)^0.85 / ( −2.55 + 4.58·ln(w) ) )
```

i.e. the Epley-style multiplier `1 + (r−1)^β / c` becomes **load-dependent** through `c(w) = −2.55 + 4.58·ln(w)`: heavier absolute loads get a *larger* denominator → a *smaller* per-rep correction → less overshoot at the heavy end. That is exactly the curvature direction we want, and it's a per-set closed form (drop-in next to `epley`).

- **Pros:** closed-form, no per-lift fit at all; claims 17–22% less inconsistency vs Epley/Brzycki/Lombardi/Mayhew/Wathan; the `(r−1)^0.85` exponent already softens the linear-in-reps Epley assumption.
- **Cons, and they are serious for *this* user:**
  1. **Fit on near-failure sets.** The constants `(0.85, −2.55, 4.58)` were estimated where `RIR ≈ 0`. This user trains 5–8 reps **with reps in reserve**. Feeding `r` = reps-performed (not reps-to-failure) into this equation underestimates 1RM, same failure mode as plain Epley — so it **must** be fed the RIR-corrected `r* = r + RIR` (§1d), and even then the constants are out-of-distribution for submax inputs.
  2. **`ln(w)` is unit-sensitive.** `w` is a raw load. The whole point of the engine's per-epoch normalization is that raw kg is not comparable across unit-epochs. `ln(machine_stack_setting)` and `ln(barbell_kg)` are not the same quantity, and the constants `−2.55/4.58` were fit on (presumably) barbell-ish kg. This is the crux of §2.
  3. **Non-peer-reviewed**, single preprint, one (large) dataset.

### 1c. Best classical formula per lift, chosen by backtest

Keep it dead simple: for each lift, A/B the five classical e1RM formulas (Epley, Brzycki, Lombardi, Mayhew, Wathan) on that lift's own held-out heavy sets and pick the winner per lift (or per exercise type, pooled). These formulas already differ in curvature — Brzycki diverges as reps→37, Lombardi is a pure power law, Wathan is exponential — so "pick the formula whose shape best predicts this lift's heavy sets" is a cheap, robust, fully unit-free way to get *some* curvature correction without fitting anything continuous.

- **Pros:** trivial to implement on top of the existing backtest; unit-free; no new dependencies; naturally regularized (you're choosing among 5 fixed shapes, not fitting a flexible curve).
- **Cons:** coarse (5 discrete shapes); none of them is the Nuzzo spline; doesn't pool curvature in the principled hierarchical sense; gives a 1RM but not a full `reps(W)` curve for the heavy end the way 1a does.

### Recommendation

**Primary: 1a (type-level Nuzzo spline as a fixed shape + per-lift anchor `M`), wired into roadmap #2's hierarchy.** It is the only candidate that (i) uses the meta-analytic shape, (ii) needs just one identifiable parameter per lift, (iii) is unit-free, and (iv) degrades to today's behavior cleanly (see fallback ladder). 

**Use 1b only as a per-set sanity rail and as one of the A/B contenders in validation — never as the primary engine of the 1RM**, because of the submax + unit-sensitivity problems. If §2's unit handling can be made airtight and the backtest (§3) shows 1b beating 1a on this user's held-out heavy sets, promote it; pre-register that as the decision rule rather than choosing now.

**Keep 1c as the floor:** the per-lift best-classical pick is the thing we fall back *to* (instead of raw Epley) when a lift can't support the spline anchor.

#### Fitting with few points per lift

The spline form needs only `M` per lift, but `M` itself is noisy when a lift has 3 points in a 3-rep band. Apply the same shrinkage philosophy already in `individualize.py` (`normal_normal_update`, `shrink_slope`, the grace machine):

- Compute a **raw anchor** `M_raw` from the 1-D fit above when the lift has load spread (reuse the `in_range` / `ssx` notion: require `max_x/min_x ≥ 1.15`, the threshold `calibration_protocol` already uses).
- Compute a **prior anchor** `M_prior` from the single heaviest reliable set via the type spline inverted at that one point: `M_prior = W_heavy / p_where(s_type = r*_heavy)`. This needs **no** load spread — it works for fixed-load isolations.
- Shrink: `M = normal_normal_update(M_prior, τ², M_raw, σ²_M, n_eff)` with `σ²_M` from the fit's residual scale and `n_eff` the count of reliable points. Early on (calibrating) the prior dominates, exactly like `shrink_slope`. The `grace` state/confidence reported by `grace(model)` carries over unchanged.

#### How curvature is pooled (tie to roadmap #2)

This is the load-bearing design decision, so state it precisely as a hierarchical model:

```
level 0 (global)        : weak prior on spline shape
level 1 (exercise type) : s_type(·)  — the CURVATURE lives here.  3 groups.
level 2 (exercise/lift) : M_e        — the ANCHOR lives here.     ~71 lifts.
level 3 (set)           : r*_i = s_type(W_i / M_e) + ε_i
```

- **Curvature = group-level (exercise-type) parameter.** It is *partially pooled across all same-type lifts* and toward the Nuzzo prior. No single lift (and certainly no fixed-load isolation) ever estimates its own curvature. With 3 groups and Nuzzo priors, the type splines are well-determined even though individual lifts aren't. This is precisely roadmap #2's partial-pooling structure: `s_type` is the `μ_group + ...` term; the per-lift `M_e` is the `θ_lift` random effect.
- **Anchor = lift-local parameter.** Each lift's `M_e` is shrunk toward the type-level expectation (what `M` *should* be given the lift's heaviest reliable set and the type curve) by exactly the amount its own data warrants — `n_eff` and `σ²_M` set the shrinkage weight via the existing `normal_normal_update`.
- **Practical consequence:** if roadmap #2 ships first, `s_type` is *its* group-level posterior and #4 just consumes it. If #4 ships first, `s_type` is the fixed Nuzzo table (priors.json) and #2 later upgrades it from a constant to a fitted group effect with **zero change to #4's interface** — the lift layer only ever calls `s_type(p)`. Build #4 against a `spline_for_type(type)` accessor so the swap is a one-line change.

#### How RIR sharpens the high-load end

The spline (and 1b) want **reps-to-failure**, but this user logs submax sets — except that RPE/RIR is ~100% of the **last 90 days** (forward-only). That recent window is exactly where current loads (and thus a current 1RM) live, so RIR is available precisely when it matters most.

Convert each set to a failure-anchor using the helpers already in the engine:

```
RIR_i = rir_from_rpe(rpe_i)                 # = max(0, 10 − rpe)
reliable = rir_reliable(reps_i, RIR_i)      # reps ≤ 12 and RIR ≤ 4  (priors.json)
r*_i = reps_i + RIR_i      if rpe present and reliable
     = reps_i             otherwise (legacy sets; treated as a *lower bound*, see below)
```

This is the **same correction `metrics.e1rm` already applies** (`cand = reps_clean + rir`, gated by `rir_reliable`) — we are reusing it, not inventing a parallel one. Two refinements for the curve fit:

- **Weight by reliability.** A set logged at RPE 9–10 (RIR 0–1) is a near-true point on the heavy end and should dominate the anchor fit: `w_i ∝ 1/(1+RIR_i)` × recency. High-RIR sets (RIR 3–4) inform the middle of the curve but barely constrain `M`.
- **Legacy (no-RPE) sets are one-sided.** A 2024 set of "8 reps" with unknown RIR means "≥ 8 reps were possible," i.e. true `p ≤ s_type⁻¹(8)`. Use it as a **one-sided constraint** (`M ≥ W / p_at(8)`) rather than an equality, or simply downweight it hard. This stops stale submax sets from dragging `M` down. (A full censored likelihood is overkill for one user; the one-sided floor captures 90% of the value.)

The net effect: the heavy end of `reps(W)` — the region the linear model overshoots — is anchored by the **RPE-logged recent near-max sets**, which is the best data the user has for it.

---

## 2. Unit-sensitivity handling (engine-specific, critical)

The engine indexes raw load per **unit-epoch** because `weight_raw` can switch units mid-history (machine stack numbers, lb↔kg, dumbbell pairs). `fresh_points` already pulls `weight_raw` *within a single `epoch`*. Two of our three forms interact with this differently:

- **1a (spline) is unit-safe by construction.** It only ever uses the **ratio** `p = W_i / M`, and both numerator and denominator are in the *same epoch's raw units*. A ratio of like-units is dimensionless, so the spline never sees a unit. **`M` is reported in the epoch's own raw units** — which is already exactly what `individual_1rm` returns today (raw `load_for_reps(model,1)`), so nothing downstream changes. This is the single biggest reason 1a is the recommendation. **Constraint: fit and apply `M` strictly within one epoch.** Never mix `(W_i)` across epochs in the same fit. (Cross-epoch *trend* of `M` is a separate, already-solved problem — that's the e1RM-slope shrinkage in `shrink_slope`.)

- **1b's `ln(w)` is unit-sensitive and must be handled explicitly.** `c(w) = −2.55 + 4.58·ln(w)` bakes in an absolute scale. Three options, in order of preference:

  1. **Restrict 1b to barbell-kg epochs only (recommended).** The arXiv constants were fit on a large multi-exercise corpus whose loads are overwhelmingly real external kg (barbell/dumbbell). For epochs we *know* are true-kg barbell lifts (tagged via the exercise's equipment, or detected because loads move in 1.25/2.5 increments and span a plausible barbell range), `ln(w)` is meaningful and 1b can run as-is. For machine-stack or "pin number" epochs, **do not apply 1b at all** — fall back to 1a/1c. This is honest: 1b is only valid where its training distribution holds.

  2. **Per-epoch recalibration of the constants.** Re-fit `(a, b)` in `c(w) = a + b·ln(w)` per unit system using that epoch's own reliable near-failure (RPE 9–10) sets, anchoring on the few near-true 1RM-ish points. With one user this is badly under-powered (you'd be fitting 2 constants to a handful of points), so treat it as a research branch, not a v1.

  3. **Normalize `w` to a reference and absorb the offset.** Substitute `w = p · M` and fold the epoch's unit scale into a single learned multiplier `k_epoch` so that `ln(w) = ln(k_epoch) + ln(p·M_ref)`. This collapses to "recalibrate `a` per epoch" (`a' = a + b·ln k_epoch`) — same under-powering as (2). Mathematically clean, practically not worth it for one user.

  **Decision:** ship 1b (if at all) under option (1) — barbell-kg epochs only, gated by equipment/unit detection — and treat the machine/isolation universe as 1a/1c territory. Document loudly in code that 1b's denominator is unit-bound.

**One concrete guard for both:** add an `epoch_unit_kind ∈ {real_kg, stack, unknown}` classifier (heuristic: increment granularity + range + equipment string). 1a runs everywhere; 1b runs only where `epoch_unit_kind == real_kg`.

---

## 3. Validation — add a "1RM-extrapolation error" track

The walk-forward backtest currently reports **rep-MAE** (predict reps at a load) and **forecast-MAE** (predict next session). Add a third track that scores the *heavy-end extrapolation* directly, because that's the only thing #4 changes.

### The validation problem

The user **almost never tests a true 1RM**, so we cannot score `predicted_1RM − actual_1RM` directly. Use a **held-out-heavy-set proxy** instead.

### Metric (pre-registered)

Walk-forward, per lift, with an **embargo** (same discipline as item #1: never let the test set leak into the fit window):

1. At each evaluation time `t`, fit the model (linear baseline *and* candidate) on data strictly before `t` minus an embargo gap (a few days, so a set and its "future" prediction aren't from the same session).
2. From the **future** window, select the **heaviest reliable set** `(W_test, reps_test, rpe_test)` whose load is **above the fit window's `max_x`** (a genuine extrapolation target — this is the regime that exposes overshoot). Require RPE present so `r*_test = reps_test + RIR_test` is a real reps-to-failure number.
3. Score, in **rep space at that heavy load** (unit-free, always available):

```
err_model = | r*_test  −  reps_pred(model, W_test) |
```

where `reps_pred` for the **linear baseline** is `predict_reps(model, W_test)` and for the **spline candidate** is `s_type(W_test / M)`. Aggregate `MAE_heavy = mean(err_model)` over all (lift, t) with a valid heavy target.

Secondary metric, **e1RM space** (closer to the user-facing number): convert the held-out heavy set to `e1rm(W_test, r*_test)` (a near-max set → Epley is reliable there, that's its valid range) and compare to each model's predicted 1RM:

```
err_1rm = | e1rm(W_test, r*_test)  −  predicted_1RM(model) |   (normalized %, per epoch units)
```

Report as **% of the heaviest trained load** so it's comparable across lifts/epochs.

### Baseline

The **current linear extrapolation**: `predict_reps` for rep-space, and `individual_1rm()` (with its `1.4×` clamp and `r2≥0.4` gate, falling back to per-set `e1rm` when suppressed) for the 1RM-space number. This is the incumbent; the candidate must beat it on its own terms.

### Pre-registered success bar

Decided **before** running, to avoid fishing:

- **Primary:** spline candidate reduces `MAE_heavy` (rep space, on above-`max_x` targets) by **≥ 15% relative** vs the linear baseline, aggregated over all lifts with ≥ 5 valid heavy targets. (15% mirrors the lower edge of 1b's own 17–22% claim and is a meaningful but not heroic bar for a shape correction.)
- **Guardrail (no regression in the easy region):** within-range rep-MAE (loads inside the trained band, the existing track) must **not worsen by more than 2%** — the curve must not buy heavy-end accuracy by distorting the middle where the line was already fine.
- **1RM-space sanity:** median `err_1rm` not worse than baseline; we expect *direction* of improvement (less overshoot) more confidently than magnitude, given how rarely true maxes exist.
- **Per-form bake-off:** run 1a, 1b (barbell-kg epochs only), and 1c (best-classical) through the *same* harness; promote 1b over 1a **only if** it wins `MAE_heavy` by the same ≥15% bar *and* its unit handling (§2 option 1) covers the epoch. Otherwise 1a ships and 1c is the floor.

If the primary bar isn't met, **do not ship the curve** — keep linear + the `1.4×` clamp. An honest null result is a valid outcome here.

---

## 4. Pseudocode (numpy-flavored)

Recommended approach (1a) end to end. References the real engine functions.

```python
import numpy as np
from scipy.interpolate import CubicSpline          # natural BC -> linear tails
from scipy.optimize import minimize_scalar

# ---- type-level shape: built once from priors.json reps_at_pct1rm ----------
def spline_for_type(ex_type):
    """reps-to-failure as a function of p = W/1RM, per exercise type.
    ex_type in {'default','lower_compound','upper_press'}.
    ROADMAP #2 SEAM: today this reads the fixed Nuzzo table; later it returns
    #2's fitted group-level posterior. Callers only ever see s(p)."""
    tbl = config.priors()["reps_at_pct1rm"][ex_type]        # {pct(str): reps}
    pcts = np.array(sorted(int(k) for k in tbl)) / 100.0    # 0.65 .. 1.00
    reps = np.array([tbl[str(int(p*100))] for p in pcts])
    # spline in p with reps DECREASING in p; natural BC => linear extrapolation
    order = np.argsort(pcts)
    s = CubicSpline(pcts[order], reps[order], bc_type="natural", extrapolate=True)
    return s   # s(p) -> reps_to_failure ; monotone-decreasing over [0.65,1.0]

def s_inv(s, target_reps, p_lo=0.30, p_hi=1.05):
    """invert spline: find p such that s(p) = target_reps (monotone -> unique)."""
    # s is decreasing; bisection on p
    lo, hi = p_lo, p_hi
    for _ in range(40):
        mid = 0.5*(lo+hi)
        if s(mid) > target_reps: lo = mid     # too many reps -> need higher p
        else:                    hi = mid
    return 0.5*(lo+hi)

# ---- per-set failure anchor (REUSES metrics/individualize RIR logic) -------
def failure_reps(reps, rpe):
    """r* = reps + RIR when a reliable RPE exists, else reps (one-sided).
    Mirrors metrics.e1rm's cand = reps + rir, rir_reliable gate."""
    if rpe is None:
        return reps, False                     # legacy: treat as lower bound
    rir = individualize.rir_from_rpe(rpe)      # max(0, 10-rpe)
    if rir is not None and individualize.rir_reliable(reps, rir):
        return reps + rir, True
    return reps, False

# ---- per-lift anchor M (the only free parameter) --------------------------
def fit_anchor(points, ex_type):
    """points: list of (W_raw, reps, rpe) within ONE epoch (from fresh_points,
    extended to carry rpe). Returns M in the epoch's RAW units, plus diagnostics.
    UNIT-SAFE: only ratios W/M enter the spline (see spec section 2)."""
    s = spline_for_type(ex_type)
    rows = []
    for (W, reps, rpe) in points:
        if W is None or reps is None or W <= 0: continue
        rstar, reliable = failure_reps(reps, rpe)
        recency_w = ...                        # same recency weighting as fresh_points window
        w = recency_w * (1.0/(1.0+max(0.0, rstar-reps)))   # downweight high-RIR
        if not reliable: w *= 0.25             # legacy/no-RPE: weak, ~one-sided
        rows.append((W, rstar, w, reliable))
    if not rows:
        return None
    W   = np.array([r[0] for r in rows])
    rst = np.array([r[1] for r in rows])
    wt  = np.array([r[2] for r in rows])

    spread = W.max()/W.min()
    # ---- prior anchor: from the single heaviest reliable set (NO spread needed)
    heavy = max(rows, key=lambda r: r[0] if r[3] else -1)   # heaviest reliable
    if heavy[3]:
        p_heavy = s_inv(s, heavy[1])                        # p where s = r*_heavy
        M_prior = heavy[0] / max(p_heavy, 1e-6)
    else:
        M_prior = W.max() / 0.90                            # crude: assume heaviest ~ 90%

    # ---- raw anchor: 1-D robust fit of M to all points (needs load spread) ---
    if spread >= 1.15:                                      # same gate as calibration_protocol
        def loss(M):
            if M <= W.max(): return 1e9                     # 1RM must exceed top load
            pred = s(np.clip(W/M, 0.30, 1.05))
            return float(np.sum(wt * (rst - pred)**2))
        res = minimize_scalar(loss, bounds=(W.max()*1.001, W.max()*2.5),
                              method="bounded")
        M_raw = res.x
        # residual scale -> variance of M (cheap delta-method-ish proxy)
        sigma2_M = (loss(M_raw) / max(1, wt.sum())) * (M_raw / max(1.0, W.ptp()))**2
        n_eff = float(wt.sum())
    else:
        M_raw, sigma2_M, n_eff = M_prior, np.inf, 0.0       # no spread -> lean on prior

    # ---- shrink raw toward prior (REUSE existing normal_normal_update) -------
    tau2 = (0.15 * M_prior)**2                              # prior sd ~15% of anchor
    M, _ = individualize.normal_normal_update(
                prior_mean=M_prior, prior_var=tau2,
                obs_mean=M_raw,     obs_var=(sigma2_M if np.isfinite(sigma2_M) else tau2*1e6),
                n=max(1, int(round(n_eff))))
    return {"M": float(M), "ex_type": ex_type, "n_eff": n_eff,
            "spread": float(spread), "max_x": float(W.max())}

# ---- public surface mirroring individualize.* -----------------------------
def reps_at_load_spline(anchor, W):
    """curvilinear replacement for predict_reps point estimate (reps-to-failure)."""
    s = spline_for_type(anchor["ex_type"])
    return float(s(np.clip(W / anchor["M"], 0.30, 1.05)))

def load_for_reps_spline(anchor, target_reps):
    """curvilinear replacement for individualize.load_for_reps."""
    s = spline_for_type(anchor["ex_type"])
    return float(anchor["M"] * s_inv(s, target_reps))

def individual_1rm_spline(anchor):
    """curvilinear replacement for individual_1rm. By construction s(1.0)=1 rep,
    so the 1RM is just the anchor M -- NO linear overshoot, NO 1.4x clamp needed.
    Still gate on having a real anchor."""
    if anchor is None or anchor["n_eff"] < 1 and anchor["spread"] < 1.15:
        return None
    return round(anchor["M"], 1)
```

Notes on the pseudocode:
- `individual_1rm_spline` returns `M` directly because the type spline is defined so `s(1.0) = 1` rep. The convexity that the line lacked is entirely inside `s`, so there is **nothing to overshoot** and the `max_x * 1.4` clamp is **retired** — replaced by the honest gate "do we have an anchor at all."
- Everything is in **raw epoch units** end to end (only `W/M` ratios touch the spline), so the persisted number drops into the existing `exercise_models.individ_1rm` column with no unit conversion.
- `fresh_points` must be extended to also return `rpe` (currently returns `(load, reps)` only). That's the one upstream change required for the fit.

---

## 5. Integration points + honest expectations

### `workout/individualize.py`

- **`fresh_points`** → also select `rpe` so the fit can build failure anchors. (Today: `weight_raw w, reps_clean r`; add `rpe`.) Keep the recency window logic as-is.
- **New `fit_anchor` / `spline_for_type`** alongside `fit_load_rep`. Do **not** delete `ols`/`fit_load_rep`: the linear model stays as (a) the validation baseline and (b) the fallback when a lift can't support an anchor.
- **`individual_1rm`** → becomes a thin dispatcher: try `individual_1rm_spline(anchor)`; if `None`, fall back to today's linear `individual_1rm`, which itself already falls back to per-set `e1rm`. **Fallback ladder:** spline anchor → linear (gated, `1.4×`) → per-set Epley. Each rung is strictly safer/less individualized than the one above.
- **`predict_reps` / `load_for_reps`** → add spline variants; route to them when an anchor exists, else keep linear. Preserve the prediction-interval behavior by carrying `resid_std` from the fit (the spline fit's weighted residual gives the band).
- **`analyze_exercise` / `refresh_models`** → persist `M`, `ex_type`, `n_eff`, `spread` next to (not instead of) the linear `slope/intercept/r2`. The `exercise_models` table gains columns (or a small `anchor_json` blob); `grace`/`confidence` reporting is unchanged.
- **Exercise→type mapping.** Need a `default/lower_compound/upper_press` label per exercise. `priors.json` already implies the taxonomy; add a lookup (equipment/name heuristic, or a small static map for the ~71 lifts). This same map is what roadmap #2 will group on.

### `workout/metrics.py`

- **`e1rm`** is largely untouched — it stays the per-set Epley estimate and the **bottom of the fallback ladder**. Optional: expose the arXiv 1b formula as `e1rm_weightdep(weight, reps, rpe)` guarded by `epoch_unit_kind == real_kg`, available to the validation bake-off and as an alternate per-set rail. Do **not** make it the default e1RM until §3 promotes it.
- Keep the **rep-cap ≤ 10** logic for `e1rm`: near-max sets are where Epley is valid, and that's exactly the held-out-heavy proxy the validation relies on.

### `config/priors.json`

- No schema change required for v1: `reps_at_pct1rm` (already type-split) is the spline knot source. If roadmap #2 later fits the splines, it overwrites these tables with posterior knot values and #4 keeps consuming them through `spline_for_type`.
- Optionally add the arXiv constants `{ "weightdep_1rm": {"beta":0.85,"a":-2.55,"b":4.58} }` and an `epoch_unit_kind` config block if 1b graduates from the bake-off.

### Honest expectation / ceiling

- **What improves, and only this:** the **heavy-end** of `reps(W)` and the `individual_1rm` number for the **~25 lifts with real load spread**. That's where the line overshoots and where this spec earns its keep. For those lifts, expect the convex shape to pull the predicted 1RM **down** toward reality and to make the `1.4×` clamp unnecessary.
- **What does NOT improve:** the **~46 near-fixed-load lifts** gain essentially nothing — with one load there is no extrapolation to fix; their 1RM still comes from the heaviest-set prior anchor `M_prior`, i.e. "Epley-on-the-top-set wearing a type-curve hat." Don't claim per-lift individualization where the data can't support it.
- **The shape is borrowed, not measured.** We pin curvature to Nuzzo's population/type curve because this user's data can't identify it. If this user genuinely deviates from the pooled reps-at-%1RM (Nuzzo's between-individual SD says some people do), we will **not** catch it — the anchor moves, the curve's bend doesn't. This is the deliberate bias-variance choice; it is also the ceiling. Roadmap #2 raises that ceiling slightly by letting the *type* curve flex toward this user's pooled same-type data, but never to a per-lift curve.
- **RIR coverage is the real bottleneck.** The heavy end is only as good as the RPE-logged near-max sets. RIR is ~100% of the last 90 days, so *current* 1RMs are well-anchored, but any lift not pushed near failure recently inherits the type curve with a weak anchor. The single highest-leverage user behavior (which `calibration_protocol` should now recommend) is: **log RPE on the top set, and occasionally take one set to RIR 0–1**, on the lifts you care about a 1RM for.
- **Preprint risk (1b).** If we ever promote the arXiv equation, we inherit a non-peer-reviewed, single-dataset, near-failure-fit, unit-sensitive formula. The bake-off gate (§3) and the barbell-kg-only restriction (§2) are the guardrails; absent both, stay on 1a.
- **Net:** a real, bounded win on heavy-end overshoot for a quarter of the lifts, no regression elsewhere (enforced by the §3 guardrail), and an interface that roadmap #2 slots into without rework. Modest, honest, and the right shape.
