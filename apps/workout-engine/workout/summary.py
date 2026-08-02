"""Assemble summary.json - the single source of truth the report/dashboard and
the AI coach all read from."""
import json
import os
from collections import defaultdict
from datetime import datetime, timedelta
from . import (config, db, dates, progression, balance, fatigue, forecast,
               autoregulation, individualize, plateau, compare, volume, backtest,
               conformal)


def _data_quality(conn):
    rpe = conn.execute("SELECT COUNT(*) c FROM sets WHERE rpe IS NOT NULL").fetchone()["c"]
    bw = conn.execute("SELECT COUNT(*) c FROM bodyweight").fetchone()["c"]
    anomalies = [
        {"exercise": r["exercise_title"], "date": r["date"], "field": "reps",
         "raw": r["reps_raw"], "corrected": r["reps_clean"], "rule": "rep_typo_trailing_digit"}
        for r in conn.execute(
            """SELECT exercise_title, date, reps_raw, reps_clean FROM sets
               WHERE quality_flag LIKE '%rep_typo%' ORDER BY date""")]
    epochs = [
        {"exercise": r["exercise_title"], "epochs": r["ne"],
         "note": "logged unit changed; progression indexed per-epoch"}
        for r in conn.execute(
            """SELECT exercise_title, COUNT(DISTINCT epoch) ne FROM sets
               GROUP BY exercise_title HAVING ne>1 ORDER BY ne DESC""")]
    imp = conn.execute(
        """SELECT rows_inserted, rows_updated, rows_seen FROM imports
           ORDER BY import_id DESC LIMIT 1""").fetchone()
    return {
        "rpe_present": rpe > 0,
        "bodyweight_present": bw > 0,
        "anomalies_corrected": anomalies,
        "unit_epochs": epochs,
        "import": {"inserted": imp["rows_inserted"] if imp else 0,
                   "updated": imp["rows_updated"] if imp else 0,
                   "rows_seen": imp["rows_seen"] if imp else 0},
    }


def _history(conn):
    """Monthly training history for the consistency timeline."""
    sess = {r["m"]: r["n"] for r in conn.execute(
        "SELECT substr(date,1,7) m, COUNT(*) n FROM sessions GROUP BY m")}
    vol = conn.execute(
        """SELECT substr(date,1,7) m, COUNT(*) sets, ROUND(SUM(COALESCE(volume,0)),0) v
           FROM sets WHERE is_working=1 GROUP BY m ORDER BY m""").fetchall()
    return [{"month": r["m"], "sessions": sess.get(r["m"], 0),
             "hard_sets": r["sets"], "volume": r["v"]} for r in vol]


def _calendar(conn):
    """One row per training day for the calendar heatmap + month grid."""
    rows = conn.execute(
        """SELECT date, COUNT(*) sets, ROUND(SUM(COALESCE(volume,0)),0) volume,
                  COUNT(DISTINCT exercise_title) n_exercises
           FROM sets WHERE is_working=1 GROUP BY date ORDER BY date""").fetchall()
    muscles = defaultdict(list)
    for r in conn.execute(
        """SELECT date, primary_muscle FROM sets
           WHERE is_working=1 AND primary_muscle IS NOT NULL
           GROUP BY date, primary_muscle"""):
        muscles[r["date"]].append(r["primary_muscle"])
    return [{"date": r["date"], "sets": r["sets"],
             "volume": r["volume"], "n_exercises": r["n_exercises"],
             "muscles": muscles.get(r["date"], [])} for r in rows]


def _sessions(conn):
    """Per-day session detail for the calendar drill-down: title, duration,
    totals and each exercise's top set."""
    meta = {}
    for r in conn.execute("SELECT date, title, duration_min FROM sessions ORDER BY date"):
        m = meta.setdefault(r["date"], {"titles": [], "duration_min": 0.0})
        if r["title"]:
            m["titles"].append(r["title"])
        if r["duration_min"]:
            m["duration_min"] += r["duration_min"]
    byday = defaultdict(lambda: defaultdict(list))
    for r in conn.execute(
        """SELECT date, exercise_title, primary_muscle, weight_raw, reps_clean,
                  e1rm, volume FROM sets WHERE is_working=1
           ORDER BY date, exercise_title, set_index"""):
        byday[r["date"]][r["exercise_title"]].append(r)
    out = {}
    for date, exs in byday.items():
        m = meta.get(date, {"titles": [], "duration_min": 0.0})
        ex_list, total_sets, total_vol = [], 0, 0.0
        for ex, sets in exs.items():
            total_sets += len(sets)
            total_vol += sum((s["volume"] or 0) for s in sets)
            top = max(sets, key=lambda s: ((s["weight_raw"] or -1),
                                           (s["reps_clean"] or 0)))
            ex_list.append({
                "name": ex, "muscle": sets[0]["primary_muscle"],
                "n_sets": len(sets), "top_weight": top["weight_raw"],
                "top_reps": top["reps_clean"],
                "e1rm": round(top["e1rm"], 1) if top["e1rm"] is not None else None})
        title = " / ".join(dict.fromkeys(m["titles"])) or "Workout"
        out[date] = {"title": title,
                     "duration_min": round(m["duration_min"]) if m["duration_min"] else None,
                     "total_sets": total_sets, "volume": round(total_vol),
                     "exercises": ex_list}
    return out


def _records(conn, prog_map):
    """Per-lift PR hall within the current epoch (loads comparable there)."""
    out = []
    for ex, p in prog_map.items():
        epoch = p["epoch"]
        heaviest = conn.execute(
            """SELECT weight_raw w, reps_clean r, date FROM sets
               WHERE exercise_title=? AND epoch=? AND weight_raw IS NOT NULL
               ORDER BY weight_raw DESC, reps_clean DESC LIMIT 1""", (ex, epoch)).fetchone()
        beste = conn.execute(
            """SELECT e1rm, weight_raw w, reps_clean r, date FROM sets
               WHERE exercise_title=? AND epoch=? AND e1rm IS NOT NULL
               ORDER BY e1rm DESC LIMIT 1""", (ex, epoch)).fetchone()
        bestr = conn.execute(
            """SELECT reps_clean r, weight_raw w, date FROM sets
               WHERE exercise_title=? AND epoch=? AND reps_clean IS NOT NULL
                 AND weight_raw IS NOT NULL
               ORDER BY reps_clean DESC, weight_raw DESC LIMIT 1""", (ex, epoch)).fetchone()
        bestv = conn.execute(
            """SELECT date, ROUND(SUM(volume),1) v FROM sets
               WHERE exercise_title=? AND epoch=? AND volume IS NOT NULL
               GROUP BY date ORDER BY v DESC LIMIT 1""", (ex, epoch)).fetchone()
        out.append({
            "name": ex, "muscle": config.exercise_info(ex)["primary"],
            "last_trained": p["last_trained"],
            "heaviest": ({"weight": heaviest["w"], "reps": heaviest["r"],
                          "date": heaviest["date"]} if heaviest else None),
            "best_e1rm": ({"value": round(beste["e1rm"], 1),
                           "set": f"{beste['w']:g}x{beste['r']}", "date": beste["date"]}
                          if beste else None),
            "best_reps": ({"reps": bestr["r"], "weight": bestr["w"],
                           "date": bestr["date"]} if bestr else None),
            "best_session_volume": ({"value": bestv["v"], "date": bestv["date"]}
                                    if bestv else None),
            "recent_pr": p["recent_pr"],
        })
    return out


def _bodyweight(conn):
    """Logged bodyweight series (empty until the user starts logging it)."""
    return [{"date": r["date"], "weight": r["weight"], "unit": r["unit"]}
            for r in conn.execute(
                "SELECT date, weight, unit FROM bodyweight ORDER BY date")]


def _powerlifting(conn, exercises, pl_cfg):
    """The big-3 block for the Powerlifting tab.

    Maps the three competition slots to logged lifts, builds a carry-forward
    weekly *Total* (squat+bench+deadlift e1RM) series, and pulls recent set-level
    rows per lift. Headline numbers (best e1RM per lift, DOTS, standards) are
    derived in the dashboard JS from D.exercises + this block's bodyweight, so we
    keep this lean. Degrades gracefully when a slot (e.g. squat) is unlogged."""
    by_name = {e["name"]: e for e in exercises}
    slots = ["squat", "bench", "deadlift"]
    names = {s: pl_cfg["lifts"].get(s) for s in slots}

    # current bodyweight, normalized to kg
    bw_row = conn.execute(
        "SELECT weight, unit FROM bodyweight ORDER BY date DESC LIMIT 1").fetchone()
    bw_kg = None
    if bw_row and bw_row["weight"]:
        w = float(bw_row["weight"])
        bw_kg = round(w * 0.45359237, 1) if (bw_row["unit"] or "kg").lower() == "lb" else w

    def recent_sets(ex_name, n_sessions=6):
        rows = conn.execute(
            """SELECT date, weight_raw w, reps_clean r, e1rm, set_index
               FROM sets WHERE exercise_title=? AND is_working=1
                 AND weight_raw IS NOT NULL AND reps_clean IS NOT NULL
               ORDER BY date DESC, set_index ASC""", (ex_name,)).fetchall()
        out, days = [], []
        for r in rows:
            if r["date"] not in days:
                if len(days) >= n_sessions:
                    break
                days.append(r["date"])
            out.append({"date": r["date"], "weight": r["w"], "reps": r["r"],
                        "e1rm": round(r["e1rm"], 1) if r["e1rm"] is not None else None})
        return out

    lifts = []
    for s in slots:
        nm = names[s]
        e = by_name.get(nm)
        rs = recent_sets(nm)
        if e is None and not rs:
            lifts.append({"slot": s, "name": nm, "present": False})
        else:
            best_e1rm = e["best_e1rm"] if e else (
                max((r["e1rm"] for r in rs if r["e1rm"] is not None), default=None))
            lifts.append({"slot": s, "name": nm, "present": True,
                          "recent_sets": rs, "best_e1rm": best_e1rm})

    # --- weekly Total series: align the three lifts by date, carry forward ---
    series = {s: dict(by_name[names[s]]["series"]) for s in slots
              if names[s] in by_name}  # {slot: {date: e1rm}}
    all_dates = sorted({d for sm in series.values() for d in sm})
    last = {s: None for s in slots}
    total_series = []
    for d in all_dates:
        for s in slots:
            if s in series and d in series[s]:
                last[s] = series[s][d]
        present = [s for s in slots if last[s] is not None]
        if not present:
            continue
        pt = {"date": d, "present": len(present),
              "total": round(sum(last[s] for s in present), 1)}
        for s in slots:
            pt[s] = last[s]
        total_series.append(pt)

    last_pt = total_series[-1] if total_series else None
    return {
        "config": pl_cfg,
        "bodyweight_kg": bw_kg,
        "lifts": lifts,
        "lifts_present": sum(1 for L in lifts if L.get("present")),
        "total_series": total_series,
        "current_total": last_pt["total"] if last_pt else None,
        "current_total_present": last_pt["present"] if last_pt else 0,
    }


def _next_actions(fat, detrain, deload, volume_plan, exercises, goals, neglected):
    """The prioritized 'do next' feed - one place that answers 'what should I
    change this week?'. Synthesized from signals already computed elsewhere so
    the dashboard hero and the markdown report lead with the same actions."""
    acts = []

    def add(priority, kind, icon, title, detail, tab):
        acts.append({"priority": priority, "kind": kind, "icon": icon,
                     "title": title, "detail": detail, "tab": tab})

    if detrain:
        add(0, "detraining", "rest", "Ease back in", detrain["message"], "volume")
    if deload:
        add(1, "deload", "deload", "Consider a deload",
            (deload["reasons"][0] + " " + deload.get("protocol", "")).strip(), "volume")
    if fat["readiness"] == "red":
        add(1, "readiness", "warn", "Back off this week", fat["reasons"][0], "overview")

    recs = (volume_plan or {}).get("recommendations", [])
    for r in recs:
        if r["action"] in ("reduce", "deload"):
            add(2, "cut_volume", "down",
                f"Cut {r['muscle']} to {r['target_sets']:g} sets", r["reason"], "volume")
    for m, d in (neglected or [])[:2]:
        add(2, "under_mev", "up", f"Add {m} volume",
            f"{m} at {d['sets_per_week']:g} sets/wk is under MEV ({d['mev']}).", "body")
    decl = [e for e in exercises if e["status"] == "declining"]
    for e in decl[:2]:
        add(2, "declining", "down", f"{e['name']} is declining",
            "Trend is down - check recovery or deload this lift.", "strength")

    for r in recs:
        if r["action"] == "add":
            add(3, "add_volume", "up",
                f"Add a set to {r['muscle']} ({r['current_sets']:g}→{r['target_sets']:g})",
                r["reason"], "volume")
    prog_ready = [e for e in exercises if e["next_target"].get("rec_type") == "progress"]
    for e in prog_ready[:3]:
        add(3, "progress", "up", f"Add load on {e['name']}",
            e["next_target"].get("rationale", ""), "strength")
    for g in goals:
        if g.get("verdict") == "behind":
            add(3, "goal", "goal", f"Behind on {g['exercise']} goal",
                f"Projected {g.get('projected_date', '?')} vs target {g.get('target_date', '?')}.",
                "goals")

    if not acts:
        add(5, "ok", "ok", "Keep cruising",
            "No red flags - log your next sessions and re-run the coach.", "overview")
    acts.sort(key=lambda a: a["priority"])
    return acts[:8]


def _week_summary(conn, as_of):
    start = (dates.from_iso(as_of + "T00:00:00") - timedelta(days=7)).strftime("%Y-%m-%d")
    sessions = conn.execute(
        "SELECT COUNT(DISTINCT date) c FROM sessions WHERE date>? AND date<=?",
        (start, as_of)).fetchone()["c"]
    hard_sets = conn.execute(
        "SELECT COUNT(*) c FROM sets WHERE is_working=1 AND date>? AND date<=?",
        (start, as_of)).fetchone()["c"]
    wb = balance.weekly_balance(conn, weeks=4, as_of=as_of)
    # Per-muscle recency for the body-map "days since trained" mode.
    last = {r["primary_muscle"]: r["d"] for r in conn.execute(
        """SELECT primary_muscle, MAX(date) d FROM sets WHERE is_working=1
           GROUP BY primary_muscle""")}
    as_of_dt = dates.from_iso(as_of + "T00:00:00")
    for m, d in wb.items():
        lt = last.get(m)
        d["last_trained"] = lt
        d["days_since"] = ((as_of_dt - dates.from_iso(lt + "T00:00:00")).days
                           if lt else None)
    return {
        "sessions": sessions,
        "total_hard_sets": hard_sets,
        "sets_by_muscle_7d": balance.this_week_sets(conn, as_of),
        "muscle_status_4wk_avg": {m: d["status"] for m, d in wb.items()},
        "muscle_detail": wb,
        "ratios": balance.ratios(conn, weeks=4, as_of=as_of),
    }


def _headline_flags(conn, as_of, fat, prog_map, week, detrain=None, deload=None,
                    plateau_map=None):
    flags = []
    if detrain:
        flags.append("[!] " + detrain["message"])
    if fat["readiness"] == "red":
        flags.append("[!] " + fat["reasons"][0])
    if deload:
        flags.append("[deload] " + deload["reasons"][0] + " - consider a deload.")
    neg = balance.neglected(conn, weeks=4, as_of=as_of)
    for m, d in neg[:2]:
        flags.append(f"{m.capitalize()} at {d['sets_per_week']} sets/wk - under MEV "
                     f"({d['mev']}); biggest growth limiter.")
    if plateau_map:
        stalled = [ex for ex, st in plateau_map.items()
                   if st.get("verdict") == "plateau" and st.get("onset")]
        if stalled:
            flags.append("Plateaued: " + ", ".join(stalled[:4]))
    declines = [p["name"] for p in prog_map.values() if p["status"] == "declining"]
    if declines:
        flags.append("Declining: " + ", ".join(declines[:4]))
    if fat["readiness"] == "amber":
        flags.append(fat["reasons"][0])
    if week["ratios"]["upper_lower"] and week["ratios"]["upper_lower"] > 3:
        flags.append(f"Upper:lower volume {week['ratios']['upper_lower']}:1 - very "
                     "upper-dominant; add lower-body work.")
    prs = [(p["name"], p["recent_pr"]) for p in prog_map.values() if p["recent_pr"]]
    for name, pr in prs[:2]:
        if pr["type"] == "e1rm":
            flags.append(f"[PR] {name}: est. 1RM {pr['value']} ({pr['date']}).")
    return flags


def build(conn, as_of=None):
    as_of = as_of or progression.latest_date(conn)
    span = conn.execute("SELECT MIN(date) a, MAX(date) b FROM sessions").fetchone()
    weeks_covered = 0
    if span["a"] and span["b"]:
        weeks_covered = round((dates.from_iso(span["b"] + "T00:00:00") -
                               dates.from_iso(span["a"] + "T00:00:00")).days / 7.0, 1)

    prog_map = progression.analyze_all(conn, as_of)
    fat = fatigue.assess(conn, as_of)
    week = _week_summary(conn, as_of)
    plateau_map = {ex: plateau.status(p["series"]) for ex, p in prog_map.items()}

    # Walk-forward forecast accuracy + band calibration, computed once and
    # shared by every lift's forecast (single-lift error samples are too sparse).
    facc = forecast.accuracy(conn)
    fcalib = facc.get("calib")

    # Hierarchical-pooling group slopes, computed ONCE and shared by every lift's
    # analysis + prediction (design 02) so starved lifts borrow their type's
    # load->reps slope instead of collapsing to 'same reps as last time'.
    groups = individualize.group_slopes(conn)
    # design 06: Mondrian-by-type conformal quantiles, computed ONCE (like groups)
    # and threaded into every prediction so the rep band is calibrated instead of
    # Gaussian. Only when enabled - byte-identical Gaussian band otherwise.
    cq = (individualize.rep_conformal_quantiles(conn, groups=groups)
          if conformal._conformal_cfg()["enabled"] else None)
    grace_counts = {"calibrating": 0, "learning": 0, "confident": 0}
    exercises = []
    for ex, p in prog_map.items():
        nt = autoregulation.next_target(conn, ex, p, groups, cq)
        fc = forecast.forecast_exercise(p, fcalib)
        ia = individualize.analyze_exercise(conn, ex, p["epoch"], groups)
        grace_counts[ia["grace_state"]] = grace_counts.get(ia["grace_state"], 0) + 1
        indiv = {"grace_state": ia["grace_state"], "confidence": ia["confidence"],
                 "n_fresh": ia["n_fresh"], "individ_1rm": ia["individ_1rm"],
                 "individ_1rm_basis": ia["individ_1rm_basis"], "anchor": ia["anchor"]}
        exercises.append({
            "name": ex, "muscle": config.exercise_info(ex)["primary"],
            "epoch": p["epoch"], "n_sessions": p["n_sessions"],
            "last_trained": p["last_trained"],
            "best_e1rm": p["best_e1rm"], "best_e1rm_set": p["best_e1rm_set"],
            "heaviest": p["heaviest"],
            "e1rm_trend_per_week": p["e1rm_trend_per_week"],
            "trend_confidence": p["trend_confidence"], "status": p["status"],
            "recent_pr": p["recent_pr"], "next_target": nt, "forecast": fc,
            "individualization": indiv, "plateau": plateau_map[ex],
            "series": [[d, round(e, 1)] for d, e in p["series"]],
        })

    detrain = plateau.detraining(conn)  # uses the real current date
    deload = plateau.deload_recommendation(
        conn, prog_map, plateau_map, fat, week["muscle_detail"])
    experiment = compare.analyze(conn)
    # Walk-forward recovery validity, computed once and fed into the set plan so
    # the recommendations carry an honest confidence (and fall back to landmarks
    # when the recovery read can't be trusted on this user's data). Uses the
    # leakage-free FORM validator (design 01 section 5.2): both predictor and
    # outcome are detrended, so the confidence reflects the honestly-measured r.
    recovery_accuracy = backtest.form_validity(conn)
    # Walk-forward verdict on the #5 predict-at-effort rep model (capacity - target
    # RIR vs the raw-reps line), surfaced additively so the report can be honest
    # about whether folding RIR into the live prediction actually helps yet.
    rir_rep_accuracy = backtest.effort_rep_prediction(conn)
    # Walk-forward verdict on #6: does the calibrated conformal rep band cover at
    # nominal without being wider than the Gaussian band it replaces, and does the
    # finite-sample-corrected forecast band move coverage toward nominal? Surfaced
    # additively so the report can be honest about interval calibration.
    conformal_accuracy = {"rep_intervals": backtest.conformal_rep_intervals(conn),
                          "forecast_band": backtest.forecast_band_audit(conn)}
    volume_plan = volume.recommend(conn, as_of, prog_map, fat,
                                   week["muscle_detail"], recovery_accuracy)
    # most relevant first: progressing/declining with data, then by sessions
    order = {"declining": 0, "progressing": 1, "plateau": 2, "building": 3,
             "insufficient": 4}
    exercises.sort(key=lambda e: (order.get(e["status"], 5), -e["n_sessions"]))

    goals_rows = conn.execute(
        "SELECT * FROM goals WHERE status='active'").fetchall()
    goals = [forecast.pace_vs_goal(conn, g, prog_map) for g in goals_rows]
    neg = balance.neglected(conn, weeks=4, as_of=as_of)
    next_actions = _next_actions(fat, detrain, deload, volume_plan,
                                 exercises, goals, neg)

    adher = conn.execute(
        """SELECT outcome, COUNT(*) c FROM recommendations
           WHERE outcome IS NOT NULL GROUP BY outcome""").fetchall()
    adherence = {r["outcome"]: r["c"] for r in adher}

    out = {
        "schema_version": 4,
        "generated_at": dates.iso(datetime.now()),
        "window": {"latest_session": as_of, "weeks_covered": weeks_covered,
                   "first_session": span["a"]},
        "data_quality": _data_quality(conn),
        "adherence": adherence,
        "week_summary": week,
        "history": _history(conn),
        "calendar": _calendar(conn),
        "sessions": _sessions(conn),
        "bodyweight": _bodyweight(conn),
        "fatigue": fat,
        "forecast_accuracy": facc,
        "recovery_accuracy": recovery_accuracy,
        "rir_rep_accuracy": rir_rep_accuracy,
        "conformal_accuracy": conformal_accuracy,
        "grace_overview": grace_counts,
        "next_actions": next_actions,
        "detraining": detrain,
        "deload": deload,
        "experiment": experiment,
        "volume_plan": volume_plan,
        "exercises": exercises,
        "records": _records(conn, prog_map),
        "powerlifting": _powerlifting(conn, exercises, config.powerlifting()),
        "goals": goals,
        "headline_flags": _headline_flags(conn, as_of, fat, prog_map, week,
                                          detrain, deload, plateau_map),
    }
    return out


def write(conn, as_of=None):
    """Build and persist summary.json under output/<date>/. Returns (obj, dir)."""
    obj = build(conn, as_of)
    day = obj["window"]["latest_session"]
    outdir = os.path.join(config.OUTPUT_DIR, day)
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)
    return obj, outdir
