# Design spec: Hierarchical partial pooling for the load→reps model (#2)

**Status:** IMPLEMENTED, validated, ADOPTED. `individualize.py`
(`ex_type`, `group_slopes`, `shrink_load_rep_slope`, `pooled_slope_for`, pooled
`predict_reps_anchored`/`analyze_exercise`), wired through `autoregulation.py` +
`summary.py`, `config/priors.json` → `rep_pooling`, validated by
`backtest.pooled_rep_prediction`, tests in `tests/test_pooling.py` (23).
Targets roadmap item #2.
**Goal:** rescue the ~42 "calibrating" lifts by letting data-starved exercises
borrow the load→reps slope from data-rich exercises of the same type, with
calibrated (shrunken) uncertainty.

**Real-data result (`coach.py backtest`):** walk-forward, split to mirror live
behavior — STARVED bucket (lifts pooled live) **MAE 0.496 → 0.283 (−43%)**, coverage
0.943 → 0.947; RICH bucket unchanged by construction (never pooled live). Clears the
pre-registered bar (starved n≥12 ∧ MAE drops ∧ rich not worse) → **ADOPT**. Live: of
77 lifts, **47 now borrow** a type slope + 22 shrunk, 8 keep a personal fit. Estimated
type slopes order as physics predicts: lower_compound −0.13/kg (heavy) < upper_press
−0.18 < default −0.22/kg (light isolation). Caveat realized: 21 lifts are unmapped in
`exercises.json` (German names etc.) and fall to the `default` curve — map audit spun
off as a follow-up task (see §7).

---

## 0. What we're fixing

- `individualize.fit_load_rep` is plain per-exercise OLS and returns `None` when
  load doesn't vary. From the DB: **15 lifts have ≤3 distinct loads, 30 have <5
  points** → no slope → stuck "calibrating" → predictions silently fall back to
  slope = 0 (naive "same reps as last time").
- The current `shrink_slope` only shrinks the weekly **e1RM gain rate**; the
  **load→reps slope** is raw, unpooled. So pooling the slope is genuinely new.
- Nuzzo 2024: **exercise TYPE is the only meaningful moderator** of the
  reps-vs-load relationship → same-type lifts share a slope. That's the grouping.
  Your `priors.json` already splits `default / lower_compound / upper_press`.

---

## 1. The model — two-level hierarchy (exercise ⊂ exercise-type)

For exercise `e` in type `g`, the reps-per-kg slope:

```
β̂_e | β_e ~ N(β_e, se_e²)        # OLS sampling; se_e = resid_std_e / sqrt(ssx_e)
β_e      ~ N(μ_g, τ_g²)          # exercise-type level
```

Both `resid_std` and `ssx` are ALREADY computed in your `ols()`, so `se_e` is free.
Data-rich lifts (T-Bar Row: 80 pts, 2.46× load range) estimate `μ_g`; starved lifts
shrink toward it.

**Pool the SLOPE only — keep the INTERCEPT/anchor local.** The user's rep level at
their working weight is real, well-identified data; only the load→reps *tradeoff* is
unidentifiable. This is the key nuance: don't let pooling distort what you actually
measured, only fill in what you couldn't.

---

## 2. Empirical-Bayes math (closed form, numpy — keeps the low-dep ethos)

Per type `g` with `k` well-identified exercises:

```
w_e = 1/se_e²                              # precision weights
μ_w = Σ w_e β̂_e / Σ w_e                    # precision-weighted mean slope
Q   = Σ w_e (β̂_e − μ_w)²                   # heterogeneity
τ_g²= max(0, (Q − (k−1)) / (Σ w_e − Σ w_e²/Σ w_e))   # DerSimonian–Laird estimator
μ_g = μ_w
```

Posterior (shrunken) slope for each exercise:

```
B_e   = se_e² / (se_e² + τ_g²)             # shrinkage weight ∈ [0,1]
β*_e  = (1 − B_e)·β̂_e + B_e·μ_g
Var*  = 1 / (1/se_e² + 1/τ_g²)             # tighter, calibrated → feeds CQR (#6)
```

**Starved lift** (`ssx → 0 ⇒ se_e → ∞ ⇒ B_e → 1`): `β*_e = μ_g` — full borrow.
Exactly the rescue. This is your `normal_normal_update` generalized from one GLOBAL
level to a PER-GROUP level, with `μ_g, τ_g²` ESTIMATED from the data-rich lifts
rather than hand-set priors.

---

## 3. Three-level option / statsmodels

- **3-level** (exercise ⊂ type ⊂ global): a sparse *type* (e.g. calves, 1 lift)
  borrows from the global slope. Same algebra, applied twice.
- **statsmodels:** `MixedLM(reps ~ load, groups=type, re_formula="~load")` =
  random load-slopes by type, REML variance. ~20 lines. Use as the principled
  upgrade; ship the closed-form EB first (transparent, matches your code style).

---

## 4. Integration (individualize.py) — DONE

- ✅ `group_slopes(conn) → {type: {μ_g, τ_g², resid_std, k}, "__global__": …}` from all
  well-identified lifts (DerSimonian–Laird τ², precision-weighted μ). The `__global__`
  entry is the 3-level fallback for sparse types.
- ✅ `shrink_load_rep_slope(β̂, se, μ_g, τ²) → (β*, Var*)` + `pooled_slope_for(ex, model,
  groups)` which resolves the slope to use and a `basis` (personal / shrunk / borrowed).
- ✅ `predict_reps_anchored(..., pooled=(slope, resid_std))`: a starved/weak lift feeds
  `β*` (= μ_g when fully borrowed) instead of slope 0. Strong lifts are left untouched
  (`apply=False`, byte-identical) so the rich bucket can't regress. Wired live through
  `autoregulation.prediction_for`/`next_target` + `summary.py` (group slopes computed once).
- ✅ confidence: borrowed predictions report a modest `borrowed_confidence`
  (base + per-backing-lift, capped) and basis text "borrowed <type> curve"; grace state
  stays the honest personal one.

---

## 5. Validation — DONE (adopted)

- ✅ `backtest.pooled_rep_prediction`: walk-forward MAE + ~95% interval coverage, naive vs
  pooled, **bucketed by LIVE behavior** (a lift is "starved" iff its current full-data fit
  isn't personal-strong → gets pooled live; "rich" lifts are never pooled live, so their
  pooled == naive — a built-in sanity check).
- ✅ Result: STARVED MAE 0.496 → 0.283, RICH unchanged → pre-registered bar cleared → ADOPT.
- Note: bucketing by *full-data* live behavior (not by walk-forward prefix) was the fix —
  bucketing by prefix wrongly pooled rich lifts' early thin prefixes and made rich look
  worse, which never happens live.

---

## 6. Pseudocode

```python
from collections import defaultdict
from math import sqrt, isfinite

def group_slopes(conn):
    by_type = defaultdict(list)
    for ex in exercises(conn):
        fit = fit_load_rep(fresh_points(conn, ex, cur_epoch(conn, ex)))
        if fit and fit["ssx"] > 0:
            se = fit["resid_std"] / sqrt(fit["ssx"])      # SE of the OLS slope
            if isfinite(se) and se > 0:
                by_type[ex_type(ex)].append((fit["slope"], se))
    out = {}
    for g, arr in by_type.items():
        b  = [s for s, _ in arr]; se = [e for _, e in arr]
        w  = [1/e**2 for e in se]; W = sum(w)
        mu = sum(wi*bi for wi, bi in zip(w, b)) / W
        if len(arr) > 1:
            Q    = sum(wi*(bi-mu)**2 for wi, bi in zip(w, b))
            tau2 = max(0.0, (Q-(len(arr)-1)) / (W - sum(wi**2 for wi in w)/W))
        else:
            tau2 = 0.0
        out[g] = (mu, tau2)
    return out

def shrink_load_rep_slope(beta_hat, se, mu_g, tau2):
    if beta_hat is None or se is None or not isfinite(se):   # starved → full borrow
        return mu_g, tau2
    denom = se**2 + tau2
    B = se**2 / denom if denom > 0 else 1.0
    return (1-B)*beta_hat + B*mu_g, 1.0/(1.0/se**2 + 1.0/tau2)
```

---

## 7. Honest expectation

Rescues most of the 42 "calibrating" lifts **with calibrated intervals** — the single
highest-leverage REP change. It will NOT help a lift that has neither load variation
NOR a populated exercise-type (e.g. a lone machine in a tiny group) — those stay
naive/landmark, correctly flagged. Pooling assumes same-type lifts share a slope, so
the **`exercises.json` exercise→type map quality now matters more** — a mislabeled
lift borrows the wrong curve. Worth a one-time audit of that map before shipping.

**Borne out in practice:** 21 of 77 logged lifts are unmapped (German export names like
"Bankdrücken", plus "Deadlift", "Pendulum Squat") and currently fall to the `default`
curve — several presses/squats borrow a too-steep slope as a result. Still net-positive
(the validated −43% starved MAE *includes* these), but fixing the map is the obvious next
gain. **Spun off as a follow-up task** (config/exercises.json data audit; no logic change).
