# Roadmap #5 — Fold RIR into the rep / 1RM model (not just e1RM)

**Status:** ✅ IMPLEMENTED + gated OFF by an honest data-scarcity null (2026-06-29).
Built the predict-at-effort path (capacity `r* = reps + reliable RIR`, projected
along #2's slope, minus `target_RIR`), the walk-forward validator, and the full
wiring; `priors.rir_rep_model.enabled = false` because the validator's RECENT
(RIR-anchored) bucket has **n = 0 windows yet** — RPE is forward-only and the
first RPE session (2026-06-27) has no *subsequent* logged session to score
against, so the pre-registered bar (`recent n ≥ 8`) cannot be met. The LEGACY
bucket confirms byte-identity (MAE 0.396 → 0.396 exactly). Auto-activates by
rerun once enough RPE-anchored sessions accumulate. See implementation notes at
the end of this file. The original design spec (math + pseudocode) follows.
**Integration targets:** `workout/individualize.py` (`fresh_points`, `fit_load_rep`,
`predict_reps`, `predict_reps_anchored`, `analyze_exercise`), `workout/autoregulation.py`
(`prediction_for`, `weight_verdict`, `next_target`), `config/priors.json`
(`rpe_to_rir`, `rir_reliable_*`, `goal_rep_range`, `progression_min_rir`).
**Companions:** this is the **shared capacity curve** that #2 (pools its slope), #4
(anchors it), and #6 (puts a calibrated interval on it) all want — build it once. Shares
the `fresh_points` "also return rpe" upstream change with #4.

---

## 0. What we're fixing

RIR (reps-in-reserve, from RPE) is used **everywhere except the rep model itself**:
`metrics.e1rm` applies Epley to `reps + RIR`; `autoregulation` gates load increases on
RIR; `volume._rpe_by_muscle` reads RIR for the fatigue score. But
`individualize.fit_load_rep` fits reps-vs-load on **raw reps performed**, blind to how
close to failure each set was.

That conflation is the bug. Two sets — *8 reps @ 100 kg @ RPE 7 (RIR 3)* and *8 reps @
100 kg @ RPE 10 (RIR 0)* — are wildly different points on the true load→reps curve, but
the current OLS treats them as the **same point** (8 reps at 100 kg). Since this user
trains **5–8 reps with reps in reserve**, almost every set is submaximal, so the fitted
curve is "where I chose to stop," not "what I could do." That biases the slope, the
predicted reps, and the 1RM extrapolation — and it makes the predicted-reps number shown
in the report systematically **wrong in a knowable direction** (it predicts stopping
behavior, not capacity, yet is compared against capacity-ish targets).

---

## 1. The model

### 1a. Response = reps-to-failure (the capacity curve)

Fit the load→reps model on **reps-to-failure** `r* = reps + RIR` (when RIR is reliable)
instead of raw performed reps. Reuse the engine's existing helpers verbatim — no parallel
logic:

```
RIR  = rir_from_rpe(rpe)            # = max(0, 10 − rpe)
r*   = reps + RIR   if rpe present AND rir_reliable(reps, RIR)   # reps≤12 and RIR≤4
     = reps         otherwise        # ← censored: see 1b
```

Now the curve `capacity(W)` is the **maximum** reps achievable at load `W` — the
physiologically meaningful quantity, and exactly what #4's 1RM anchor and #2's pooled
slope should be fit on. (`metrics.e1rm` already does this per-set with `cand = reps +
rir`; #5 just lifts that idea from a per-set point estimate to the fitted curve.)

### 1b. Legacy sets are censored, not missing

A pre-RPE set logged as "8 reps" with unknown RIR means **capacity ≥ 8** — a
right-censored observation, not `capacity = 8`. With RPE at **0.5% lifetime but ~100% the
last 90 days**, the history is mostly censored and the present is mostly exact.

- **Principled:** a censored-likelihood (Tobit-style) fit — exact points contribute
  `(r*_i − ŷ_i)²`; censored points contribute the one-sided penalty only when the model
  predicts **below** the observed floor (`max(0, reps_i − ŷ_i)²`). This stops stale
  submaximal sets from dragging the capacity curve down while still using them as lower
  bounds.
- **Pragmatic v1 (recommended):** for lifts with enough reliable-RIR points (the recent
  window), fit `capacity(W)` on those; for legacy-only lifts, fall back to today's
  `reps`-as-response behavior (which is the current engine — **graceful degradation, byte-
  identical when no RIR exists**). As RIR coverage accumulates, the capacity curve takes
  over per lift. Mirror the existing grace machine (`calibrating → learning → confident`).

### 1c. RIR is noisy — weight by reliability, propagate the variance

Self-reported RIR carries error (~±1 RIR, worse far from failure; Zourdos 2016 / Helms
2016 show accuracy is best within ~1–3 reps of failure). Two consequences:

```
weight(set)        ∝  recency / (1 + 0.5·RIR)     # near-failure RIR trusted most;
                       × 0.3 if censored            # far-from-failure & legacy downweighted
obs_variance(r*)   =  resid_var + Var(RIR)         # ≈ resid_var + 1   (sd_RIR ≈ 1)
```

The inflated `obs_variance` is exactly the nonconformity input #6 needs to keep intervals
honest about RIR noise.

### 1d. Predict at the user's *effort*, not at failure (the semantics fix)

This is arguably the biggest *practical* win. Today `predict_reps_anchored` predicts
performed reps directly. With a capacity curve, predict **performed reps at the intended
effort**:

```
predicted_reps(W)  =  capacity(W)  −  target_RIR
target_RIR         =  the user's typical training RIR
                      (default progression_min_rir ≈ 2, or their historical median RIR at similar load)
```

Because the user trains at a fairly consistent RIR, `capacity(W) − target_RIR` will
**match what they actually log**, instead of predicting failure reps they never perform.
And `weight_verdict` ("is this weight good for my 5–8 range?") becomes the clean test
`lo ≤ capacity(W) − target_RIR ≤ hi` — a question about *capacity at intended effort*,
which is what the user actually means.

### 1e. One curve, three consumers

`capacity(W)` fit on `r*` is the single object that #2 partially-pools the slope of, #4
anchors (its `s(1)=1` 1RM), and #6 wraps in a conformal interval. **Build a single
`fit_capacity_curve()` and have #2/#4/#5/#6 share it** — do not fit three near-duplicate
models. Recommend this spec ships *with or just after* #4, since they share the
`fresh_points`-returns-`rpe` change and the same fit.

---

## 2. Cold-start / coverage strategy

`reps_at_pct1rm` in `priors.json` is already a **capacity prior** (reps to failure at each
%1RM, per exercise type). So the grace blend is natural: until a lift has enough reliable-
RIR points, lean on the prior capacity curve (shifted to the lift's anchor); as RIR
accumulates, shrink toward the personal capacity curve — the same `normal_normal_update`
shrinkage already in the codebase, just applied to the capacity response. `calibrate`
should now also nudge: *"log RPE on your top set, and occasionally take one set to RIR
0–1,"* because that is what turns censored points into exact capacity anchors.

---

## 3. Validation

The target must be **apples-to-apples**: the user logs *performed* reps, so score
performed-rep prediction.

- **Primary (walk-forward, embargoed):** predict performed reps as `capacity(W) −
  predicted_RIR` and compare MAE to the current raw-reps `predict_reps_anchored`. Split by
  era: **RIR-covered recent window** vs **legacy window**.
- **Secondary:** on the RIR-covered window, report **capacity-prediction error** directly
  (predict `r*`, compare to observed `r*`).
- **Effort-offset calibration:** mean predicted RIR ≈ mean actual RIR (the offset must be
  unbiased, else predictions are shifted).
- **Pre-registered bar:** the capacity-aware predictor reduces performed-rep MAE on the
  recent window vs the raw-reps baseline, **without worsening** legacy-window MAE (where
  they should be ~identical by construction). Honest null allowed — on legacy-only lifts
  the two are the same model.

---

## 4. Pseudocode

```python
def r_star(reps, rpe):
    """Reps-to-failure. Returns (value, kind): 'exact' if reliable RIR, else 'censored'
    (capacity >= reps). Reuses individualize.rir_from_rpe / rir_reliable."""
    if rpe is None:
        return reps, "censored"
    rir = rir_from_rpe(rpe)                       # max(0, 10 - rpe)
    if rir is not None and rir_reliable(reps, rir):   # reps<=12 and rir<=4
        return reps + rir, "exact"
    return reps, "censored"                       # unreliable RIR -> lower bound only

def rir_weight(reps, rpe, recency):
    _, kind = r_star(reps, rpe)
    if kind == "censored":
        return 0.3 * recency
    rir = rir_from_rpe(rpe) or 0.0
    return recency / (1.0 + 0.5 * rir)            # closer to failure -> more trust

def fit_capacity_curve(points):
    """points: [(load, reps, rpe, recency)] in ONE epoch (fresh_points + rpe).
    Fits capacity(W) on r*; censored points act as one-sided lower bounds.
    Shared by #2 (pool slope), #4 (anchor), #6 (interval)."""
    rows = [(W, *r_star(reps, rpe), rir_weight(reps, rpe, rec))
            for (W, reps, rpe, rec) in points if W and reps]
    # exact rows -> weighted least squares on r*; censored rows -> penalize only if
    # prediction < observed floor (pragmatic Tobit). Fall back to today's fit_load_rep
    # when there are no exact rows (byte-identical legacy behavior).
    return weighted_censored_fit(rows)            # -> {slope, intercept/anchor, resid_std, n_exact}

def predict_reps_at_effort(model, last_load, last_reps, last_rpe, target_load,
                           target_rir=None):
    last_cap, _ = r_star(last_reps, last_rpe)                      # anchor on capacity
    cap = predict_capacity_anchored(model, last_load, last_cap, target_load)
    if target_rir is None:
        target_rir = user_median_rir() or settings()["progression_min_rir"]   # ~2
    pt = max(0.0, cap - target_rir)
    se = sqrt(model["resid_std"]**2 + 1.0)                          # + RIR noise (1d) -> #6
    return pt, pt - 1.96*se, pt + 1.96*se                          # band -> conformal in #6
```

---

## 5. Integration points

- **`individualize.py`:** `fresh_points` must also return `rpe` (the same upstream change
  #4 needs — do it once). Add `fit_capacity_curve` (or extend `fit_load_rep` to take a
  response selector + weights). `predict_reps_anchored` → `predict_reps_at_effort`
  (capacity then minus effort); keep the old path for legacy-only lifts.
- **`autoregulation.py`:** `prediction_for` / `weight_verdict` / `next_target` consume the
  effort-aware prediction, so the `predicted_reps` shown beside each target finally means
  "reps you'll hit at your normal effort." Note: `weight_verdict`'s good/too-light/too-
  heavy logic now compares `capacity(W) − target_RIR` to `goal_rep_range`.
- **`config/priors.json`:** add `target_rir_default` (≈ `progression_min_rir`); the
  `reps_at_pct1rm` tables serve as the capacity prior. No e1RM change — `metrics.e1rm`
  already aligns with the capacity view.

---

## 6. Honest expectations / ceiling

- **The win grows with RIR coverage.** On legacy-only lifts the capacity model *is*
  today's model (RIR = 0), so the improvement is concentrated in the RIR era (the last 90
  days and forward) — exactly where current 1RMs and decisions live. Don't claim a
  retroactive win.
- **The semantics fix (1d) is the underrated part.** Even setting aside slope accuracy,
  predicting at intended effort instead of at failure should make predicted reps visibly
  match logged reps — a credibility win for the whole report.
- **RIR self-report noise caps the gain.** Garbage RPE in → garbage capacity out; the
  reliability weighting and variance inflation (1c) bound the damage, but a user who logs
  RPE carelessly gets little benefit. `calibrate` should coach honest top-set RPE.
- **Not a free 1RM.** This sharpens the heavy-end anchor that #4 extrapolates, but it does
  not replace occasionally training near failure — the single highest-value behavior for a
  trustworthy 1RM remains "take one set to RIR 0–1 now and then" on the lifts you care
  about.

---

## 7. Implementation notes (2026-06-29)

Shipped as the **pragmatic v1** (§1b / §4): keep #2's already-validated load→reps
slope and move the RIR transform into the **anchor** and the **effort offset**, rather
than re-fitting the slope on `r*` (capacity- and performed-slope coincide under roughly
constant training effort; re-fitting would re-open #2's adoption on data that can't
identify the difference). One curve is shared at the helper level — `failure_reps`
(the `r*` from §4) is reused verbatim, so #4/#5 already fit on the same response.

- **`individualize.py`** — `_rir_rep_cfg()`; `median_target_rir(points, default)` (pure,
  shared by live + validator); `target_rir(conn, ex, epoch)` = median reliable top-set
  RIR or `settings.progression_min_rir`; `predict_reps_at_effort(model, last_load,
  last_reps, last_rpe, target_load, target_rir, pooled, rir_var)` → `(pt, lo, hi,
  at_effort)`. It anchors on `failure_reps(last_reps, last_rpe)`; a **censored anchor**
  (no reliable RIR) defers to `predict_reps_anchored` — **byte-identical** to today. The
  interval inflates the slope SE by `Var(RIR)` (§1c), the nonconformity input #6 will
  calibrate.
- **`autoregulation.py`** — `prediction_for` selects the anchor's `rpe`, and when
  `rir_rep_model.enabled` engages `predict_reps_at_effort` (basis annotated `· at RIR n`,
  `at_effort`/`target_rir` surfaced); `weight_verdict` and `next_target` consume it
  unchanged (verdict now compares `capacity(W) − target_RIR` to `goal_rep_range`, per §1d).
- **`backtest.py`** — `effort_rep_prediction(conn)`: walk-forward, scores **performed**
  reps (apples-to-apples) of effort-vs-baseline, split RECENT (reliable-RIR anchor) vs
  LEGACY (censored → byte-identical), plus the effort-offset calibration (mean
  `target_RIR` vs mean actual RIR). Pre-registered bar in `priors.rir_rep_model`.
- **`config/priors.json`** — `rir_rep_model` block (`enabled:false`). No new settings
  key: `target_rir`'s fallback reads the existing `settings.progression_min_rir` (one
  source of truth; the spec's `target_rir_default` would have duplicated it).
- **`summary.py`** — additive `rir_rep_accuracy` block (schema stays 4). **`coach.py`** —
  `backtest` prints the #5 verdict; `predict` shows "at your usual ~n RIR effort". No DB
  schema change (`target_rir` is computed live).
- **Tests** — `tests/test_rir_rep_model.py` (16): median/fallback, capacity-at-effort
  math, censored byte-identity, interval inflation, pooled-slope passthrough, flag gating,
  verdict shift, validator shape + legacy identity. Full suite **192 → 208 green**.

**Real-data verdict (DB through 2026-06-27):** RECENT bucket **n = 0** (« the n ≥ 8 bar)
→ `adopt_effort = false`, linear/raw-reps predictor stays live. LEGACY n = 1189, MAE
0.396 → 0.396 (exact byte-identity, the sanity check). **Flag-on preview is sensible and
unit-correct**: lifts taken to failure last session correct **down** (Deadlift 1@150 RPE10
→ 0, Upper Chest Press 4@130 RPE10 → 2, Seated Row 6@96 RPE10 → 4); lifts with reserve
correct **up** (Lateral Raise 8@50 RPE7 → 9, OH Triceps Ext 8@10 RPE7 → 9); near-typical
efforts barely move. `target_RIR` falls back to 2 everywhere (each lift has < 3 reliable
RPE points so far). Same shape as #4's honest null — built, validated, gated OFF on data
scarcity, not model failure.
