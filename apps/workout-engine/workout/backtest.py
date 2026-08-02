"""Walk-forward accuracy measurement. Nothing here mutates the store.

Replays history using ONLY data available at each point, then compares the
tool's predictions to what actually happened:
  - rep-prediction error (vs a naive "same as last time" baseline)
  - recovery validity: does a higher recovery read predict better subsequent
    performance? (the core test that recovery scoring is accurate)
  - forecast error: predicted vs realized e1RM weeks later
"""
import math
import statistics
from collections import defaultdict
from . import (config, dates, individualize as ind, trend, volume, compare,
               fatigue, form, forecast as fc, conformal)


def _pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mx, my = statistics.mean(xs), statistics.mean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = sum((x - mx) ** 2 for x in xs)
    dy = sum((y - my) ** 2 for y in ys)
    if dx <= 0 or dy <= 0:
        return None
    return round(num / (dx ** 0.5 * dy ** 0.5), 3)


def _exercises(conn):
    return [r["exercise_title"] for r in conn.execute(
        "SELECT DISTINCT exercise_title FROM sets WHERE is_working=1")]


def _cur_epoch(conn, ex):
    return conn.execute("SELECT MAX(epoch) e FROM sets WHERE exercise_title=?",
                        (ex,)).fetchone()["e"] or 0


def _fresh_series(conn, ex, epoch):
    rows = conn.execute(
        """SELECT date, weight_raw w, reps_clean r FROM sets
           WHERE exercise_title=? AND epoch=? AND is_working=1 AND set_index=0
             AND weight_raw IS NOT NULL AND reps_clean BETWEEN 1 AND 20
           ORDER BY date""", (ex, epoch)).fetchall()
    return [(x["date"], x["w"], x["r"]) for x in rows]


def _fresh_series_rpe(conn, ex, epoch):
    """First working set per session (chronological) with rpe, for the design-04
    heavy-extrapolation walk-forward. Separate from _fresh_series (which other
    tracks unpack as 3-tuples) so adding rpe doesn't disturb them."""
    rows = conn.execute(
        """SELECT date, weight_raw w, reps_clean r, rpe FROM sets
           WHERE exercise_title=? AND epoch=? AND is_working=1 AND set_index=0
             AND weight_raw IS NOT NULL AND reps_clean BETWEEN 1 AND 20
           ORDER BY date""", (ex, epoch)).fetchall()
    return [(x["date"], x["w"], x["r"], x["rpe"]) for x in rows]


def _e1rm_series(conn, ex, epoch):
    rows = conn.execute(
        """SELECT date, MAX(e1rm) e FROM sets WHERE exercise_title=? AND epoch=?
             AND e1rm IS NOT NULL GROUP BY date ORDER BY date""", (ex, epoch))
    return [(r["date"], r["e"]) for r in rows]


# --------------------------------------------------------------------------
def rep_prediction(conn):
    """Walk-forward: fit on prior fresh sets, predict the next session's top-set
    reps, compare to actual. Baseline = predict last session's reps."""
    s = config.settings()
    minp = s["forecast_min_points"]
    err, base_err = [], []
    eligible = covered = 0
    for ex in _exercises(conn):
        pts = _fresh_series(conn, ex, _cur_epoch(conn, ex))
        for i in range(minp, len(pts)):
            eligible += 1
            train = [(w, r) for _, w, r in pts[:i]]
            model = ind.fit_load_rep(train)
            last_load, last_reps = pts[i - 1][1], pts[i - 1][2]
            w_i, r_i = pts[i][1], pts[i][2]
            ap = ind.predict_reps_anchored(model, last_load, last_reps, w_i)
            if ap:
                err.append(abs(ap[0] - r_i))
                base_err.append(abs(last_reps - r_i))
                covered += 1
    if not err:
        return {"n": 0, "note": "not enough data"}
    return {"n": len(err), "eligible": eligible,
            "coverage_pct": round(100 * covered / eligible) if eligible else 0,
            "model_mae": round(statistics.mean(err), 2),
            "naive_mae": round(statistics.mean(base_err), 2),
            "beats_naive": statistics.mean(err) < statistics.mean(base_err)}


def _recovery_pairs(conn):
    """Walk-forward (score, fatigue-only-score, next-2wk-change) windows per
    muscle, using ONLY data available at each point. ACWR reuses the SAME
    fatigue.acwr the live recovery uses (so we validate the deployed signal),
    and drop-off uses the same same-load guard as volume."""
    rp = config.priors()["recovery"]
    w = rp["weights"]
    tol = config.settings().get("dropoff_same_load_tol", 0.10)
    full, fat_sig, outcomes, states = [], [], [], []
    for muscle in config.landmarks()["muscles"]:
        lift = compare.representative_lift(conn, muscle)
        if not lift:
            continue
        ser = _e1rm_series(conn, lift, _cur_epoch(conn, lift))
        if len(ser) < 6:
            continue
        volrows = conn.execute(
            """SELECT date, SUM(COALESCE(volume,0)) v FROM sets
               WHERE primary_muscle=? AND is_working=1 GROUP BY date""", (muscle,))
        vbd = {r["date"]: r["v"] for r in volrows}
        # per-session same-load drop-off for this muscle
        drows = conn.execute(
            """SELECT start_time, exercise_title, set_index, reps_clean, weight_raw
               FROM sets WHERE primary_muscle=? AND is_working=1
                 AND reps_clean IS NOT NULL
               ORDER BY start_time, exercise_title, set_index""", (muscle,))
        grp = defaultdict(lambda: {"reps": [], "w": []})
        for r in drows:
            g = grp[(r["start_time"], r["exercise_title"])]
            g["reps"].append(r["reps_clean"])
            g["w"].append(r["weight_raw"])
        drop_by_date = defaultdict(list)
        for (st, _), g in grp.items():
            do = volume.session_dropoff(g["w"], g["reps"], tol)
            if do is not None:
                drop_by_date[st[:10]].append(do)
        drop_by_date = {d: statistics.mean(v) for d, v in drop_by_date.items()}

        for i in range(3, len(ser) - 1):
            di, ei = ser[i]
            trail = ser[max(0, i - 4):i + 1]
            fit = trend.theil_sen([(k, v) for k, (_, v) in enumerate(trail)])
            sp = 1.0 if fit and fit["slope"] > 0.05 else -1.0 if fit and fit["slope"] < -0.05 else 0.0
            a = fatigue.acwr(vbd, di)
            recent_drops = [drop_by_date[d] for d, _ in ser[max(0, i - 3):i + 1]
                            if d in drop_by_date]
            d = statistics.mean(recent_drops) if recent_drops else None
            sa = volume._acwr_signal(a, rp)
            sd = volume._dropoff_signal(d, rp)
            fsc = volume._clip(w["acwr"] * sa + w["dropoff"] * sd, -1, 1)
            sc = volume._clip(w["perf"] * sp + w["acwr"] * sa + w["dropoff"] * sd, -1, 1)
            # outcome: next session within 21 days
            nxt = next(((dj, ej) for dj, ej in ser[i + 1:]
                        if (dates.from_iso(dj + "T00:00:00") -
                            dates.from_iso(di + "T00:00:00")).days <= 21), None)
            if not nxt:
                continue
            out = nxt[1] - ei
            full.append(sc); fat_sig.append(fsc); outcomes.append(out)
            states.append("well" if sc >= rp["cutoffs"]["well"]
                          else "under" if sc <= rp["cutoffs"]["under"] else "mid")
    return {"full": full, "fatigue": fat_sig, "outcomes": outcomes, "states": states}


def _fit_cutoffs(scores, outcomes, current):
    """Suggest well/under cutoffs from the score terciles and report whether
    they separate next-change outcomes better (bigger well-minus-under spread,
    monotone) than the current hand-set cutoffs. Advisory only."""
    n = len(scores)
    if n < 9:
        return None
    srt = sorted(scores)
    lo, hi = srt[n // 3], srt[2 * n // 3]

    def spread(well, under):
        g_well = [o for s, o in zip(scores, outcomes) if s >= well]
        g_under = [o for s, o in zip(scores, outcomes) if s <= under]
        g_mid = [o for s, o in zip(scores, outcomes) if under < s < well]
        if not g_well or not g_under:
            return None, False
        mono = (statistics.mean(g_well)
                >= (statistics.mean(g_mid) if g_mid else -1e9)
                >= statistics.mean(g_under))
        return statistics.mean(g_well) - statistics.mean(g_under), mono

    cur_spread, _ = spread(current["well"], current["under"])
    sug_spread, sug_mono = spread(hi, lo)
    improves = (sug_spread is not None and sug_mono
                and (cur_spread is None or sug_spread > cur_spread))
    return {"suggested": {"well": round(hi, 2), "under": round(lo, 2)},
            "current": {"well": current["well"], "under": current["under"]},
            "n": n,
            "current_spread": round(cur_spread, 2) if cur_spread is not None else None,
            "suggested_spread": round(sug_spread, 2) if sug_spread is not None else None,
            "improves_backtest": bool(improves)}


def recovery_validity(conn):
    """Test whether the recovery read predicts subsequent performance. Reports
    the correlation of the full score AND of the fatigue-only signals (ACWR +
    drop-off, excluding the lift's own trend to avoid leakage) with the next
    ~2-week e1RM change, mean outcome grouped by assigned state, plus a
    data-fitted cutoff suggestion (advisory)."""
    rp = config.priors()["recovery"]
    p = _recovery_pairs(conn)
    full, fat_sig, outcomes, states = (p["full"], p["fatigue"],
                                       p["outcomes"], p["states"])
    if len(outcomes) < 5:
        return {"n": len(outcomes), "note": "not enough paired windows"}
    by_state = defaultdict(list)
    for s_, o in zip(states, outcomes):
        by_state[s_].append(o)
    means = {k: round(statistics.mean(v), 2) for k, v in by_state.items()}
    monotone = means.get("well", 0) >= means.get("mid", -99) >= means.get("under", -99)
    return {"n": len(outcomes),
            "corr_full_score_vs_next_change": _pearson(full, outcomes),
            "corr_fatigue_signals_vs_next_change": _pearson(fat_sig, outcomes),
            "mean_next_change_by_state": means,
            "monotone_ordering": monotone,
            "suggested_cutoffs": _fit_cutoffs(full, outcomes, rp["cutoffs"])}


def _terciles_monotone(xs, ys):
    """mean(Y) across the low/mid/high X-terciles, and whether they rise
    monotonically (the design-section-2 'is a higher Form read followed by a
    better-than-trend outcome?' check). Returns (means, monotone) or (None, None)
    when too few pairs to split into thirds."""
    pairs = sorted(zip(xs, ys))
    n = len(pairs)
    if n < 6:
        return None, None
    lo = [y for _, y in pairs[:n // 3]]
    mid = [y for _, y in pairs[n // 3:2 * n // 3]]
    hi = [y for _, y in pairs[2 * n // 3:]]
    means = [round(statistics.mean(g), 3) for g in (lo, mid, hi)]
    return means, means[0] <= means[1] <= means[2]


def form_validity(conn):
    """Leakage-free test of the Fitness-Fatigue Form model (design section 2):
    does today's load-only Form predict the NEXT session's e1RM ABOVE its own
    recent trend? Both sides are detrended - the outcome is a residual vs the
    lift's PRIOR-only Theil-Sen trend (so a lift that is simply rising can't
    manufacture correlation) and the predictor is pure Form (no momentum). The
    per-lift windows come from form.leakage_free_pairs; here we just pool them,
    correlate, and grade against the PRE-REGISTERED bar (n>=min_n, r>=success_r,
    monotone terciles). Read-only - nothing here is wired into the live recovery
    read yet. An honest r~0 is the truth, not a bug: readiness isn't recoverable
    from load alone without HRV / bar velocity."""
    cfg = form._form_cfg()
    X, Y, per_muscle = [], [], {}
    for muscle in config.landmarks()["muscles"]:
        lift = compare.representative_lift(conn, muscle)
        if not lift:
            continue
        ser = _e1rm_series(conn, lift, _cur_epoch(conn, lift))
        if len(ser) < cfg["min_points"] + 1:
            continue
        fbd = form.form_by_date(form.daily_muscle_load(conn, muscle),
                                cfg["tau_fit"], cfg["tau_fat"])
        pairs = form.leakage_free_pairs(ser, fbd, cfg)
        if len(pairs) >= 3:
            per_muscle[muscle] = {"n": len(pairs),
                                  "r": _pearson([p[0] for p in pairs],
                                                [p[1] for p in pairs])}
        X.extend(p[0] for p in pairs)
        Y.extend(p[1] for p in pairs)
    if len(X) < cfg["min_n"]:
        return {"n": len(X), "note": "not enough leakage-free Form windows yet"}
    r = _pearson(X, Y)
    means, mono = _terciles_monotone(X, Y)
    return {"n": len(X),
            "corr_form_vs_residual": r,
            "resid_by_form_tercile": means,
            "monotone_ordering": mono,
            "success_bar": {"min_n": cfg["min_n"], "min_r": cfg["success_r"],
                            "require_monotone": True},
            "adopt_form_over_landmarks":
                bool(r is not None and r >= cfg["success_r"] and mono),
            "by_muscle": per_muscle}


def _pool_bucket():
    return {"n": 0, "naive": [], "pooled": [], "naive_cov": 0, "pooled_cov": 0}


def pooled_rep_prediction(conn):
    """Pre-registered validation of #2 (design 02 section 5): walk-forward
    rep-prediction MAE + ~95% interval coverage, NAIVE (current per-exercise
    behavior) vs PARTIALLY-POOLED slope, split by data-richness bucket. Pooling
    only touches weak/starved lifts (rich lifts keep their own slope, so the rich
    bucket is identical by construction) - the test is whether borrowing the
    exercise-TYPE slope cuts the STARVED bucket's error without hurting rich.
    Group slopes are cross-sectional (estimated from OTHER lifts), so using
    full-data mu_g to predict a given lift is not a temporal leak of its own
    future. Adoption is gated on the priors.rep_pooling bar."""
    s = config.settings()
    minp = s["forecast_min_points"]
    cfg = ind._rep_pooling_cfg()
    groups = ind.group_slopes(conn)
    # Buckets mirror LIVE behavior: a lift is "starved" (gets pooled in production)
    # iff its CURRENT full-data fit isn't personal-strong; "rich" lifts are never
    # pooled live, so their pooled == naive by construction (a sanity check).
    B = {"starved": _pool_bucket(), "rich": _pool_bucket()}
    for ex in _exercises(conn):
        pts = ind.fresh_points(conn, ex, _cur_epoch(conn, ex))
        if len(pts) <= minp:
            continue
        level = groups.get(ind.ex_type(ex)) or groups.get("__global__")
        live_pools = bool(level) and not ind._personal_strong(ind.fit_load_rep(pts), cfg)
        bk = B["starved" if live_pools else "rich"]
        for i in range(minp, len(pts)):
            fit = ind.fit_load_rep(pts[:i])            # prior-only fit (walk-forward)
            last_load, last_reps = pts[i - 1][0], pts[i - 1][1]
            w_i, r_i = pts[i][0], pts[i][1]            # fresh_points now carries rpe too
            nai = ind.predict_reps_anchored(fit, last_load, last_reps, w_i)
            pooled = None
            if live_pools:
                se = (fit["resid_std"] / math.sqrt(fit["ssx"])
                      if fit and fit.get("ssx", 0) > 0 and fit["resid_std"] > 0 else None)
                bstar, _ = ind.shrink_load_rep_slope(
                    fit["slope"] if fit else None, se, level["mu"], level["tau2"])
                rstd = fit["resid_std"] if (fit and fit["resid_std"] > 0) else level["resid_std"]
                pooled = (bstar, rstd)
            poo = ind.predict_reps_anchored(fit, last_load, last_reps, w_i, pooled=pooled)
            if not nai or not poo:
                continue
            bk["n"] += 1
            bk["naive"].append(abs(nai[0] - r_i))
            bk["pooled"].append(abs(poo[0] - r_i))
            bk["naive_cov"] += 1 if nai[1] <= r_i <= nai[2] else 0
            bk["pooled_cov"] += 1 if poo[1] <= r_i <= poo[2] else 0

    def fin(bk):
        if not bk["n"]:
            return {"n": 0}
        return {"n": bk["n"],
                "mae_naive": round(statistics.mean(bk["naive"]), 3),
                "mae_pooled": round(statistics.mean(bk["pooled"]), 3),
                "cov_naive": round(bk["naive_cov"] / bk["n"], 3),
                "cov_pooled": round(bk["pooled_cov"] / bk["n"], 3)}

    starved, rich = fin(B["starved"]), fin(B["rich"])
    adopt = (starved.get("n", 0) >= cfg["min_n_starved"]
             and starved.get("mae_pooled", 9e9) < starved.get("mae_naive", 0)
             and rich.get("mae_pooled", 0) <= rich.get("mae_naive", 9e9) + cfg["rich_tol"])
    return {"starved": starved, "rich": rich, "adopt_pooling": bool(adopt),
            "rule": f"starved n>={cfg['min_n_starved']} & MAE drops & rich MAE not worse (+{cfg['rich_tol']})"}


def heavy_extrapolation(conn):
    """Pre-registered validation of #4 (design 04 section 3): does the curvilinear
    (type-curve + anchor) model predict HELD-OUT HEAVY sets better than the linear
    extrapolation it would replace? Walk-forward per lift with an embargo; at each
    step fit BOTH models on prior data only, then score the future set in rep
    space against its reps-to-failure r* = reps + RIR (reliable RPE required, so
    the target is real):
        err = | r* - reps_pred(model, W) |
    Split by region: HEAVY = load above the fit window's max (the genuine
    extrapolation regime that exposes the line's overshoot - the primary metric);
    IN-BAND = inside the trained range (the no-regression guardrail). Linear uses
    predict_reps (the incumbent line); candidate uses the type curve s(W/M).

    HONEST: this bundles the curve SHAPE with the RIR anchor (#4 introduces RIR
    into the 1RM; the incumbent line has neither) - the comparison is vs what
    ships today, which is the right question for an adoption decision. The LIVE
    in-band rep predictor (predict_reps_anchored / #2 pooling) is NOT touched by
    #4, so that track is unchanged by construction. An honest null (too few heavy
    targets, or no improvement) keeps the linear model - nothing auto-ships."""
    s = config.settings()
    cv = ind._curvilinear_cfg()
    embargo = config.priors().get("form", {}).get("embargo_days", 3)
    minp = s["forecast_min_points"]
    heavy_lin, heavy_cur, inband_lin, inband_cur = [], [], [], []
    lift_heavy = defaultdict(int)
    for ex in _exercises(conn):
        etype = ind.ex_type(ex)
        pts = _fresh_series_rpe(conn, ex, _cur_epoch(conn, ex))
        if len(pts) <= minp:
            continue
        for i in range(minp, len(pts)):
            d_t, W_t, reps_t, rpe_t = pts[i]
            rstar, reliable = ind.failure_reps(reps_t, rpe_t)
            if not reliable or W_t is None or reps_t is None:
                continue                               # need a real to-failure target
            ti = dates.from_iso(d_t + "T00:00:00")
            train = [p for p in pts[:i]
                     if (ti - dates.from_iso(p[0] + "T00:00:00")).days > embargo]
            if len(train) < minp:
                continue
            tp = [(w, r, rp) for _, w, r, rp in train]
            max_x = max(w for _, w, _, _ in train)
            lin = ind.fit_load_rep(tp)
            anchor = ind.fit_anchor(tp, etype, cv)
            lin_pred = ind.predict_reps(lin, W_t)[0] if lin else None
            cur_pred = (ind.reps_at_load_spline(anchor, W_t)
                        if (anchor and anchor["basis"] == "fit") else None)
            if lin_pred is None or cur_pred is None:
                continue                               # only score where BOTH predict
            el, ec = abs(rstar - lin_pred), abs(rstar - cur_pred)
            if W_t > max_x:
                heavy_lin.append(el); heavy_cur.append(ec); lift_heavy[ex] += 1
            else:
                inband_lin.append(el); inband_cur.append(ec)

    def fin(lin, cur):
        if not lin:
            return {"n": 0}
        ml, mc = statistics.mean(lin), statistics.mean(cur)
        return {"n": len(lin), "mae_linear": round(ml, 3), "mae_curvilinear": round(mc, 3),
                "rel_improvement": round((ml - mc) / ml, 3) if ml > 0 else None}

    heavy, inband = fin(heavy_lin, heavy_cur), fin(inband_lin, inband_cur)
    adopt = (heavy.get("n", 0) >= cv["min_heavy_targets"]
             and heavy.get("rel_improvement") is not None
             and heavy["rel_improvement"] >= cv["adopt_min_rel_improve"]
             and (inband.get("rel_improvement") is None
                  or inband["rel_improvement"] >= -cv["adopt_max_inband_regress"]))
    return {"heavy": heavy, "inband": inband,
            "lifts_with_heavy_targets": len(lift_heavy),
            "adopt_curvilinear": bool(adopt),
            "rule": (f"heavy n>={cv['min_heavy_targets']} & curvilinear cuts heavy rep-MAE "
                     f">={int(cv['adopt_min_rel_improve']*100)}% & in-band not worse by "
                     f">{int(cv['adopt_max_inband_regress']*100)}%"),
            "note": ("scores reps-to-failure r*; bundles curve shape + RIR anchor vs the "
                     "incumbent no-RIR line; in-band LIVE prediction is unchanged by #4")}


def effort_rep_prediction(conn):
    """Pre-registered validation of #5 (design 05 section 3): does predicting
    PERFORMED reps as capacity(W) - target_RIR beat the raw-reps anchored
    predictor? Walk-forward per lift; at each step fit the slope on PRIOR fresh
    sets, anchor on the PREVIOUS session's (load, reps, rpe), and compute
    target_RIR from prior reliable RPE only (no leak). The target is apples-to-
    apples: the reps the user actually LOGGED (performed), since that is what
    both models predict. Split by ERA via the ANCHOR set: RECENT = the anchor has
    a reliable RIR (the capacity/effort path engages, so the prediction can
    differ); LEGACY = no reliable RIR (the effort predictor is byte-identical to
    the baseline by construction - a sanity check, not a win). Also reports the
    effort-offset calibration: mean target_RIR vs mean ACTUAL RIR on the recent
    target sets (the offset must be unbiased). Adoption gated on the
    priors.rir_rep_model bar. An honest null (consistent-RIR logging makes the
    shift ~0, or too few recent targets) keeps the raw-reps predictor live."""
    s = config.settings()
    minp = s["forecast_min_points"]
    cfg = ind._rir_rep_cfg()
    default_rir = s.get("progression_min_rir", 2.0)
    B = {"recent": {"base": [], "eff": []}, "legacy": {"base": [], "eff": []}}
    tgt_rirs, act_rirs = [], []
    for ex in _exercises(conn):
        pts = _fresh_series_rpe(conn, ex, _cur_epoch(conn, ex))
        if len(pts) <= minp:
            continue
        for i in range(minp, len(pts)):
            _, W_i, r_i, rpe_i = pts[i]
            last_load, last_reps, last_rpe = pts[i - 1][1], pts[i - 1][2], pts[i - 1][3]
            if W_i is None or r_i is None or last_load is None or last_reps is None:
                continue
            fit = ind.fit_load_rep([(w, r) for _, w, r, _ in pts[:i]])  # prior-only
            trir = ind.median_target_rir([(r, rp) for _, _, r, rp in pts[:i]], default_rir)
            base = ind.predict_reps_anchored(fit, last_load, last_reps, W_i)
            eff = ind.predict_reps_at_effort(fit, last_load, last_reps, last_rpe, W_i, trir)
            if not base or not eff:
                continue
            bk = B["recent" if eff[3] else "legacy"]
            bk["base"].append(abs(base[0] - r_i))
            bk["eff"].append(abs(eff[0] - r_i))
            if eff[3]:                                  # capacity path engaged
                tgt_rirs.append(trir)
                _, act_reliable = ind.failure_reps(r_i, rpe_i)
                if act_reliable:
                    act_rirs.append(ind.rir_from_rpe(rpe_i))   # actual RIR on the target

    def fin(bk):
        if not bk["base"]:
            return {"n": 0}
        return {"n": len(bk["base"]),
                "mae_baseline": round(statistics.mean(bk["base"]), 3),
                "mae_effort": round(statistics.mean(bk["eff"]), 3)}

    recent, legacy = fin(B["recent"]), fin(B["legacy"])
    offset = ({"n": len(tgt_rirs),
               "mean_target_rir": round(statistics.mean(tgt_rirs), 2),
               "mean_actual_rir": (round(statistics.mean(act_rirs), 2) if act_rirs else None)}
              if tgt_rirs else {"n": 0})
    adopt = (recent.get("n", 0) >= cfg["min_recent_targets"]
             and recent.get("mae_baseline") is not None
             and recent["mae_effort"] <= recent["mae_baseline"] * (1 - cfg["adopt_min_rel_improve"])
             and recent["mae_effort"] < recent["mae_baseline"]
             and (legacy.get("n", 0) == 0
                  or legacy["mae_effort"] <= legacy["mae_baseline"] + cfg["adopt_max_legacy_regress"]))
    return {"recent": recent, "legacy": legacy, "effort_offset": offset,
            "adopt_effort": bool(adopt),
            "rule": (f"recent n>={cfg['min_recent_targets']} & effort PERFORMED-rep MAE "
                     f"< baseline & legacy MAE not worse (+{cfg['adopt_max_legacy_regress']})"),
            "note": ("scores PERFORMED reps; RECENT = anchor set has reliable RIR so "
                     "capacity-at-effort engages, LEGACY = byte-identical to the raw-reps "
                     "line by construction; offset = is target_RIR an unbiased effort proxy")}


def _conformal_rep_records(conn, groups, normalized):
    """Walk-forward rep-prediction records for the #6 calibration, each tagged with
    its exercise-TYPE and the TEST session's date (for day-based purge/embargo).
    Mirrors the LIVE point model exactly: prior-only fit on the windowed fresh
    points, #2's pooled slope when the lift pools live, the anchored point and its
    incumbent Gaussian band. score = |point - actual| (constant-width) or that
    over the §1b scale (normalized). Shared by the validator below."""
    s = config.settings()
    minp = s["forecast_min_points"]
    pcfg = ind._rep_pooling_cfg()
    recs = []
    for ex in _exercises(conn):
        dated = ind._fresh_rows_dated(conn, ex, _cur_epoch(conn, ex))
        if len(dated) <= minp:
            continue
        g = ind.ex_type(ex)
        level = groups.get(g) or groups.get("__global__")
        full = ind.fit_load_rep([(w, r, rp) for _, w, r, rp in dated])
        live_pools = bool(level) and not ind._personal_strong(full, pcfg)
        for i in range(minp, len(dated)):
            prior = [(w, r, rp) for _, w, r, rp in dated[:i]]
            fit = ind.fit_load_rep(prior)
            last_load, last_reps = dated[i - 1][1], dated[i - 1][2]
            d_i, w_i, r_i = dated[i][0], dated[i][1], dated[i][2]
            pooled = None
            if live_pools and level:
                se = (fit["resid_std"] / math.sqrt(fit["ssx"])
                      if fit and fit.get("ssx", 0) > 0 and fit["resid_std"] > 0 else None)
                bstar, _ = ind.shrink_load_rep_slope(
                    fit["slope"] if fit else None, se, level["mu"], level["tau2"])
                rstd = fit["resid_std"] if (fit and fit["resid_std"] > 0) else level["resid_std"]
                pooled = (bstar, rstd)
            ap = ind.predict_reps_anchored(fit, last_load, last_reps, w_i, pooled=pooled)
            if ap is None:
                continue
            scale = ind._norm_scale(fit, w_i) if normalized else 1.0
            score = abs(ap[0] - r_i)
            if normalized and scale > 0:
                score = score / scale
            recs.append({"type": g, "date": dates.from_iso(d_i + "T00:00:00"),
                         "point": ap[0], "actual": r_i, "score": score, "scale": scale,
                         "gauss_lo": ap[1], "gauss_hi": ap[2]})
    return recs


def conformal_rep_intervals(conn):
    """Pre-registered validation of #6 (design 06 section 3): walk-forward COVERAGE
    and width of the Mondrian-by-type conformal rep interval vs the incumbent
    Gaussian +-1.96*se band, on identical sessions. For each test session the
    calibration pool is every same-TYPE residual from a session strictly earlier
    than (test date - embargo) days (purged + embargoed, López de Prado, so
    autocorrelation can't inflate coverage); below `min_group_n` it backs off to
    the global pool. The conformal interval is point +- q (clamped to [1,20]); the
    Gaussian is point +- 1.96*se as shipped. Reports overall + per-type coverage at
    nominal (1 - alpha) and median widths for BOTH.

    Pre-registered bar: adopt iff conformal coverage lands in [coverage_lo,
    coverage_hi] overall AND within every type with n_g >= min_type_n, AND median
    conformal width <= median Gaussian width. HONEST NULL is acceptable: if the
    conformal band lands WIDER at nominal coverage, the Gaussian band was simply
    over-confident (under-covering) - coverage is the guarantee we actually want,
    so we'd keep conformal and report the wider truth-telling width; if sparse
    types can't reach n_g they keep an explicit 'uncalibrated' flag, not a fake
    band."""
    cfg = conformal._conformal_cfg()
    alpha = conformal.alpha_from_settings()
    level = 1.0 - alpha
    embargo = config.priors().get("form", {}).get("embargo_days", 3)
    groups = ind.group_slopes(conn)
    recs = _conformal_rep_records(conn, groups, cfg["normalized"])
    if not recs:
        return {"n": 0, "note": "not enough data", "level": round(level, 3)}

    overall = {"hit": [], "width": [], "g_hit": [], "g_width": []}
    by_type = defaultdict(lambda: {"hit": [], "width": [], "g_hit": [], "g_width": []})
    uncalibrated = 0
    for t in recs:
        same = [r["score"] for r in recs
                if r["type"] == t["type"] and (t["date"] - r["date"]).days > embargo]
        if len(same) >= cfg["min_group_n"]:
            q = conformal.conformal_quantile(same, alpha)
        else:
            glob = [r["score"] for r in recs if (t["date"] - r["date"]).days > embargo]
            q = conformal.conformal_quantile(glob, alpha)
        band = conformal.conformal_interval(t["point"], q, scale=t["scale"], clamp=(1.0, 20.0))
        # Gaussian incumbent: scored on EVERY session (it is always defined)
        g_hit = 1 if t["gauss_lo"] <= t["actual"] <= t["gauss_hi"] else 0
        g_w = t["gauss_hi"] - t["gauss_lo"]
        overall["g_hit"].append(g_hit); overall["g_width"].append(g_w)
        by_type[t["type"]]["g_hit"].append(g_hit); by_type[t["type"]]["g_width"].append(g_w)
        if band is None:
            uncalibrated += 1
            continue
        hit = 1 if band[0] <= t["actual"] <= band[1] else 0
        w = band[1] - band[0]
        overall["hit"].append(hit); overall["width"].append(w)
        by_type[t["type"]]["hit"].append(hit); by_type[t["type"]]["width"].append(w)

    def summ(b):
        out = {"n": len(b["hit"]),
               "coverage": round(statistics.mean(b["hit"]), 3) if b["hit"] else None,
               "median_width": round(statistics.median(b["width"]), 2) if b["width"] else None,
               "gaussian_n": len(b["g_hit"]),
               "gaussian_coverage": round(statistics.mean(b["g_hit"]), 3) if b["g_hit"] else None,
               "gaussian_median_width": round(statistics.median(b["g_width"]), 2) if b["g_width"] else None}
        return out

    ov = summ(overall)
    types = {g: summ(b) for g, b in sorted(by_type.items())}
    lo, hi = cfg["coverage_lo"], cfg["coverage_hi"]

    def covered(c):
        return c is not None and lo <= c <= hi
    big_types = {g: t for g, t in types.items() if t["n"] >= cfg["min_type_n"]}
    types_ok = all(covered(t["coverage"]) for t in big_types.values())
    width_ok = (ov["median_width"] is not None and ov["gaussian_median_width"] is not None
                and ov["median_width"] <= ov["gaussian_median_width"])
    # A zero-width interval can be marginally "calibrated" (it covers exactly the
    # cases the point nails) yet is uninformative - never adopt it.
    cal_widths = [t["median_width"] for t in big_types.values() if t["median_width"] is not None]
    degenerate = bool(cal_widths) and all(w == 0.0 for w in cal_widths)
    adopt = bool(covered(ov["coverage"]) and types_ok and width_ok and not degenerate)
    note = ("coverage is the guarantee, not sharpness: a WIDER conformal band at nominal "
            "coverage means the Gaussian band was over-confident, which still keeps conformal")
    if degenerate:
        note = ("DEGENERATE: the conformal 80% rep band collapses to ~zero width because the "
                "top-set reps repeat exactly session-to-session most of the time, so the honest "
                "80% interval is 'exactly the predicted reps'. Calibrated but uninformative -> "
                "not adopted; the Gaussian band stays live (and is shown here to over-cover)")
    return {"n": ov["n"], "level": round(level, 3), "uncalibrated": uncalibrated,
            "overall": ov, "by_type": types,
            "calibrated_types": sorted(big_types),
            "degenerate_interval": degenerate,
            "adopt_conformal": adopt,
            "rule": (f"coverage in [{lo},{hi}] overall & per type with n>={cfg['min_type_n']} "
                     f"& median conformal width <= median Gaussian width & non-degenerate"),
            "note": note}


def forecast_band_audit(conn):
    """Design 06 section 1d/3: the forecast band is already split-conformal in all
    but name. Reports the effect of adding the finite-sample (1/(n+1)) correction -
    the PLAIN empirical half-width forecast.accuracy uses today vs the CONFORMAL
    half-width - and their in-sample coverage. Pre-registered: adopt the corrected
    band iff coverage moves toward nominal (the in-sample plain number is optimistic)
    without median width inflating by more than forecast_width_tol."""
    s = config.settings()
    level = s.get("forecast_band_level", 0.8)
    alpha = 1.0 - level
    rows = fc._walk_forward_errors(conn)
    rels = sorted(r["rel_err"] for r in rows if r.get("rel_err") is not None)
    if len(rels) < 8:
        return {"n": len(rels), "note": "not enough forecast residuals"}
    plain = trend._percentile(rels, level)
    conf = conformal.conformal_quantile(rels, alpha)

    def cover(half):
        return sum(1 for r in rows if r["anchor"] and r["model_err"] <= r["anchor"] * half) / len(rows)

    conf_fin = math.isfinite(conf)
    plain_cov, conf_cov = cover(plain), (cover(conf) if conf_fin else None)
    ratio = (conf / plain) if (conf_fin and plain > 0) else None
    tol = conformal._conformal_cfg()["forecast_width_tol"]
    adopt = bool(conf_fin and conf_cov is not None
                 and abs(conf_cov - level) <= abs(plain_cov - level) + 1e-9
                 and ratio is not None and ratio <= 1.0 + tol)
    return {"n": len(rels), "level": level,
            "plain_halfwidth": round(plain, 4),
            "conformal_halfwidth": round(conf, 4) if conf_fin else None,
            "plain_coverage": round(plain_cov, 3),
            "conformal_coverage": round(conf_cov, 3) if conf_cov is not None else None,
            "width_ratio": round(ratio, 3) if ratio is not None else None,
            "adopt_conformal_band": adopt,
            "rule": f"coverage toward nominal & width ratio <= {1.0 + tol:.2f}"}


def _raw_acwr(loads, as_of, s):
    """The ORIGINAL ungated acute/chronic ratio - the version that produced the
    4.0 after a layoff (acute jumps, chronic is mostly gap zeros)."""
    a = statistics.mean([loads.get(d, 0.0) for d in fatigue._daterange(as_of, s["acwr_acute_days"])])
    c = statistics.mean([loads.get(d, 0.0) for d in fatigue._daterange(as_of, s["acwr_chronic_days"])])
    return (a / c) if c > 0 else None


def acwr_gate_audit(conn):
    """Roadmap #3 false-alarm audit. Walk every training day; at each LAYOFF-RETURN
    day (>= detraining.days_flag since the prior session) check whether the OLD
    ungated ACWR fired a spike and whether the gated state machine reclassifies it
    as DETRAINED. Pre-registered bar: the gate suppresses >= 90% of post-gap spike
    flags while still flagging genuine spikes that occur on an adequate base.
    Injury risk itself is UNVALIDATABLE here (no injuries are logged) - this only
    audits the artifact, and says so."""
    s = config.settings()
    spike = s["acwr_spike"]
    gap_days = config.priors().get("detraining", {}).get("days_flag", 21)
    total = fatigue.daily_load_total(conn)
    sess = sorted(d for d, v in total.items() if v > 0)
    if len(sess) < 2:
        return {"post_gap_old_spike_flags": 0, "note": "not enough sessions"}
    post_gap_flags = suppressed = genuine_spikes = 0
    for i in range(1, len(sess)):
        gap = (dates.from_iso(sess[i] + "T00:00:00")
               - dates.from_iso(sess[i - 1] + "T00:00:00")).days
        gstate = fatigue.acwr_gated(total, sess[i], s)["state"]
        if gap >= gap_days:
            old = _raw_acwr(total, sess[i], s)
            if old is not None and old > spike:        # the old code would cry "spike"
                post_gap_flags += 1
                if gstate == "detrained":
                    suppressed += 1
        elif gstate == "spiking":                       # genuine spike on adequate base
            genuine_spikes += 1
    rate = (suppressed / post_gap_flags) if post_gap_flags else None
    return {"post_gap_old_spike_flags": post_gap_flags,
            "suppressed_by_gate": suppressed,
            "suppression_rate": round(rate, 3) if rate is not None else None,
            "genuine_spikes_still_flagged": genuine_spikes,
            "gate_eliminates_artifact": bool(rate is not None and rate >= 0.90),
            "bar": ">=90% of post-gap spike flags suppressed (injury risk itself unvalidatable)"}


def forecast(conn):
    """Walk-forward e1RM forecast error vs realized, against a flat 'no change'
    baseline (the honesty check) and the old linear extrapolation, plus band
    calibration. Logic lives in forecast.accuracy() so the report and the
    backtest score the exact same projection."""
    return fc.accuracy(conn)


def suggested_cutoffs(conn):
    """Data-fitted well/under cutoff suggestion (advisory). Apply by setting
    priors.recovery.calibration_mode='apply' + filling a 'calibrated' block."""
    return recovery_validity(conn).get("suggested_cutoffs")


def run(conn):
    return {"rep_prediction": rep_prediction(conn),
            "rep_pooling": pooled_rep_prediction(conn),
            "heavy_extrapolation": heavy_extrapolation(conn),
            "effort_rep_prediction": effort_rep_prediction(conn),
            "conformal_rep_intervals": conformal_rep_intervals(conn),
            "forecast_band_audit": forecast_band_audit(conn),
            "recovery_validity": recovery_validity(conn),
            "form_validity": form_validity(conn),
            "acwr_gate_audit": acwr_gate_audit(conn),
            "forecast": forecast(conn)}
