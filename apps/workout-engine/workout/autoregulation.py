"""Double-progression autoregulation -> next-session weight x reps targets.

Works without RPE (decisions from performance vs the goal rep range). When RPE
is present it gates load increases on having reps in reserve.
"""
from . import config, progression, individualize as ind, conformal


def prediction_for(conn, ex, epoch, weight, groups=None, cq=None):
    """Predicted reps (+range) at a weight. Anchors on the most recent top set
    and adjusts for the load change via the personal slope (backtested to beat
    a naive 'same as last time' baseline). Available whenever there's a recent
    top set; the load-rep slope sharpens it once the model is fitted. For a weak
    or starved lift it borrows the exercise-type slope (design 02 pooling) so the
    prediction stops collapsing to 'same reps as last time'."""
    a = ind.analyze_exercise(conn, ex, epoch, groups)
    last = conn.execute(
        """SELECT weight_raw w, reps_clean r, rpe FROM sets
           WHERE exercise_title=? AND epoch=? AND is_working=1 AND set_index=0
             AND weight_raw IS NOT NULL AND reps_clean IS NOT NULL
           ORDER BY date DESC LIMIT 1""", (ex, epoch)).fetchone()
    if not last:
        return None
    pooled = None
    if (ind._rep_pooling_cfg()["enabled"] and a["slope_apply"]
            and a["pooled_slope"] is not None):
        pooled = (a["pooled_slope"], a["pooled_resid_std"])
    # design 05: when the anchor set has a reliable RPE, predict the reps the user
    # will PERFORM at their intended effort (capacity - target RIR); otherwise the
    # capacity is censored and this is byte-identical to the raw-reps path.
    at_effort = False
    trir = None
    if ind._rir_rep_cfg()["enabled"]:
        trir = ind.target_rir(conn, ex, epoch)
        eff = ind.predict_reps_at_effort(a["model"], last["w"], last["r"],
                                         last["rpe"], weight, trir, pooled=pooled)
        if not eff:
            return None
        pt, lo, hi, at_effort = eff
    else:
        ap = ind.predict_reps_anchored(a["model"], last["w"], last["r"], weight, pooled=pooled)
        if not ap:
            return None
        pt, lo, hi = ap
    # design 06: replace the Gaussian +-1.96*se band with a calibrated, distribution-
    # free conformal interval (the POINT estimate is untouched). q_g is the lift's
    # Mondrian-by-type conformal quantile; an orphan type (q_g None) keeps the
    # Gaussian band but is flagged uncalibrated rather than silently trusted.
    interval_kind = None
    ccfg = conformal._conformal_cfg()
    if ccfg["enabled"]:
        if cq is None:
            cq = ind.rep_conformal_quantiles(conn, groups=groups)
        q_g = conformal.lookup(cq, ind.ex_type(ex))
        scale = ind._norm_scale(a["model"], weight) if ccfg["normalized"] else 1.0
        band = conformal.conformal_interval(pt, q_g, scale=scale, clamp=(1.0, 20.0))
        if band is not None:
            lo, hi, interval_kind = band[0], band[1], "conformal"
        else:
            interval_kind = "uncalibrated"
    if pooled is not None:
        basis = (f"borrowed {ind.ex_type(ex)} curve" if a["slope_basis"] == "borrowed"
                 else "shrunk personal model")
        conf = (a["borrowed_confidence"] if a["slope_basis"] == "borrowed"
                else a["confidence"])
    else:
        basis = "personal model" if a["model"] else "recent performance"
        conf = a["confidence"]
    if at_effort:
        basis += f" · at RIR {trir:g}"
    out = {"reps": round(pt, 1), "lo": round(max(0.0, lo), 1), "hi": round(hi, 1),
           "confidence": conf, "grace": a["grace_state"], "basis": basis}
    if at_effort:
        out["at_effort"] = True
        out["target_rir"] = round(trir, 1)
    if interval_kind:
        out["interval"] = interval_kind
    return out


def weight_verdict(conn, ex, epoch, weight, groups=None):
    """Is this weight good for the user's goal rep range? Uses the personal model."""
    lo, hi = config.settings()["goal_rep_range"]
    pred = prediction_for(conn, ex, epoch, weight, groups)
    if not pred:
        return {"verdict": "unknown", "prediction": None,
                "note": "Still learning this lift - log a few more sets (or a "
                        "calibration set) to predict reps."}
    r = pred["reps"]
    if r > hi + 1:
        v = "too_light"
    elif r < lo:
        v = "too_heavy"
    else:
        v = "good"
    return {"verdict": v, "prediction": pred,
            "note": {"good": f"In your {lo}-{hi} target (~{r} reps predicted).",
                     "too_light": f"Likely ~{r} reps - lighter than your {lo}-{hi} target; add load.",
                     "too_heavy": f"Likely ~{r} reps - heavier than your {lo}-{hi} target."}[v]}


def _increment(equipment):
    s = config.settings()
    return s["increment_overrides"].get(equipment, s["default_increment_kg"])


def _last_session(conn, ex, epoch):
    d = conn.execute(
        """SELECT MAX(date) d FROM sets WHERE exercise_title=? AND epoch=?
           AND is_working=1""", (ex, epoch)).fetchone()["d"]
    if not d:
        return None, []
    rows = conn.execute(
        """SELECT weight_raw, reps_clean, rpe, set_index FROM sets
           WHERE exercise_title=? AND epoch=? AND date=? AND is_working=1
           ORDER BY set_index""", (ex, epoch, d)).fetchall()
    return d, rows


def _last_top_rpe(conn, ex, epoch):
    """RPE of the heaviest (top-load) working sets of the last session, returned
    as (easiest, hardest) = (min, max) RPE across those top sets, or None. The
    easiest drives the load gate (did any top set leave reserve?); the hardest
    guards the bigger jump (don't double-load off one fluke-easy set)."""
    _, rows = _last_session(conn, ex, epoch)
    work = [r for r in rows if r["weight_raw"] is not None]
    if not work:
        return None
    w_top = max(r["weight_raw"] for r in work)
    rpes = [r["rpe"] for r in work
            if abs(r["weight_raw"] - w_top) < 1e-9 and r["rpe"] is not None]
    return (min(rpes), max(rpes)) if rpes else None


def _base_target(conn, ex, prog):
    lo, hi = config.settings()["goal_rep_range"]
    info = config.exercise_info(ex)
    epoch = prog["epoch"]
    date, rows = _last_session(conn, ex, epoch)
    work = [r for r in rows if r["weight_raw"] is not None]
    if not work:
        return {"rec_type": "hold", "sets": [], "rationale":
                "Bodyweight/unloaded lift - add reps, then a load when easy."}

    w_top = max(r["weight_raw"] for r in work)
    top_sets = [r for r in work if abs(r["weight_raw"] - w_top) < 1e-9]
    reps_at_top = [r["reps_clean"] for r in top_sets if r["reps_clean"] is not None]
    rpes = [r["rpe"] for r in top_sets if r["rpe"] is not None]
    n_sets = max(len(top_sets), 2)
    if not reps_at_top:
        return {"rec_type": "hold", "sets": [], "rationale": "No clean reps logged last time."}
    min_reps = min(reps_at_top)
    inc = _increment(info.get("equipment", "other"))
    s = config.settings()
    min_rir = s.get("progression_min_rir", 2.0)
    big_rir = s.get("progression_big_jump_rir", 4.0)
    # RPE autoregulates the jump: the easiest top set must leave >= min_rir to add
    # load at all; if even the HARDEST top set left >= big_rir, earn a double jump.
    rir_easy = (10.0 - min(rpes)) if rpes else None   # most reserve shown
    rir_hard = (10.0 - max(rpes)) if rpes else None   # least reserve shown
    has_reserve = (rir_easy is None) or (rir_easy >= min_rir)

    if min_reps >= hi and has_reserve:
        steps = 2 if (rir_hard is not None and rir_hard >= big_rir) else 1
        new_w = round(w_top + inc * steps, 2)
        if not rpes:
            gate = ""
        elif steps == 2:
            gate = f" (RPE {max(rpes):g}, ~{rir_hard:g} in reserve - room for a bigger jump)"
        else:
            gate = f" (RPE {min(rpes):g}, reps in reserve)"
        return {"rec_type": "progress", "weight": new_w, "reps": lo, "n_sets": n_sets,
                "sets": [{"weight": new_w, "reps": lo} for _ in range(n_sets)],
                "rationale": f"Hit {min_reps} reps (top of range) at {w_top:g}{gate} - "
                             f"add {'two steps of ' if steps == 2 else ''}load and reset to {lo} reps."}
    if min_reps >= hi and not has_reserve:
        return {"rec_type": "hold", "weight": w_top, "reps": hi, "n_sets": n_sets,
                "sets": [{"weight": w_top, "reps": hi} for _ in range(n_sets)],
                "rationale": f"Hit top reps but at high RPE ({max(rpes):g}) - repeat {w_top:g} "
                             f"cleaner before adding load."}
    if min_reps >= lo:
        return {"rec_type": "hold", "weight": w_top, "reps": min(min_reps + 1, hi),
                "n_sets": n_sets,
                "sets": [{"weight": w_top, "reps": min(min_reps + 1, hi)} for _ in range(n_sets)],
                "rationale": f"In range ({min_reps} reps at {w_top:g}) - keep the load, "
                             f"chase {min(min_reps + 1, hi)} reps."}
    # Below the range
    if prog["status"] == "declining":
        new_w = round(w_top * 0.9, 2)
        return {"rec_type": "deload", "weight": new_w, "reps": hi, "n_sets": n_sets,
                "sets": [{"weight": new_w, "reps": hi} for _ in range(n_sets)],
                "rationale": f"Only {min_reps} reps and trend is down - deload to {new_w:g} "
                             f"and rebuild."}
    return {"rec_type": "hold", "weight": w_top, "reps": lo, "n_sets": n_sets,
            "sets": [{"weight": w_top, "reps": lo} for _ in range(n_sets)],
            "rationale": f"Below range ({min_reps} reps) - repeat {w_top:g} and consolidate {lo}+ reps."}


def next_target(conn, ex, prog, groups=None, cq=None):
    """Base double-progression target, enriched with an individualized rep
    prediction at the recommended weight when the personal model can predict it."""
    t = _base_target(conn, ex, prog)
    w = t.get("weight")
    if w is not None:
        pred = prediction_for(conn, ex, prog["epoch"], w, groups, cq)
        if pred:
            t["predicted_reps"] = pred["reps"]
            t["predicted_range"] = [pred["lo"], pred["hi"]]
            t["prediction_confidence"] = pred["confidence"]
            t["prediction_basis"] = pred["basis"]
            if pred.get("at_effort"):           # design 05: predicted at intended effort
                t["predicted_at_rir"] = pred["target_rir"]
            if pred.get("interval"):            # design 06: conformal vs gaussian band
                t["predicted_interval"] = pred["interval"]
    # Surface the RPE that drove the load decision (hardest top set of last
    # session) so the Strength tab can show RPE is actively autoregulating.
    rpe_pair = _last_top_rpe(conn, ex, prog["epoch"])
    if rpe_pair is not None:
        t["last_rpe"] = rpe_pair[1]
        t["last_reserve"] = round(10.0 - rpe_pair[1], 1)
    return t
