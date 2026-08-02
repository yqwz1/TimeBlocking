# Prediction Improvement Roadmap — WorkOut Coach

How to make the engine predict **reps, recovery, and fatigue** better. This is the
index for a set of design specs; it captures the goal, the measured failure modes,
the data reality, and a ranked roadmap. Per-item specs are linked below.

**Evidence basis:** research synthesis produced 2026-06-28 via the academic-pipeline
(Stage 1 / deep-research). The initial automated web pass failed on a rate limit; a
focused manual verification sweep then confirmed every priority citation (one was
corrected, the ACWR critique was softened to "contested"). Specific `[verify]`-tagged
numbers in the specs should still be spot-checked before relying on them.

---

## The problem — three *measured* failure modes

These are not hypotheticals; they come from the engine's own backtest + a DB profile.

1. **Recovery has ~zero predictive validity.** Walk-forward correlation of the
   leakage-free fatigue signal vs next-2-week e1RM change is **r = −0.031**. The live
   composite looks better only because it blends in the lift's own momentum, which
   autocorrelates with the outcome by construction (leaky).
2. **ACWR false alarms.** It read **4.0 ("injury-risk zone")** after a single session
   following a layoff — acute load over a near-zero chronic baseline. The training
   history is gappy (only **43 of ~114 calendar weeks** had sessions), so this is
   structural, not a tuning issue.
3. **Rep model is starved and overshoots.** Per-exercise linear OLS can't fit a slope
   without load variation; the linear law also overshoots when extrapolated to 1RM.

## Data reality (from a read-only DB profile, 2026-06-28)

| Signal | Value | Consequence |
|---|---|---|
| Working sets / sessions | 3,825 / 137 | plenty in aggregate |
| Weeks trained vs span | 43 of ~114 | gappy → ACWR artifact |
| **RPE coverage** | **0.5% lifetime, 100% last 90 d** | RPE methods are forward-only |
| Bodyweight logs | 2 | BW-trend signals off the table |
| Lifts that can fit own load-rep curve | **25 / 71** | only ⅓ are self-sufficient |
| Lifts with reps but ≤3 distinct loads | **15** | slope unidentifiable → the real "calibrating" cause → partial pooling |
| Pooling group sizes | back 13, chest 11, biceps 7, triceps 5, shoulders 5 | big enough for hierarchy |

## Ranked roadmap

| # | Change | Subsystem | Impact | Effort | Module(s) | Spec |
|---|--------|-----------|--------|--------|-----------|------|
| **1** | Fix recovery validation leakage + replace fatigue half with a fitness–fatigue "form" signal | Recovery | High | Med | `backtest.py`, `volume.py`, new `form.py` | [01](01-fitness-fatigue-form-model.md) |
| **2** | Hierarchical partial pooling (exercise ⊂ exercise-type) for the load→reps slope | Reps | High | Med | `individualize.py` | [02](02-hierarchical-pooling-rep-model.md) |
| **3** | Gate ACWR on near-zero chronic baseline + uncouple/EWMA; demote monotony/strain | Fatigue | Med-High | Low | `fatigue.py` | [03](03-acwr-fatigue-load-management.md) |
| **4** | Curvilinear / regularized 1RM (type-level spline shape + lift-local anchor) | Reps | Med | Low-Med | `individualize.py`, `metrics.py` | [04](04-curvilinear-1rm-model.md) |
| **5** | Fold RIR into the rep & 1RM fit (not just e1RM) | Reps | Med (growing) | Low | `individualize.py`, `autoregulation.py` | [05](05-rir-into-rep-model.md) |
| **6** | Conformal prediction intervals for reps & forecast | Uncertainty | Med | Low | `forecast.py`, `individualize.py`, `backtest.py` | [06](06-conformal-prediction-intervals.md) |

**Cross-cutting principle:** every change is validated by the walk-forward metrics the
engine already computes (`model_mae`, recovery-validity `r`, forecast MAE), each with a
**pre-registered success bar** set *before* looking, and an **honest null result** is an
acceptable outcome.

## Honest ceiling

Recovery/fatigue prediction from **load + reps alone has a modest ceiling.** The methods
that reliably predict readiness — HRV-guided training and velocity-loss autoregulation —
need sensors not in scope (no HRV, no bar velocity). The recovery work (#1, #3) is worth
doing mainly to **stop misleading the user** (kill the ACWR false alarm, end the leakage)
and to gate volume honestly — not because load alone will predict next week's PR. The
**rep side** (#2, #4) is where real, measurable accuracy gains live.

## Key references (verified 2026-06-28)

- ACWR critique (contested): Lolli et al. 2017 (mathematical coupling, PMID 29101104);
  Impellizzeri et al. 2020 (conceptual pitfalls). Counterpoint: case study PMID 31672929.
- Fitness–fatigue model limits: Hellard et al. 2006 (ill-conditioning, J Sports Sci 24:5);
  *Statistical flaws of the fitness–fatigue model*, Sci Rep 2025; FF + Kalman state-space
  (Performance Estimation using the Fitness-Fatigue Model with Kalman Filter Feedback, 2017).
- Reps↔%1RM shape: Nuzzo et al. 2024 meta-regression (PMC10933212) — natural cubic
  splines; exercise type is the only meaningful moderator.
- Weight-dependent 1RM: arXiv 2603.17495 (2026, preprint; use with unit/near-failure caveats).
- Calibrated intervals: Romano, Patterson & Candès 2019, Conformalized Quantile Regression
  (arXiv 1905.03222).
- sRPE in resistance training: Day, McGuigan, Brice & Foster 2004 (PMID 15574104).

## Status

| Item | Spec | Note |
|---|---|---|
| #1, #2, #4 | ✅ written | #4 reviewed; recommended hardening: use a **monotone (PCHIP)** interpolator for guaranteed invertibility; tighten the `Var(M)` proxy. #4 needs one upstream change: `fresh_points()` must also return `rpe`. |
| #3 | ✅ written | gate-first design; honest that injury-risk is unvalidatable without injury data; unifies with #1's form (ratio→difference). |
| #5 | ✅ **implemented**, gated OFF | RIR → capacity curve; **predict-at-effort** (`capacity(W) − target_RIR`); legacy/censored sets byte-identical; shares `failure_reps` with #4. Honest null: validator RECENT bucket n=0 (RPE forward-only, no post-RPE session to score yet) « n≥8 bar → raw-reps predictor stays live; auto-activates by rerun. Flag-on preview is unit-correct (failure sets correct down, reserve sets up). |
| #6 | ✅ written | conformal + **Mondrian-by-type** for small-n; unifies rep & forecast bands behind one helper; reuses #2's exercise-type grouping. |

**All 6 items now designed.** Next phase is implementation (each item = engine code + before/after backtest proof). Suggested build order: #3 gate (cheapest, highest trust) → #2 pooling (highest-leverage rep win) → #5/#4 (share the capacity curve) → #1 form → #6 conformal (wraps whatever sharpness the others provide).

None of these are implemented yet — they are designs. Building any item crosses from
research into implementation (edited engine code + before/after backtest proof).
