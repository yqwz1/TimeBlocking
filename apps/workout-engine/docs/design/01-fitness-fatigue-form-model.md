# Design spec: Fitness–Fatigue "Form" recovery model (WorkOut engine)

**Status:** FULLY IMPLEMENTED, confidence-gated. Model + validator: `workout/form.py`,
`backtest.form_validity`, `config/priors.json` → `form`. Live-wiring (§5): Form z-score
is now the load-based fatigue sub-read in `volume.recovery_by_muscle`; the leakage-free
Form validator feeds `confidence_from_validity` (via `summary.py` + `coach.py sets`); and
`fatigue.acwr` is gated against the near-zero-chronic blow-up. Tests: `tests/test_form.py`
(31). Targets roadmap item #1.
**Goal:** replace the leaky, ~zero-validity fatigue half of `volume.recovery_by_muscle`
with a principled, gap-robust acute-vs-chronic signal, and validate it honestly.

**First read on real data (`coach.py backtest`):** 191 leakage-free windows,
corr(Form, detrended next change) = 0.077, tercile means non-monotone → fails the
pre-registered bar (r ≥ 0.15 ∧ monotone). Net live behavior (`coach.py sets`): Form
drives the gap-safe readiness *scores* (no more ACWR 4.0 false alarms), but because
r < 0.15 the recovery **confidence reads "low" → set recommendations lean on volume
landmarks**. Exactly the §6 outcome: honest and non-misleading, not "suddenly
clairvoyant." Form will start to actually move the numbers only if/when its
leakage-free r clears the bar (or HRV / bar-velocity inputs arrive).

---

## 0. What we're fixing

Two separate problems, often conflated:

1. **Leaky validation.** The live recovery score blends `0.5·momentum` (the lift's own
   e1RM trend). Momentum autocorrelates with the outcome (next e1RM change) *by
   construction*, so the composite looks predictive while the honest part isn't. Even
   the backtest's "fatigue-only" correlation only fixes the *predictor* side — the
   *outcome* (next-2wk e1RM change) is still not detrended, so some leakage remains.
2. **A fatigue metric that blows up on gaps.** ACWR = acute/chronic divides by a
   near-zero chronic baseline after a layoff → the 4.0 artifact.

The form model fixes #2; a detrended walk-forward fixes #1.

---

## 1. The model

### 1.1 Banister foundation (the thing everyone builds on)
Performance modeled as fitness minus fatigue, each an exponentially-decaying
convolution of past training load `w(s)`:

```
p(t) = p0 + k1·g(t) − k2·h(t)
g(t) = Σ_{s<t} w(s)·exp(−(t−s)/τ1)     # fitness, slow decay (τ1 ≈ 42 d)
h(t) = Σ_{s<t} w(s)·exp(−(t−s)/τ2)     # fatigue, fast decay (τ2 ≈ 7 d)
```

### 1.2 Why NOT to fit the full Banister model on this data
5 free params (p0, k1, k2, τ1, τ2). Hellard et al. 2006: ill-conditioned, k1/τ1
trades off against k2/τ2, and adding the fatigue term often doesn't improve
prediction (p > 0.40). A 2025 Sci Rep paper ("Statistical flaws of the
fitness–fatigue model") reinforces it. With ONE subject on gappy data, free-fitting
all 5 will overfit. **Decision: do not fit performance. Fix the time constants.**

### 1.3 Recommended form: normalized EWMA traces (CTL / ATL / TSB)
The TrainingPeaks-style normalized version of Banister — bounded, interpretable,
and **zero free gains** (k's are implicitly 1):

```
CTL_t = CTL_{t−1} + α_f·(L_t − CTL_{t−1})      # "fitness" / chronic, τ_f = 42 d
ATL_t = ATL_{t−1} + α_a·(L_t − ATL_{t−1})      # "fatigue" / acute,   τ_a = 7  d
Form_t = CTL_{t−1} − ATL_{t−1}                 # "freshness" (uses PRE-update traces)
```

with, on a daily walk (Δt = 1 day):
```
α_f = 1 − exp(−1/τ_f) = 1 − exp(−1/42) ≈ 0.0235
α_a = 1 − exp(−1/τ_a) = 1 − exp(−1/7)  ≈ 0.1331
```

**Gap robustness (the whole point):** iterate over *every calendar day*; rest days
contribute `L = 0`, so both traces decay toward 0. After a layoff CTL and ATL are
both small and `Form ≈ 0` — "detrained / neutral," NOT "spiking." No division, so no
ACWR blow-up. Event-based optimization (skip rest days) is exact with
`α = 1 − exp(−Δt/τ)`, but daily-dense is unambiguous and cheap at your scale.

`L_t` = summed **normalized** volume for the muscle on day t (reuse `metrics.volume`,
which is already unit-safe), so loads are comparable across exercises and unit-epochs.

### 1.4 Per muscle, with self-relative thresholds
Raw Form scale depends on a muscle's load magnitude (back ≫ calves), so don't use
absolute cutoffs. z-score against the muscle's OWN Form history:
```
z = (Form_t − mean(Form_hist)) / sd(Form_hist)
z ≥ +0.5 → recovering_well ; z ≤ −0.5 → under_recovering ; else borderline
```

### 1.5 Why this beats ACWR + drop-off here
- No near-zero denominator → no false "injury risk" after gaps.
- Principled acute-vs-chronic (the form/TSB concept has a real performance pedigree).
- Bounded & interpretable; no gains to overfit; one global (τ_f, τ_a) pair.

---

## 2. Honest, leakage-free validation (the methodology fix)

Improve on the current backtest in TWO ways: detrend the **outcome**, and use Form
(pure load) as the **predictor** (no momentum).

```
for each muscle:
  lift   = representative_lift(muscle)
  ser    = e1rm_series(lift)                 # [(date, e1rm)] one point per session
  forms  = { date: Form_t } from §1 on the muscle's daily load
  for i in range(MINP, len(ser)-1):
    # (1) lift's OWN trend from PRIOR sessions only
    trail            = ser[i-6 : i]          # excludes session i
    slope, intercept = theil_sen(trail vs days)
    # (2) outcome = next session's e1rm MINUS its own trend expectation,
    #     with an embargo gap so the trend window can't touch the outcome
    (d_j, e_j)       = first_session_after(d_i, gap ≥ embargo_days, within = horizon)
    expected_j       = intercept + slope·days(trail[0].date → d_j)
    outcome_resid    = e_j − expected_j      # performance ABOVE/BELOW its own trend
    # (3) predictor = Form as of session i (pre-update → no peek)
    X.append(forms[d_i]); Y.append(outcome_resid)
  report pearson(X, Y) and mean(Y) by X-tercile (monotone?)
```

If Form's r on the *residual* is still ≈ 0, that is the **truth**: readiness isn't
recoverable from load alone for this user (the no-HRV/no-velocity ceiling). The engine
then correctly falls back to volume landmarks — which it already does.

---

## 3. Tuning the time constants (optional, disciplined)

Default: **fix** τ_f = 42, τ_a = 7 (literature). Only tune with guardrails:
- Grid τ_a ∈ {5,7,10,14}, τ_f ∈ {28,42,56}; pick the pair maximizing the §2
  leakage-free correlation under **nested** walk-forward CV.
- Fit ONE global pair (never per-muscle — too little data). Report stability across
  folds; if the winner flips fold-to-fold, keep the defaults.
- Pre-register the success bar BEFORE looking: e.g. "adopt Form over landmarks iff
  leakage-free r ≥ 0.15 AND tercile means are monotone." Prevents self-deception.

---

## 4. Pseudocode (numpy-flavored, new `form.py` — design only)

```python
import math
TAU_FIT, TAU_FAT = 42.0, 7.0    # days; fixed per §1.2

def daily_muscle_load(conn, muscle):
    rows = conn.execute(
        "SELECT date, SUM(COALESCE(volume,0)) v FROM sets "
        "WHERE primary_muscle=? AND is_working=1 GROUP BY date ORDER BY date",
        (muscle,)).fetchall()
    return [(r["date"], r["v"]) for r in rows]

def form_series(daily_loads, tau_fit=TAU_FIT, tau_fat=TAU_FAT):
    """[(date, ctl, atl, form)]; daily-dense so gaps decay (no ACWR blow-up).
    `form` is the PRE-update CTL−ATL: the readiness you'd act on that morning."""
    a_f, a_a = 1 - math.exp(-1/tau_fit), 1 - math.exp(-1/tau_fat)
    ctl = atl = 0.0
    out = []
    for date, load in densify_daily(daily_loads):   # fill missing days with load=0
        form = ctl - atl                            # pre-update → no leakage
        ctl += a_f * (load - ctl)
        atl += a_a * (load - atl)
        out.append((date, ctl, atl, form))
    return out

def readiness_from_form(form_today, form_history):
    mu = mean(form_history); sd = stdev(form_history) or 1.0
    z = (form_today - mu) / sd
    return (("recovering_well" if z >= 0.5 else
             "under_recovering" if z <= -0.5 else "borderline"), round(z, 2))
```

---

## 5. Integration point — DONE (confidence-gated)

- ✅ `volume.recovery_by_muscle`: the `fatigue` sub-read is now the Form z-score
  (`_form_signal(z)` via `_muscle_form_z`), replacing `_acwr_signal` + `_dropoff_signal`
  in the score; `momentum` stays separate; new weights via `_form_recovery_weights`
  (perf keeps its share, the whole load-fatigue share goes to Form, RPE keeps its
  fraction). `form_z`/`form_state` exposed on the read. ACWR is still reported and still
  drives the hard-spike override in `recommend`, but no longer feeds the graded score.
- ✅ confidence: `summary.py` and `coach.py sets` feed `backtest.form_validity` (the §2
  detrended validator) to `confidence_from_validity`, which now prefers
  `corr_form_vs_residual` (falls back to the legacy key). r=0.077 → "low" → landmarks
  drive. (`backtest.recovery_validity` is kept for the advisory cutoff calibrator.)
- ✅ `fatigue.acwr`: gated on `acwr_min_chronic_days` (default 3) active days in the
  chronic window — returns None instead of the 4.0 artifact; `fatigue.assess` adds a
  "sparse history → ACWR suppressed (returning/detrained)" note so the banner explains
  itself. (This is also roadmap item #3's gate-first fix.)

---

## 6. Expected outcome (managed honestly)
Load-only Form will (a) end the ACWR false alarms, (b) give a principled, gap-safe
acute/chronic read, and (c) tell you the *truth* about recovery predictability via a
clean scoreboard. It will **not** turn load+reps into a strong readiness predictor —
that needs HRV or bar velocity. Success here = "honest and non-misleading," not
"suddenly clairvoyant."
```
```
```
```
