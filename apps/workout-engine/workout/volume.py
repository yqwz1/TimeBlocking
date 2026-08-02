"""Recovery-gated volume autoregulation: how many sets per muscle next week.

The user's rule, formalized with the evidence base: ramp weekly sets from MEV
toward MAV ONLY while the muscle is recovering well (performance holding/rising,
load not spiking, in-session rep drop-off normal). If recovery is poor, hold or
cut sets rather than digging a deeper hole. Below MEV we still raise to the
minimum effective dose (you can't grow on too little), but gently when fatigued.

Recovery is inferred from performance, load (ACWR) and in-session rep drop-off.
When RPE is logged it adds a direct, leakage-free fatigue read (how deep into the
tank recent sessions go, and whether RPE creeps up within a session at matched
load); with no RPE the score is byte-identical to the performance-only mix.
"""
import statistics
from collections import defaultdict
from datetime import timedelta
from . import config, dates, progression, form


# --------------------------------------------------------------------------
# Per-muscle recovery signals
# --------------------------------------------------------------------------
def _perf_by_muscle(prog_map):
    """Per-muscle: progressing/declining lift counts (unit-free) + median slope."""
    agg = defaultdict(lambda: {"prog": 0, "decl": 0, "trend": 0, "slopes": []})
    for ex, p in prog_map.items():
        mus = config.exercise_info(ex)["primary"]
        if p["status"] in ("progressing", "declining", "plateau") and \
                p["e1rm_trend_per_week"] is not None:
            a = agg[mus]
            a["trend"] += 1
            a["slopes"].append(p["e1rm_trend_per_week"])
            if p["status"] == "progressing":
                a["prog"] += 1
            elif p["status"] == "declining":
                a["decl"] += 1
    return agg


def _clip(x, lo, hi):
    return max(lo, min(hi, x))


def _acwr_signal(a, p):
    """Map per-muscle ACWR to [-1, +0.3]: spike penalized, healthy band rewarded."""
    if a is None:
        return 0.0
    if a > p["acwr_high"]:
        return -_clip((a - p["acwr_high"]) / 0.4, 0, 1)
    if a < p["acwr_low"]:
        return -0.3 * _clip((p["acwr_low"] - a) / 0.4, 0, 1)  # low stimulus, mild
    return 0.3


def _dropoff_signal(d, p):
    """Higher in-session rep drop-off => more fatigue => negative."""
    if d is None:
        return 0.0
    return -_clip((d - p["dropoff_neutral"]) /
                  (p["dropoff_bad"] - p["dropoff_neutral"]), 0, 1)


def _form_signal(z, scale=2.0):
    """Map a per-muscle Form z-score to a fatigue signal in [-1, +0.3], same scale
    and sign convention as the other recovery signals: fresh (positive z) reads as
    a mild positive (capped, freshness isn't a license to pile on), fatigued
    (negative z) scales down to -1 by ~z=-2. None passes through (no Form yet).
    This is the load-based fatigue read that REPLACES ACWR + drop-off (design 5.1):
    gap-robust (no near-zero-denominator blow-up) and the one the leakage-free
    backtest actually validates."""
    if z is None:
        return None
    return round(_clip(z / scale, -1.0, 0.3), 2)


def session_dropoff(weights, reps, tol):
    """In-session rep drop-off measured ONLY across sets at (approximately) the
    same load, so intentionally lighter back-off sets don't masquerade as
    fatigue. Compares the top set to the last set held within `tol` of the
    top-set load. Returns a fraction in [0, 1] or None. Falls back to raw
    first-vs-last when load info is missing."""
    if len(reps) < 2 or reps[0] is None or reps[0] <= 0:
        return None
    w0 = weights[0] if weights else None
    if w0 is None or w0 <= 0:
        kept = reps
    else:
        kept = [rp for w, rp in zip(weights, reps)
                if w is not None and abs(w - w0) <= tol * w0]
    if len(kept) < 2 or kept[0] <= 0:
        return None
    return (kept[0] - kept[-1]) / kept[0]


def _dropoff_by_muscle(conn, as_of, weeks=3):
    """Average within-session (same-load) rep drop-off per muscle over a window."""
    tol = config.settings().get("dropoff_same_load_tol", 0.10)
    start = (dates.from_iso(as_of + "T00:00:00") - timedelta(weeks=weeks)).strftime("%Y-%m-%d")
    rows = conn.execute(
        """SELECT start_time, exercise_title, primary_muscle, set_index, reps_clean,
                  weight_raw
           FROM sets WHERE is_working=1 AND reps_clean IS NOT NULL
             AND date > ? AND date <= ? ORDER BY start_time, exercise_title, set_index""",
        (start, as_of)).fetchall()
    groups = defaultdict(lambda: {"reps": [], "w": []})
    for r in rows:
        g = groups[(r["start_time"], r["exercise_title"], r["primary_muscle"])]
        g["reps"].append(r["reps_clean"])
        g["w"].append(r["weight_raw"])
    by_m = defaultdict(list)
    for (_, _, muscle), g in groups.items():
        do = session_dropoff(g["w"], g["reps"], tol)
        if do is not None:
            by_m[muscle].append(do)
    return {m: round(statistics.mean(v), 2) for m, v in by_m.items() if v}


def _rpe_by_muscle(conn, as_of, weeks=3):
    """Per-muscle RPE fatigue inputs over a window. For each exercise-session it
    takes the RPE on the heaviest (top) set - how close to failure the working
    effort was - and the within-session RPE creep measured ONLY across sets held
    within tol of that top load (so lighter back-off sets don't masquerade as
    fatigue, mirroring the rep drop-off guard). Both are effort reads independent
    of the lift's own e1RM momentum, so they belong in the leakage-free fatigue
    half. Returns {muscle: {mean_top_rpe, creep, n_sets}}."""
    tol = config.settings().get("dropoff_same_load_tol", 0.10)
    start = (dates.from_iso(as_of + "T00:00:00") - timedelta(weeks=weeks)).strftime("%Y-%m-%d")
    rows = conn.execute(
        """SELECT start_time, exercise_title, primary_muscle, set_index,
                  reps_clean, weight_raw, rpe
           FROM sets WHERE is_working=1 AND rpe IS NOT NULL
             AND date > ? AND date <= ? ORDER BY start_time, exercise_title, set_index""",
        (start, as_of)).fetchall()
    groups = defaultdict(lambda: {"rpe": [], "w": []})
    for r in rows:
        g = groups[(r["start_time"], r["exercise_title"], r["primary_muscle"])]
        g["rpe"].append(r["rpe"])
        g["w"].append(r["weight_raw"])
    tops = defaultdict(list)
    creeps = defaultdict(list)
    counts = defaultdict(int)
    for (_, _, muscle), g in groups.items():
        rpe, w = g["rpe"], g["w"]
        counts[muscle] += len(rpe)
        wmax = max((x for x in w if x is not None), default=None)
        if wmax is not None and wmax > 0:
            # working-load cluster: sets within tol of the heaviest set (so
            # lighter back-offs don't dilute the effort or fake creep)
            kept = [rp for ww, rp in zip(w, rpe)
                    if ww is not None and abs(ww - wmax) <= tol * wmax]
        else:
            kept = rpe
        if kept:
            tops[muscle].append(max(kept))      # how close to failure it got
            if len(kept) >= 2:
                creeps[muscle].append(kept[-1] - kept[0])
    out = {}
    for muscle in counts:
        out[muscle] = {
            "mean_top_rpe": round(statistics.mean(tops[muscle]), 2) if tops[muscle] else None,
            "creep": round(statistics.mean(creeps[muscle]), 2) if creeps[muscle] else None,
            "n_sets": counts[muscle],
        }
    return out


def _rpe_signal(info, rp):
    """Map recent RPE behavior to a fatigue signal in [-1, +0.3] (high effort /
    rising within-session RPE -> negative -> fatigued; lots in reserve -> mild
    positive), or None when too little RPE is logged for this muscle yet. None
    drops the term so the score stays performance-based and byte-identical to the
    pre-RPE history."""
    cfg = rp.get("rpe_signal", {})
    if not info or info.get("mean_top_rpe") is None or \
            info.get("n_sets", 0) < cfg.get("min_sets", 2):
        return None
    neutral, hard, light = cfg.get("neutral", 8.0), cfg.get("hard", 10.0), cfg.get("light", 6.0)
    m = info["mean_top_rpe"]
    if m >= neutral:
        s_level = -_clip((m - neutral) / (hard - neutral), 0, 1)
    else:
        s_level = 0.3 * _clip((neutral - m) / (neutral - light), 0, 1)
    creep = info.get("creep")
    if creep is None:
        return round(_clip(s_level, -1, 0.3), 2)
    s_creep = -_clip(creep / cfg.get("creep_bad", 2.0), 0, 1)
    blend = cfg.get("creep_blend", 0.4)
    return round(_clip((1 - blend) * s_level + blend * s_creep, -1, 0.3), 2)


def _recovery_weights(w, rpe_on):
    """Legacy perf/acwr/dropoff/rpe weighting. SUPERSEDED in the live recovery
    score by `_form_recovery_weights` (design 01 section 5.1 replaced the
    acwr+dropoff fatigue sub-read with Form); retained as the documented
    renormalization reference. RPE is an optional 4th input: when present it
    takes a `rpe` fraction of the blend while perf/acwr/dropoff keep their
    relative ratio inside the remaining (1 - rpe); when absent the three
    renormalize to sum to 1 - reproducing the original perf/acwr/dropoff score
    exactly (e.g. 0.5/0.3/0.2)."""
    base = {"perf": w["perf"], "acwr": w["acwr"], "dropoff": w["dropoff"]}
    s = base["perf"] + base["acwr"] + base["dropoff"]
    wr = w.get("rpe", 0.0)
    if s <= 0:
        return {"perf": 0.0, "acwr": 0.0, "dropoff": 0.0, "rpe": 0.0}
    if not rpe_on or wr <= 0:
        return {k: v / s for k, v in base.items()} | {"rpe": 0.0}
    return {k: v / s * (1 - wr) for k, v in base.items()} | {"rpe": wr}


def _form_recovery_weights(w, rpe_on):
    """Form-era recovery weights. Momentum (perf) keeps its share; the whole
    load-fatigue share now goes to FORM (replacing the old acwr+dropoff split);
    RPE, when present, takes its configured fraction out of the fatigue half.
    Reduces to perf + Form when no RPE is logged. perf+form+rpe always sum to 1."""
    perf = w["perf"]
    wr = w.get("rpe", 0.0) if rpe_on else 0.0
    form_w = max(0.0, 1.0 - perf - wr)
    return {"perf": perf, "form": form_w, "rpe": wr}


def _muscle_form_z(conn, muscle, as_of, fcfg):
    """Today's Form z-score for a muscle vs its OWN Form history (design 1.4), as
    of `as_of`. Pure load -> gap-robust, no peek (Form is the pre-update trace).
    A zero-load sentinel at `as_of` extends the daily walk through today, so rest
    days since the last session decay the traces toward 'fresh' - the readiness
    you'd actually act on this morning. Returns (z, state), or (None, None) when
    there isn't enough Form history."""
    loads = form.daily_muscle_load(conn, muscle) + [(as_of, 0.0)]
    series = form.form_series(loads, fcfg["tau_fit"], fcfg["tau_fat"])
    hist = [f for d, _c, _a, f in series if d <= as_of]
    if len(hist) < 3:
        return None, None
    state, z = form.readiness_from_form(hist[-1], hist,
                                        fcfg["z_well"], fcfg["z_under"])
    return z, state


def active_recovery_params(rp):
    """Weights + cutoffs honoring the calibration gate. In 'apply' mode a
    user-filled `calibrated` block overrides the hand-set priors; in the default
    'advisory' mode nothing changes (we only report the suggestion elsewhere)."""
    w, cut = rp["weights"], rp["cutoffs"]
    if rp.get("calibration_mode") == "apply":
        cal = rp.get("calibrated") or {}
        w = cal.get("weights", w)
        cut = cal.get("cutoffs", cut)
    return w, cut


def recovery_by_muscle(conn, as_of, prog_map, acwr_by_muscle):
    """Graded, data-gated recovery per muscle. Returns a score in [-1,+1] and a
    state, plus its momentum (the lift's own trend) and fatigue sub-reads kept
    separate so the genuinely-independent fatigue signal can be judged on its own.
    The fatigue half is now the load-based FORM z-score (+ RPE) - gap-robust and
    the read the leakage-free backtest validates - replacing the old ACWR +
    drop-off blend (design 01 section 5.1). ACWR is still reported (and still
    drives the hard-spike override in recommend), but no longer feeds the graded
    score. Muscles without enough recent data return 'insufficient_data' rather
    than guessing off stale trends."""
    rp = config.priors()["recovery"]
    fcfg = form._form_cfg()
    w, cutoffs = active_recovery_params(rp)
    perf = _perf_by_muscle(prog_map)
    drop = _dropoff_by_muscle(conn, as_of)
    rpe_map = _rpe_by_muscle(conn, as_of)
    last = {r["primary_muscle"]: r["d"] for r in conn.execute(
        """SELECT primary_muscle, MAX(date) d FROM sets WHERE is_working=1
           GROUP BY primary_muscle""")}
    as_of_dt = dates.from_iso(as_of + "T00:00:00")

    out = {}
    for muscle in config.landmarks()["muscles"]:
        a = acwr_by_muscle.get(muscle)
        d = drop.get(muscle)
        pf = perf.get(muscle)
        days = ((as_of_dt - dates.from_iso(last[muscle] + "T00:00:00")).days
                if muscle in last else 9999)
        gated = (not pf) or pf["trend"] < rp["min_trend_lifts"] or days > rp["gate_days"]
        if gated:
            out[muscle] = {"recovery": "insufficient_data", "score": None,
                           "signals": ["not enough recent data to judge recovery"],
                           "median_slope": None, "acwr": a, "dropoff": d}
            continue
        sp = (pf["prog"] - pf["decl"]) / pf["trend"]          # [-1,+1]
        fz, fstate = _muscle_form_z(conn, muscle, as_of, fcfg)
        sform = _form_signal(fz, fcfg.get("signal_scale", 2.0))  # None until enough Form
        ri = rpe_map.get(muscle)
        sr = _rpe_signal(ri, rp)                               # None until enough RPE
        wn = _form_recovery_weights(w, sr is not None)
        # Form is the load-based fatigue read (design 5.1); when there isn't enough
        # Form history yet it reads neutral (0) rather than guessing.
        sf = sform if sform is not None else 0.0
        score_raw = wn["perf"] * sp + wn["form"] * sf
        if sr is not None:
            score_raw += wn["rpe"] * sr
        score = round(_clip(score_raw, -1, 1), 2)
        # Keep the two halves separate: momentum is the lift's own trend (which
        # autocorrelates with future change, so it's leakage-prone); fatigue is the
        # load-based Form (+ RPE) read - the part the leakage-free backtest validates.
        momentum = round(sp, 2)
        fdenom = wn["form"] + (wn["rpe"] if sr is not None else 0)
        fnum = wn["form"] * sf + (wn["rpe"] * sr if sr is not None else 0)
        fatigue = (round(_clip(fnum / fdenom, -1, 1), 2) if fdenom > 0 else None)
        state = ("recovering_well" if score >= cutoffs["well"]
                 else "under_recovering" if score <= cutoffs["under"]
                 else "borderline")
        signals = []
        if pf["decl"]:
            signals.append(f"{pf['decl']} lift(s) declining")
        elif pf["prog"]:
            signals.append(f"{pf['prog']}/{pf['trend']} lift(s) progressing")
        if fstate == "under_recovering":
            signals.append(f"load-fatigue elevated (Form z {fz})")
        elif fstate == "recovering_well":
            signals.append(f"load freshness high (Form z {fz})")
        if a is not None and a > rp["acwr_high"]:
            signals.append(f"load spiking (ACWR {a})")
        elif a is not None and a < rp["acwr_low"]:
            signals.append(f"load light (ACWR {a})")
        if d is not None and d >= rp["dropoff_bad"]:
            signals.append(f"high rep drop-off ({int(d*100)}%)")
        rsig = rp.get("rpe_signal", {})
        if sr is not None and ri:
            mt = ri.get("mean_top_rpe")
            if mt is not None and mt >= rsig.get("hard_flag", 9.3):
                signals.append(f"training near failure (avg top RPE {mt})")
            cr = ri.get("creep")
            if cr is not None and cr >= rsig.get("creep_bad", 2.0) * 0.6:
                signals.append(f"RPE climbing within sessions (+{cr})")
            elif mt is not None and mt < rsig.get("neutral", 8.0):
                signals.append(f"reps in reserve (avg top RPE {mt})")
        out[muscle] = {"recovery": state, "score": score, "signals": signals,
                       "momentum": momentum, "fatigue": fatigue, "rpe": sr,
                       "mean_rpe": ri.get("mean_top_rpe") if ri else None,
                       "form_z": fz, "form_state": fstate,
                       "median_slope": round(statistics.median(pf["slopes"]), 2),
                       "acwr": a, "dropoff": d}
    return out


# --------------------------------------------------------------------------
# Confidence: how much should we trust the recovery read at all?
# --------------------------------------------------------------------------
def confidence_from_validity(rec_acc, rp=None):
    """Map the walk-forward recovery-validity result to a trust level + basis.
    Keys off the LEAKAGE-FREE correlation, not the full score (which is inflated
    by the lift's own momentum). Prefers the Form-model detrended correlation
    (`corr_form_vs_residual`, design 01 section 2) when present, falling back to
    the older fatigue-signal key for backward compatibility. Returns (level,
    basis)."""
    rp = rp or config.priors()["recovery"]
    cf = rp.get("confidence", {"min_n": 8, "corr_moderate": 0.2, "corr_high": 0.35})
    if not rec_acc:
        # Not evaluated by this caller - keep today's behavior, don't overreach.
        return "moderate", "recovery confidence not evaluated"
    n = rec_acc.get("n", 0)
    if n < cf["min_n"]:
        return "low", f"only {n} validation window(s) so far - leaning on volume landmarks"
    corr = rec_acc.get("corr_form_vs_residual",
                       rec_acc.get("corr_fatigue_signals_vs_next_change"))
    mono = rec_acc.get("monotone_ordering")
    if corr is None:
        return "low", "recovery signal not yet predictive on your data - leaning on landmarks"
    if corr >= cf["corr_high"] and mono:
        return "high", f"recovery has tracked outcomes on your data (r={corr})"
    if corr >= cf["corr_moderate"]:
        return "moderate", f"recovery is weakly predictive on your data (r={corr})"
    return "low", (f"recovery signal is low-confidence on your data (r={corr}) - "
                   "leaning on volume landmarks; log RPE to sharpen it")


# --------------------------------------------------------------------------
# Set recommendation per muscle (the core of the user's request)
# --------------------------------------------------------------------------
def _decide(cur, mev, mav, mrv, recovery, confidence="high"):
    """Return (target_sets, action, reason). Recovery gates every increase.

    When `confidence == "low"` the recovery read is barely better than noise on
    this user's data, so we fall back to VOLUME LANDMARKS: ramp below MEV, hold
    inside the productive bands rather than adding/cutting on a weak signal, and
    deload only when actually at/over MRV. (A separate, better-validated hard
    ACWR spike can still force a cut in recommend().)"""
    cur_r = round(cur)
    low = confidence == "low"
    if cur < mev:
        if recovery == "under_recovering" and not low:
            return min(mev, cur_r + 2), "raise_gently", \
                "below MEV but fatigued - nudge up toward the minimum, don't jump"
        return mev, "raise_to_MEV", "below the minimum effective dose - bring up to MEV"
    if cur < mav:
        if low:
            return cur_r, "hold", \
                "productive zone - holding; recovery read is low-confidence, going by landmarks"
        if recovery == "recovering_well":
            return min(mav, cur_r + 2), "add", "recovering well and below MAV - add sets"
        if recovery in ("under_recovering",):
            return max(mev, cur_r - 1), "reduce", \
                "recovery is poor - hold/cut sets instead of adding (your rule)"
        return cur_r, "hold", "in the productive zone - hold and let performance catch up"
    if cur < mrv:
        if low:
            return cur_r, "hold", \
                "high volume - holding; recovery low-confidence, watch fatigue"
        if recovery == "recovering_well":
            return min(mrv, cur_r + 1), "add_cautious", "near your ceiling but recovering - small bump ok"
        if recovery == "under_recovering":
            return max(mav, cur_r - 2), "reduce", "high volume + poor recovery - pull back toward MAV"
        return cur_r, "hold", "high volume - hold, watch recovery"
    return mav, "deload", "at/over MRV - cut back toward MAV to recover"


def recommend(conn, as_of, prog_map, fatigue_obj, muscle_detail,
              recovery_accuracy=None):
    s = config.settings()
    max_up = s["max_weekly_set_increase"]
    max_dn = s["max_weekly_set_decrease"]
    basis = s.get("volume_gating_basis", "ewma")
    spike = s.get("acwr_spike", 1.5)
    rec = recovery_by_muscle(conn, as_of, prog_map,
                             fatigue_obj.get("acwr_by_muscle", {}))
    # How much to trust the recovery read at all (measured, not assumed).
    conf, conf_basis = confidence_from_validity(recovery_accuracy)
    out = []
    for muscle, d in muscle_detail.items():
        if d.get("mev") is None:
            continue
        # "Current" is the recency-aware EWMA (robust to one empty/surge week);
        # the flat 4-wk mean is still reported as the "typical" reference.
        cur = (d.get("sets_per_week_ewma", d["sets_per_week"])
               if basis == "ewma" else d["sets_per_week"])
        r = rec[muscle]["recovery"]
        score = rec[muscle].get("score")
        # A muscle with no usable recovery read is itself low-confidence.
        m_conf = "low" if r == "insufficient_data" else conf
        final, action, reason = _decide(cur, d["mev"], d["mav"], d["mrv"], r, m_conf)
        # Even in low-confidence/landmark mode, a hard per-muscle load spike (a
        # far better-validated fatigue trigger than the composite) can force a cut.
        # This ACWR is now the GATE-protected value (roadmap #3): None on a thin
        # post-gap base, so a phantom spike can no longer cut real volume.
        acwr = rec[muscle].get("acwr")
        if (m_conf == "low" and acwr is not None and acwr > spike
                and cur >= d["mev"] and action in ("hold", "add", "add_cautious")):
            spiked = max(d["mev"], round(cur) - 2)
            if spiked < round(cur):
                final, action = spiked, "reduce"
                reason = (f"load spiking (ACWR {acwr}) - cut back even though the "
                          "recovery read itself is low-confidence")
        # Gradual ramp, scaled by how well you're recovering: a strong score
        # earns the full step, a marginal one earns +1.
        base = round(cur)
        cap_up = max_up
        if action == "add" and score is not None and score > 0:
            cap_up = max(1, round(max_up * score))
        if final > cur:
            nxt = min(final, base + cap_up)
        elif final < cur:
            nxt = max(final, base - max_dn)
        else:
            nxt = base
        ramping = nxt != final
        if ramping and final > cur:
            reason += f" - ramp gradually toward {final} over a few weeks"
        out.append({
            "muscle": muscle, "current_sets": cur, "target_sets": nxt,
            "current_sets_4wk": d["sets_per_week"],
            "current_sets_recent": d.get("sets_recent_7d"),
            "active_weeks_4wk": d.get("active_weeks_4wk"),
            "final_target": final, "ramping": ramping,
            "delta": round(nxt - cur), "action": action, "recovery": r,
            "recovery_score": score, "momentum": rec[muscle].get("momentum"),
            "fatigue": rec[muscle].get("fatigue"), "rpe": rec[muscle].get("rpe"),
            "mean_rpe": rec[muscle].get("mean_rpe"), "confidence": m_conf,
            "form_z": rec[muscle].get("form_z"), "signals": rec[muscle]["signals"],
            "reason": reason, "status": d["status"],
        })
    # surface the actionable ones first: increases you've earned, then cuts, then holds
    rank = {"add": 0, "add_cautious": 1, "raise_to_MEV": 2, "raise_gently": 3,
            "reduce": 4, "deload": 5, "hold": 6}
    out.sort(key=lambda x: (rank.get(x["action"], 9), -abs(x["delta"])))
    return {"recovery": rec, "recommendations": out,
            "recovery_confidence": conf, "recovery_confidence_basis": conf_basis}
