# WorkOut Coach

A local, offline strength-coaching engine for your Hevy exports. Zero external
dependencies (pure Python 3 standard library). Each weekly export becomes a
coaching report: progress, PRs, fatigue/readiness, "can I push more?" targets,
and forecasts.

## Weekly use

Export your full history from Hevy as CSV, then:

```
python coach.py update "C:\path\to\workout_data.csv"
```

This ingests the export (de-duplicating against history), recomputes all
metrics, grades last week's targets, and writes three artifacts to
`output\<latest-date>\`:

- `summary.json` - machine-readable contract (what the AI coach reads)
- `report.md` - the written weekly coaching report (now leads with a "Do next" list)
- `dashboard.html` - a tabbed, fully-offline dashboard (open in any browser)

## Other commands

```
python coach.py report                      # re-render from stored data
python coach.py log-bw 82.5                  # log bodyweight (kg)
python coach.py set-goal "Bench Press (Barbell)" e1rm 120 --by 2026-01-01
python coach.py note injury "left shoulder twinge on incline"
python coach.py status                       # store size + adherence %
python coach.py predict "T Bar Row" 80       # predicted reps + "is this weight good?"
python coach.py calibrate                    # optional tips to sharpen predictions
python coach.py compare                      # which style works better for YOUR body
python coach.py sets                          # recovery-gated sets-per-muscle for next week
python coach.py backtest                      # measure prediction accuracy on your own history
```

## The dashboard (`dashboard.html`)

A single self-contained file that renders entirely from `summary.json` - no
internet, no CDN, no build step (all charts are hand-built inline SVG, so it
works with Wi-Fi off). A tabbed app, not a wall of text:

- **Overview** - a prioritized **"Do next"** panel (the single most useful
  thing: what to change this week), key numbers with hover explainers, flags,
  and a monthly-consistency chart.
- **Strength** - pick any lift to see its estimated-1RM history, forecast, PR
  star and plateau-onset marker; searchable next-target table. Filter by status
  (progressing / plateau / declining) or search by name.
- **Volume & Recovery** - MEV/MAV/MRV range bars (marker colored by recovery,
  triangle = next-week target), per-muscle recovery cards, push/pull &
  upper/lower gauges, and the recovery-gated set plan.
- **Body Map** - a front/back muscle diagram you can color by **volume**,
  **recovery**, or **recency**; hover for detail, click to jump to the plan.
- **Calendar** - every training day as an activity heatmap plus a month grid;
  click any day to see exactly what you did (exercises, top sets, volume).
- **Records** - your bests per lift (e1RM, heaviest, most reps, best volume),
  recent PRs starred.
- **Goals** - progress rings toward each target with a projected date.

Top bar: global **search**, a light/dark **theme** toggle, and **export**
(download JSON, download the lifts table as CSV, or Print / Save-as-PDF). Every
metric has an "i" explainer so the numbers aren't a mystery.

## Measuring accuracy (`backtest`)

Walk-forward validation that replays your history using only the data available
at each point, then compares predictions to what actually happened. Honest by
design — it will tell you when a method ISN'T working:

- **Rep prediction** — predicts each session's top-set reps vs a naive
  "same as last time" baseline. The predictor anchors on your last session and
  adjusts for the load change via your personal slope (this beats naive at 100%
  coverage; a pure regression did not).
- **Recovery validity** — does a higher recovery read actually predict better
  performance over the next ~2 weeks? Reports the correlation and the mean gain
  per recovery state. On RPE-less data this signal is weak (directional only —
  the "recovering well" bucket does gain most) — logging RPE strengthens it.
- **Forecast error** — predicted vs realized e1RM weeks later (MAE).

## Recovery-gated set targets (`sets`)

Tells you how many sets per muscle to run next week, and only adds volume where
you're actually recovering. Recovery per muscle is inferred from performance:
the lift's e1RM trend (rising/flat/declining), per-muscle ACWR (load spike), and
in-session rep drop-off. Logic: below MEV -> ramp up to the minimum (gradually,
capped at +3 sets/wk); in the MEV->MAV zone -> add only if recovering well, hold
if mixed, **cut if recovery is poor**; over MRV -> deload toward MAV. This is
RP-style volume progression with a recovery gate, so you never bury yourself in
junk volume. Logging RPE/sleep/bodyweight sharpens the recovery read.

## How it learns you (v2 individualization)

This is a small-data Bayesian problem, not deep learning. The coach starts from
research-based population defaults and shifts toward YOUR personal model as data
accumulates (the "grace period"), showing a confidence level per lift.

- **Rep prediction** — after ~8 fresh sets on a lift it fits your own load->reps
  curve and predicts reps at any weight, with a credible interval that tightens
  as it learns you. Fitted on a recent window so long-run gains don't distort it.
- **"Is this weight good for me?"** — `predict` gives a too-light / good / too-heavy
  verdict against your 5-8 target, plus a personalized 1RM (only when reliable).
- **Grace period (hybrid)** — lifts are `calibrating` -> `learning` -> `confident`.
  `calibrate` suggests optional sets (vary load, log RPE) to graduate faster.
- **Plateau intelligence** — segmented regression + CUSUM pinpoint when a lift
  stalled and estimate its ceiling; feeds evidence-based deload + detraining alerts.
- **Experiment & compare** — `compare` tells you whether higher volume actually
  produced faster gains for each muscle of YOURS. Logging RPE adds effort-style
  comparison.

Research basis (priors live in `config/priors.json`): Nuzzo 2024 (reps@%1RM),
Zourdos 2016 (RIR), Pelland 2024 / Schoenfeld 2017 (volume dose-response),
Grgic 2019 (deload), Gelman & Hill / Adams & MacKay 2007 (Bayesian + change-point).
All predictions label population-vs-personal and carry a confidence.

## How it thinks (the important bits)

- **Relative, not absolute, load.** Logged "kg" is often a stack/lbs number and
  can change units mid-history, so each exercise is indexed to its own baseline
  per *unit-epoch*. Progression stays honest (no fake +800% PRs).
- **e1RM** via Epley, only for sets <=10 reps. PRs tracked per current epoch.
- **Fatigue without RPE**: ACWR (acute:chronic load), Foster monotony, and
  in-session rep drop-off give a green/amber/red readiness call with reasons.
  Logging RPE + bodyweight later sharpens this automatically.
- **Next-session targets**: double-progression vs a 5-8 rep range -> exact
  weight x reps, in the unit you type into Hevy.
- **Forecasts**: robust Theil-Sen trend with a confidence band; says "plateau"
  or "insufficient data" instead of extrapolating noise.
- **Anomalies**: rep typos (e.g. 100x57) are corrected to a plausible value,
  the raw is always kept, and the fix is shown in the report.

## Config (edit freely)

- `config/settings.json` - rep range, windows, thresholds, load increments
- `config/landmarks.json` - weekly set targets (MEV/MAV/MRV) per muscle
- `config/exercises.json` - exercise -> muscle/pattern/equipment registry

## Tests

```
python -m unittest discover -s tests -v
```

## Layout

`workout/` - the engine (ingest, normalize, quality, metrics, progression,
fatigue, autoregulation, forecast, balance, summary, report, memory).
`data/workout.db` - the SQLite store. `output/` - per-run artifacts.
