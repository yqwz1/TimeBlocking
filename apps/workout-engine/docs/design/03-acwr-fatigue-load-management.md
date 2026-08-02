# Roadmap #3 — Robust fatigue / load-management (kill the ACWR false alarm)

**Status:** IMPLEMENTED + validated. `workout/fatigue.py` now has the adequacy gate
(`chronic_ref`/`chronic_adequacy`), uncoupling (`_date_band`), EWMA (`ewma_load`), the
state machine (`classify_state`/`acwr_gated`), the `readiness_signal` seam, and `assess`
rewritten around them; `config/settings.json` gained `acwr_chronic_min_days`/`_min_frac`/
`acwr_use_ewma`/`acwr_uncouple`/`acwr_spike_self`; the per-muscle gated `acwr_by_muscle`
protects `volume.recommend`'s spike-cut; validated by `backtest.acwr_gate_audit`; tests in
`tests/test_acwr_gate.py` (16).
**Real-data result (`coach.py backtest`):** of the layoff-return days where the OLD
ungated ACWR cried "spike", the gate reclassifies **100% as DETRAINED (clears the ≥90%
bar)**, while still flagging 4 genuine spikes on an adequate base. Live readiness now reads
**"AMBER — thin chronic base … returning from a gap, ramp up gradually (not a spike)"**
instead of the old RED "back off." Injury risk itself remains **unvalidatable** (no injuries
logged) — the banner no longer implies it.
**Deferred (flagged, faithful to §1d):** (a) sRPE internal load (§1e) — kept normalized
volume so the load stays unified with #1's Form traces; switching ACWR's load to sRPE would
fork the scale and needs its own validation. (b) Driving readiness from #1's Form difference
(§1d) — the `readiness_signal()` seam is in place, but Form failed its own predictive bar
(r=0.077), so the swap stays a one-liner rather than a silent default. (c) self-relative
`acwr_spike_self` percentile — config hook is wired (`classify_state` reads it); default null
keeps the population constant until enough adequate-base history exists.
**Integration targets:** `workout/fatigue.py` (`acwr`, `monotony_strain`, `assess`,
`daily_load_total`, `daily_load_by_muscle`, `frequency`), `config/settings.json`
(`acwr_*`, `monotony_flag`), `config/priors.json` (`detraining`). **Downstream
consumers protected:** `volume.recommend` (its per-muscle "hard ACWR spike force-cut"),
and the readiness banner in `report.py` / `summary.json`.
**Companions:** shares EWMA machinery with item #1 (fitness–fatigue form) — §1d shows
they are the same construction; the per-muscle gate here also protects the recovery
inputs that #2/#5 consume.

---

## 0. What we're fixing

Anatomy of the **4.0**. `fatigue.acwr` computes

```
ACWR = mean(daily load, last 7 d) / mean(daily load, last 28 d)
```

over daily-summed normalized volume, with **zeros on rest days**, and the acute
7-day window sitting **inside** the chronic 28-day window. On your history — only
**43 of ~114 weeks trained** — a layoff fills the chronic window with zeros, so the
28-day mean collapses toward zero. The next single session makes the 7-day mean jump,
and the ratio explodes to 4.0. `assess` then bumps readiness to **RED**, and the report
leads with **"Back off / recover."** That advice is the exact **opposite** of correct:
after a layoff you are **detrained** and should *ramp back up*, not back off.

There are three distinct defects tangled together here, and they need different fixes:

1. **Divide-by-thin-chronic** (the artifact that produced 4.0). The `chronic <= 0 → None`
   guard only catches *exactly* zero; any sliver of chronic load yields an explosive
   ratio. **This is the bug.**
2. **Mathematical coupling** — the acute window is part of its own chronic denominator
   (Lolli et al. 2017). Real, but **contested** in practice (the case study PMID 31672929
   argues it barely matters). A secondary concern.
3. **Weak metrics presented with false confidence** — Foster monotony/strain and the
   0.8–1.3 "sweet spot" are validated mostly in endurance/team sport, thinly in
   resistance training. The engine states "injury-risk zone" with a certainty the
   evidence doesn't support.

---

## 1. The model

### 1a. The real fix — gate ACWR on chronic-baseline adequacy

ACWR is only interpretable when there is a credible chronic base for the acute load to
be *relative to*. Define adequacy from **coverage** and **level**:

```
D_chr = number of distinct training DAYS in the chronic window
L_chr = mean daily load over the chronic window
L_ref = the user's rolling lifetime MEDIAN of L_chr   (their established chronic norm)

adequate  ⟺  D_chr ≥ d_min   AND   L_chr ≥ f · L_ref      (defaults: d_min = 6, f = 0.5)
```

When **not** adequate, the state is **DETRAINED / RETURNING**, *not* "spiking." The
ACWR injury flag is **suppressed entirely**, and the advice flips to *ramp up
gradually*, reusing the detraining model already in `priors.json` (`detraining.days_flag
= 21`, `strength_loss_pct_by_week`) to set expectations ("you've likely lost ~X% — rebuild
over N weeks"). **This single gate eliminates the entire 4.0 class of false alarms.** It
is the centerpiece of the spec; everything else is robustness polish.

### 1b. Uncouple the windows (secondary, honest about being contested)

Compute chronic over the period **excluding** the acute window, so acute isn't inside
its own denominator:

```
chronic = mean(daily load over [as_of − chronic_days,  as_of − acute_days])   # uncoupled
```

Honest caveat: the benefit of uncoupling is **debated** — some analyses show it changes
little, and PMID 31672929 argues coupling is a minor issue in practice. It's nearly free
to implement, so do it, but **do not present it as the fix.** The gate (1a) is the fix.

### 1c. EWMA smoothing (Williams 2017) — and why it is *not* the fix either

Replace the hard rolling means with exponentially-weighted moving averages — recency-
weighted, no abrupt window edges:

```
EWMA_t = λ · load_t + (1 − λ) · EWMA_{t−1},     λ = 2 / (N + 1)
ACWR_ewma = EWMA_acute(N = 7) / EWMA_chronic(N = 28)
```

This improves the *shape* of the signal. **But a ratio of EWMAs still blows up when the
chronic EWMA decays toward zero after a gap** — EWMA does **not** fix the divide. Say this
plainly in the code comments so nobody mistakes EWMA for the gap fix. The gate (1a) is
still required *on top of* EWMA.

### 1d. The unification with item #1 (the load-bearing insight)

The EWMA traces above are *exactly* item #1's form traces: `EWMA_acute = ATL` (fatigue),
`EWMA_chronic = CTL` (fitness). The only difference is the **operator**:

```
ACWR  =  ATL / CTL     →  a RATIO    →  explodes as CTL → 0   (the gap pathology)
form  =  CTL − ATL     →  a DIFFERENCE →  goes to 0 as both decay   (gap-safe)
```

So #1 and #3 are the **same machinery viewed two ways**, and the difference is strictly
better-behaved on your gappy data. **Recommendation: once #1 ships, retire the ACWR
*ratio* as the decision signal and drive readiness from the form *difference*;** keep a
gated ACWR only as a familiar display number. Build #3 so this swap is a one-line change
in `assess` (route through a `readiness_signal()` that returns form when available, gated
ACWR otherwise).

### 1e. Demote monotony/strain; prefer sRPE-load when available

Foster monotony/strain stay as **low-weight advisory flags only** — they never set the
readiness color on their own (today `monotony > 2.0` bumps to amber; remove that bump,
keep the note). When RPE is present (≈100% of the last 90 days), compute an **internal
load** — `Σ reps · (RPE/10)` per session, or session-RPE × duration — instead of pure
mechanical volume; sRPE-load has the best resistance-training support (Day et al. 2004).
Keep the volume-based load as a **byte-identical fallback** when RPE is absent, matching
the engine's established no-RPE-parity pattern.

### 1f. Readiness as an explicit state machine

Replace the single threshold-driven green/amber/red with named states, each carrying its
own inputs **and advice**:

| State | Condition (on the gated signal) | Advice |
|---|---|---|
| **DETRAINED / RETURNING** | chronic inadequate (1a) | ramp up; expect strength loss |
| **FRESH** | adequate base, acute < chronic (form > 0) | room to push |
| **PRODUCTIVE** | acute ≈ chronic | hold / progress |
| **ACCUMULATING** | acute moderately > chronic, adequate base | watch; plan a deload |
| **SPIKING** | acute ≫ chronic, adequate base | the *only* genuine "back off" |

Map states onto the existing green/amber/red so `report.py` / `summary.json` need no
change (DETRAINED → amber with a *ramp* message, SPIKING → red, FRESH/PRODUCTIVE → green,
ACCUMULATING → amber). The point: **only SPIKING-on-an-adequate-base ever says "back
off"** — the artifact can no longer reach that verdict.

---

## 2. Thresholds — set them honestly

The 0.8 / 1.3 / 1.5 cut-points are population-derived and **contested**. Two honest
options, preferred over trusting a literature constant:

- **Soft flag, not a gate.** Use ACWR as one input among several; never hard-gate a big
  decision (like a forced volume cut) on a single contested threshold. (Today
  `volume.recommend` force-cuts a muscle's sets when its ACWR > spike *even in
  low-confidence mode* — that path must additionally check the 1a gate, or it will keep
  cutting volume on phantom spikes.)
- **Self-relative.** Once enough adequate-base days exist, compute the user's **own**
  ACWR (or form) distribution and flag the upper percentile (e.g. > 85th) as "spiking
  **for you**," rather than a universal constant — the same z-score philosophy as #1.

Keep `acwr_spike` / `acwr_low` as configurable fallbacks for the cold-start period.

---

## 3. Validation — including what we honestly *cannot* validate

- **We CANNOT validate injury risk.** No injuries are logged in the store, so the entire
  ACWR→injury premise is **untestable** on this data. Do not claim it, and stop the
  banner from implying it. This is the most important honesty point in the spec.
- **We CAN validate the gate (a false-alarm audit).** Walk-forward the history; for every
  **layoff-return** session (a gap ≥ `g` days followed by a session), check whether the
  **old** ACWR fired spike/RED, and confirm the **gated** version reclassifies it as
  DETRAINED. *Pre-registered bar:* the gate must eliminate **≥ 90%** of post-gap spike
  flags while not suppressing spikes that occur on an adequate base.
- **We CAN test the weak performance claim.** On adequate-base days only, does high
  ACWR / low form precede a **leakage-free next-session performance residual** drop?
  Reuse item #1's detrended-outcome validator (predict the residual vs the lift's own
  trend, with an embargo). *Expectation:* weak — that's the ceiling — and reported as
  such, not buried.

---

## 4. Pseudocode

Gated, optionally-uncoupled, optionally-EWMA ACWR + adequacy + the state machine. New
`settings.json` keys: `acwr_chronic_min_days` (6), `acwr_chronic_min_frac` (0.5),
`acwr_use_ewma` (true), `acwr_uncouple` (true).

```python
def ewma_load(loads_by_day, first_day, as_of, N):
    """Recency-weighted load; rest days contribute 0 so it decays across gaps.
    NOTE: still needs the §1a gate — a ratio of EWMAs explodes as chronic → 0."""
    lam, v = 2.0/(N+1), 0.0
    for day in daily_range(first_day, as_of):          # every calendar day
        v = lam * loads_by_day.get(day, 0.0) + (1.0 - lam) * v
    return v

def chronic_adequacy(loads, as_of, s, l_ref):
    win   = _daterange(as_of, s["acwr_chronic_days"])
    d_chr = sum(1 for d in win if loads.get(d, 0.0) > 0)
    l_chr = mean(loads.get(d, 0.0) for d in win)
    adequate = (d_chr >= s["acwr_chronic_min_days"] and
                (l_ref <= 0 or l_chr >= s["acwr_chronic_min_frac"] * l_ref))
    return adequate, d_chr, l_chr

def acwr_gated(loads, as_of, s, l_ref, first_day):
    adequate, d_chr, l_chr = chronic_adequacy(loads, as_of, s, l_ref)
    if not adequate:                                   # ← the fix: thin base ≠ spike
        return {"state": "detrained", "acwr": None, "level": "amber",
                "reason": f"thin chronic base ({d_chr} training days) — "
                          "returning from a gap, ramp up (not a spike)"}
    if s["acwr_use_ewma"]:
        a = ewma_load(loads, first_day, as_of, s["acwr_acute_days"])
        c = ewma_load(loads, first_day, as_of, s["acwr_chronic_days"])
    else:
        a = mean(loads.get(d, 0.0) for d in _daterange(as_of, s["acwr_acute_days"]))
        # uncoupled chronic: exclude the acute window
        lo = s["acwr_chronic_days"]; hi = s["acwr_acute_days"] if s["acwr_uncouple"] else 0
        c  = mean(loads.get(d, 0.0) for d in _date_band(as_of, lo, hi))
    r = (a / c) if c > 0 else None
    return {"acwr": round(r, 2) if r else None, **classify_state(r, a, c, s, l_ref)}

def classify_state(r, a, c, s, l_ref):
    spike = s.get("acwr_spike_self") or s["acwr_spike"]     # self-relative pctile if set
    if r is None:                       return {"state": "productive", "level": "green"}
    if r >= spike:                      return {"state": "spiking",      "level": "red"}
    if r >= 1.0 + (spike - 1.0) * 0.5:  return {"state": "accumulating", "level": "amber"}
    if r < s["acwr_low"]:               return {"state": "fresh",        "level": "green"}
    return {"state": "productive", "level": "green"}
```

`assess` then consumes `acwr_gated` for the global read and per muscle, builds `reasons`
from the **state** (not a raw threshold), and moves monotony/strain + frequency into an
**advisory tail** that never bumps the level on its own.

---

## 5. Integration points + honest expectations

### `workout/fatigue.py`
- Keep `acwr()` as a raw helper, but add **`acwr_gated()`** (above) and route both the
  global read in `assess()` and the per-muscle read (`daily_load_by_muscle` → the
  `acwr_by_muscle` map) through it. **Critical:** the per-muscle gated value is what
  `volume.recommend` uses for its hard spike-cut — gating it stops phantom spikes from
  cutting real volume (which today poisons the #2/#5 recovery inputs).
- Compute **`l_ref`** = the user's rolling lifetime median chronic load, globally and per
  muscle (a cheap query; cache in `summary.json`).
- Rewrite `assess()` around the state machine; demote monotony/strain/frequency to the
  advisory tail.
- Add a `readiness_signal()` indirection so that when item #1's form ships, readiness is
  driven by `CTL − ATL` (gap-safe difference) with a one-line swap.

### `config/settings.json`
- Add `acwr_chronic_min_days`, `acwr_chronic_min_frac`, `acwr_use_ewma`, `acwr_uncouple`,
  optional `acwr_spike_self`. Keep `acwr_spike` / `acwr_low` / `monotony_flag` as
  fallbacks so cold-start behavior is defined.

### `config/priors.json`
- No change; the spec *reads* `detraining` to populate the DETRAINED-state messaging.

### Honest expectations / ceiling
- **Primary win is correctness and trust, not predictive power.** The engine stops
  confidently telling you to "back off" when you've actually just returned from a layoff
  — and the per-muscle gate stops false spikes from silently cutting your volume targets.
  That alone is worth shipping.
- **It does not give you a validated injury predictor** — impossible without injury data,
  and the spec refuses to pretend otherwise.
- **It is at best a weak performance predictor** (the load-only ceiling, same as #1).
  The state machine's value is *honest signposting* (detrained vs fresh vs spiking), not
  clairvoyance.
- **Best paired with #1:** ship the gate now (cheap, high-trust), then let #1's form
  difference replace the ACWR ratio as the underlying signal so the gap pathology can't
  recur by construction.
```
