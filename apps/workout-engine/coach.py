#!/usr/bin/env python
"""WorkOut Coach - CLI.

Usage:
  python coach.py update <export.csv> [--date YYYY-MM-DD] [--force]
  python coach.py report [--date YYYY-MM-DD]
  python coach.py log-bw <weight> [--date YYYY-MM-DD] [--note "..."]
  python coach.py set-goal "<Exercise>" <metric> <value> [--reps N] [--by YYYY-MM-DD]
  python coach.py note <category> "<text>"
  python coach.py status
"""
import argparse
import sys
from workout import (db, ingest, summary, report, memory, progression,
                     individualize, autoregulation, compare, fatigue, balance,
                     volume, backtest, sync, routine_push)


def _open():
    conn = db.connect()
    db.init(conn)
    return conn


def _report_after(conn, as_of=None):
    """Shared post-ingest pipeline: grade last week's targets, refit models,
    rebuild summary.json + report.md + dashboard.html, and print the report.
    Used by both `update` (CSV) and `sync` (API)."""
    as_of = as_of or progression.latest_date(conn)
    memory.grade_recommendations(conn, as_of)
    individualize.refresh_models(conn)
    obj, outdir = summary.write(conn, as_of)
    memory.save_recommendations(conn, obj, as_of)
    report.write_all(obj, outdir)

    print(report.render_markdown(obj))
    print(f"\nArtifacts written to: {outdir}")
    print("  - summary.json (machine-readable)")
    print("  - report.md")
    print("  - dashboard.html (open in a browser)")
    return obj, outdir


def cmd_update(args):
    conn = _open()
    res = ingest.run(conn, args.csv, force=args.force)
    if res.get("no_change"):
        print("No new data in this export (identical to the last import).")
        print("Re-rendering report from existing data...\n")
    else:
        print(f"Ingested: +{res['inserted']} new sets, {res['updated']} edited, "
              f"{res['duplicate_noop']} unchanged, {res['flagged']} flagged.\n")
    _report_after(conn, args.date)


def cmd_sync(args):
    conn = _open()
    res = sync.run(conn, full=args.full)
    print(f"Sync ({res['mode']}): +{res['inserted']} new sets, "
          f"{res['updated']} edited, {res['duplicate_noop']} unchanged, "
          f"{res['deleted']} deleted, {res['measurements']} measurements, "
          f"{res['flagged']} flagged.\n")
    _report_after(conn, args.date)


def cmd_push(args):
    conn = _open()
    updates = routine_push.build_updates(conn, args.date)
    routine_push.preview(updates)
    if not updates:
        return
    if args.push:
        print()
        n = routine_push.push(conn, updates)
        print(f"\nPushed {n} routine(s) to Hevy.")
    else:
        print("Dry run - nothing written. Re-run with --push to apply.")


def cmd_report(args):
    conn = _open()
    as_of = args.date or progression.latest_date(conn)
    obj, outdir = summary.write(conn, as_of)
    report.write_all(obj, outdir)
    print(report.render_markdown(obj))
    print(f"\nArtifacts written to: {outdir}")


def cmd_log_bw(args):
    conn = _open()
    d = memory.log_bodyweight(conn, args.weight, args.date, note=args.note)
    print(f"Logged bodyweight {args.weight} kg on {d}.")


def cmd_set_goal(args):
    conn = _open()
    memory.add_goal(conn, args.exercise, args.metric, args.value, args.reps, args.by)
    print(f"Goal set: {args.exercise} -> {args.value} ({args.metric})"
          + (f" by {args.by}" if args.by else ""))


def cmd_note(args):
    conn = _open()
    memory.add_note(conn, args.category, args.text)
    print(f"Noted [{args.category}]: {args.text}")


def cmd_predict(args):
    conn = _open()
    ex = args.exercise
    epoch = conn.execute(
        "SELECT MAX(epoch) e FROM sets WHERE exercise_title=?", (ex,)).fetchone()["e"]
    if epoch is None:
        print(f"No data for '{ex}'. Check the exact exercise name.")
        return
    v = autoregulation.weight_verdict(conn, ex, epoch, args.weight)
    a = individualize.analyze_exercise(conn, ex, epoch)
    print(f"{ex} @ {args.weight:g}")
    print(f"  Model: {a['grace_state']} ({a['confidence']}% confident, "
          f"{a['n_fresh']} fresh sets)")
    if v["prediction"]:
        p = v["prediction"]
        eff = (f" at your usual ~{p['target_rir']:g} RIR effort"
               if p.get("at_effort") else "")
        tag = {"conformal": " conformal", "uncalibrated": " (band uncalibrated)"}.get(
            p.get("interval"), "")
        print(f"  Predicted reps: {p['reps']} (likely {p['lo']}-{p['hi']}{tag}){eff}")
        print(f"  Prediction basis: {p['basis']} ({p['confidence']}% confident)")
    print(f"  Verdict: {v['verdict'].upper()} - {v['note']}")
    if a["individ_1rm"]:
        how = {"spline": " (curvilinear)", "linear": " (linear)"}.get(
            a.get("individ_1rm_basis"), "")
        print(f"  Personalized 1RM estimate: ~{a['individ_1rm']}{how}")


def cmd_calibrate(args):
    conn = _open()
    tips = individualize.calibration_protocol(conn, args.exercise)
    if not tips:
        print("All tracked lifts are already well-calibrated. Nothing needed.")
    else:
        print("Optional calibration to sharpen predictions (purely opt-in):\n")
        for t in tips[:args.limit]:
            print(f"  {t['exercise']}  [{t['grace_state']}, {t['confidence']}%]")
            for tip in t["tips"]:
                print(f"     - {tip}")

    # Recovery cutoff calibration - data-fitted, advisory (never auto-applied).
    cuts = backtest.suggested_cutoffs(conn)
    print("\nRecovery cutoff calibration (advisory):")
    if not cuts:
        print("  Not enough validation windows yet to suggest cutoffs.")
        return
    s_, c_ = cuts["suggested"], cuts["current"]
    print(f"  current   well/under = {c_['well']}/{c_['under']}  (outcome spread {cuts['current_spread']})")
    print(f"  suggested well/under = {s_['well']}/{s_['under']}  (outcome spread {cuts['suggested_spread']}, n={cuts['n']})")
    if cuts["improves_backtest"]:
        print("  -> the suggested cutoffs separate outcomes better on your data.")
        print("     To apply, set config/priors.json recovery.calibration_mode='apply' and add:")
        print(f'       "calibrated": {{"cutoffs": {{"well": {s_["well"]}, "under": {s_["under"]}}}}}')
    else:
        print("  -> current cutoffs are as good or better; no change recommended.")


def cmd_compare(args):
    conn = _open()
    res = compare.analyze(conn)
    if not res["muscles"]:
        print("Not enough multi-month data yet to compare training styles.")
    for m in res["muscles"]:
        if args.muscle and m["muscle"] != args.muscle:
            continue
        print(f"- {m['text']}")
    if res["note"]:
        print(f"\n({res['note']})")


def cmd_sets(args):
    conn = _open()
    as_of = args.date or progression.latest_date(conn)
    prog_map = progression.analyze_all(conn, as_of)
    fat = fatigue.assess(conn, as_of)
    md = balance.weekly_balance(conn, weeks=4, as_of=as_of)
    rec_acc = backtest.form_validity(conn)   # leakage-free Form validator (design 5.2)
    vp = volume.recommend(conn, as_of, prog_map, fat, md, rec_acc)
    print("Recovery-gated set targets (next week):")
    conf = vp.get("recovery_confidence")
    if conf:
        print(f"Recovery confidence: {conf} - {vp.get('recovery_confidence_basis','')}")
    print()
    REC = {"recovering_well": "good", "under_recovering": "POOR",
           "borderline": "mixed", "neutral": "ok", "unknown": "no data",
           "insufficient_data": "no data"}
    for r in vp["recommendations"]:
        if args.muscle and r["muscle"] != args.muscle:
            continue
        ch = ("+%d" % r["delta"]) if r["delta"] > 0 else (str(r["delta"]) if r["delta"] else "hold")
        toward = f" (toward {r['final_target']:g})" if r.get("ramping") else ""
        sc = f" score={r['recovery_score']}" if r.get("recovery_score") is not None else ""
        sig = ("; " + ", ".join(r["signals"])) if r["signals"] else ""
        print(f"  {r['muscle']:<11} {r['current_sets']:>4g} -> {r['target_sets']:>2g}{toward} "
              f"({ch:<5}) recovery={REC.get(r['recovery'], r['recovery'])}{sc}{sig}")
        print(f"              {r['reason']}")


def cmd_backtest(args):
    conn = _open()
    r = backtest.run(conn)
    rp = r["rep_prediction"]
    print("ACCURACY BACKTEST (walk-forward, uses only prior data at each step)\n")
    print("Rep prediction:")
    if rp.get("n"):
        verdict = "BEATS" if rp["beats_naive"] else "does NOT beat"
        print(f"  {rp['n']} predictions, {rp['coverage_pct']}% coverage")
        print(f"  model MAE {rp['model_mae']} reps vs naive(last-session) MAE {rp['naive_mae']} "
              f"-> model {verdict} naive")
    else:
        print(f"  {rp.get('note','n/a')}")
    pp = r["rep_pooling"]
    print("\nRep pooling (#2: borrow the exercise-type load->reps slope for starved lifts):")
    for bucket in ("starved", "rich"):
        b = pp[bucket]
        if b.get("n"):
            print(f"  {bucket:<8} n={b['n']:<4} MAE naive {b['mae_naive']} -> pooled "
                  f"{b['mae_pooled']}  | coverage {b['cov_naive']} -> {b['cov_pooled']}")
        else:
            print(f"  {bucket:<8} no windows")
    print(f"  pre-registered: {pp['rule']} -> "
          f"{'ADOPT pooling' if pp['adopt_pooling'] else 'keep per-exercise only'}")
    he = r["heavy_extrapolation"]
    print("\nHeavy-end 1RM (#4: curvilinear type-curve+anchor vs the linear "
          "extrapolation, on held-out heavy sets):")
    hv = he["heavy"]
    if hv.get("n"):
        print(f"  heavy   n={hv['n']:<4} ({he['lifts_with_heavy_targets']} lifts) "
              f"rep-MAE linear {hv['mae_linear']} -> curvilinear {hv['mae_curvilinear']} "
              f"({int((hv['rel_improvement'] or 0)*100)}% better)")
    else:
        print("  heavy   no held-out above-max targets with reliable RPE yet")
    ib = he["inband"]
    if ib.get("n"):
        print(f"  in-band n={ib['n']:<4} rep-MAE linear {ib['mae_linear']} -> "
              f"curvilinear {ib['mae_curvilinear']} (guardrail; live predictor unchanged)")
    print(f"  pre-registered: {he['rule']} -> "
          f"{'ADOPT curvilinear' if he['adopt_curvilinear'] else 'keep linear'}")
    ef = r["effort_rep_prediction"]
    print("\nPredict-at-effort (#5: predict performed reps as capacity - your "
          "target RIR, vs the raw-reps line):")
    for bucket, label in (("recent", "RIR era"), ("legacy", "no-RIR")):
        b = ef[bucket]
        if b.get("n"):
            print(f"  {bucket:<7} ({label:<7}) n={b['n']:<4} performed-rep MAE baseline "
                  f"{b['mae_baseline']} -> at-effort {b['mae_effort']}")
        else:
            print(f"  {bucket:<7} ({label:<7}) no windows")
    off = ef["effort_offset"]
    if off.get("n"):
        print(f"  effort offset: mean target RIR {off['mean_target_rir']} vs mean actual "
              f"RIR {off['mean_actual_rir']} (n={off['n']}; unbiased if close)")
    print(f"  pre-registered: {ef['rule']} -> "
          f"{'ADOPT predict-at-effort' if ef['adopt_effort'] else 'keep raw-reps line'}")
    ci = r["conformal_rep_intervals"]
    print("\nConformal rep intervals (#6: calibrated, distribution-free band vs the "
          "Gaussian +-1.96*se band):")
    if ci.get("n"):
        ov = ci["overall"]
        print(f"  {ci['n']} windows at nominal {int(ci['level']*100)}% "
              f"({ci['uncalibrated']} uncalibrated/orphan)")
        print(f"  conformal: coverage {ov['coverage']} width {ov['median_width']}  vs  "
              f"Gaussian: coverage {ov['gaussian_coverage']} width {ov['gaussian_median_width']}")
        for g in ci["calibrated_types"]:
            t = ci["by_type"][g]
            print(f"    {g:<14} n={t['n']:<4} conformal cov {t['coverage']} (w {t['median_width']}) "
                  f"| Gaussian cov {t['gaussian_coverage']} (w {t['gaussian_median_width']})")
        if ci.get("degenerate_interval"):
            print("  -> DEGENERATE: top-set reps repeat exactly most sessions, so the honest 80% "
                  "band collapses to ~0 width ('exactly the predicted reps').")
        print(f"  pre-registered: {ci['rule']} -> "
              f"{'ADOPT conformal' if ci['adopt_conformal'] else 'keep Gaussian band'}")
    else:
        print(f"  {ci.get('note','n/a')}")
    fba = r["forecast_band_audit"]
    if fba.get("n"):
        print("\nForecast band (#6: finite-sample conformal correction vs plain percentile):")
        print(f"  plain half {fba['plain_halfwidth']} (cov {fba['plain_coverage']}) -> "
              f"conformal half {fba['conformal_halfwidth']} (cov {fba['conformal_coverage']}), "
              f"width x{fba['width_ratio']}")
        print(f"  -> {'ADOPT corrected band' if fba['adopt_conformal_band'] else 'keep plain percentile'}")
    rv = r["recovery_validity"]
    print("\nRecovery validity (does a better recovery read predict better next ~2wk e1RM?):")
    if rv.get("n", 0) >= 5:
        print(f"  {rv['n']} windows")
        print(f"  corr(full score, next change)     = {rv['corr_full_score_vs_next_change']}")
        print(f"  corr(fatigue signals, next change) = {rv['corr_fatigue_signals_vs_next_change']}")
        print(f"  mean next-change by state: {rv['mean_next_change_by_state']}")
        print(f"  monotone (well >= mid >= under): {rv['monotone_ordering']}")
        cuts = rv.get("suggested_cutoffs")
        if cuts:
            s_ = cuts["suggested"]
            print(f"  suggested cutoffs: well/under = {s_['well']}/{s_['under']} "
                  f"(improves: {cuts['improves_backtest']}; `coach.py calibrate` to apply)")
    else:
        print(f"  {rv.get('note','n/a')}")
    fv = r["form_validity"]
    bar = fv.get("success_bar", {})
    print("\nForm validity (leakage-free: does load-only Form predict next-session "
          "e1RM ABOVE its own trend?):")
    if fv.get("n", 0) >= bar.get("min_n", 8):
        print(f"  {fv['n']} windows")
        print(f"  corr(Form, detrended next change) = {fv['corr_form_vs_residual']}")
        print(f"  residual by Form tercile (low/mid/high) = {fv['resid_by_form_tercile']}")
        print(f"  monotone (low <= mid <= high): {fv['monotone_ordering']}")
        verdict = ("ADOPT over landmarks" if fv["adopt_form_over_landmarks"]
                   else "keep landmarks")
        print(f"  pre-registered bar (n>={bar['min_n']}, r>={bar['min_r']}, monotone)"
              f" -> {verdict}")
    else:
        print(f"  {fv.get('note','n/a')}")
    ga = r["acwr_gate_audit"]
    print("\nACWR gate audit (#3: does the adequacy gate kill the post-gap 4.0 false alarm?):")
    if ga.get("post_gap_old_spike_flags"):
        print(f"  {ga['post_gap_old_spike_flags']} layoff-return days where the OLD ACWR cried 'spike'")
        print(f"  gate reclassified {ga['suppressed_by_gate']} as DETRAINED "
              f"-> {int((ga['suppression_rate'] or 0)*100)}% suppressed "
              f"({'CLEARS' if ga['gate_eliminates_artifact'] else 'BELOW'} the >=90% bar)")
        print(f"  genuine spikes on an adequate base still flagged: {ga['genuine_spikes_still_flagged']}")
        print("  (injury risk itself is not validatable here - no injuries logged)")
    else:
        print(f"  {ga.get('note','no post-gap spike flags in history')}")
    fc = r["forecast"]
    print("\nForecast error (vs flat 'no change' baseline):")
    if fc.get("n"):
        verdict = "BEATS" if fc["beats_flat"] else "does NOT beat"
        print(f"  {fc['n']} forecasts, model MAE {fc['model_mae']} (median {fc['median_ae']}) "
              f"vs flat MAE {fc['flat_mae']} -> model {verdict} flat")
        print(f"  linear-extrapolation reference MAE {fc['linear_mae']} "
              f"(model beats_linear: {fc['beats_linear']})")
        if fc.get("band_coverage") is not None:
            print(f"  calibrated band (level {fc['band_level']}): in-sample coverage "
                  f"{fc['band_coverage']}")
    else:
        print(f"  {fc.get('note','n/a')}")


def cmd_status(args):
    conn = _open()
    n = conn.execute("SELECT COUNT(*) c FROM sets").fetchone()["c"]
    s = conn.execute("SELECT COUNT(*) c FROM sessions").fetchone()["c"]
    last = progression.latest_date(conn)
    pct, counts = memory.adherence_pct(conn)
    print(f"Sets: {n}  Sessions: {s}  Latest: {last}")
    if pct is not None:
        print(f"Adherence to targets: {pct}%  {dict(counts)}")
    else:
        print("Adherence: no graded targets yet.")


def main(argv=None):
    p = argparse.ArgumentParser(prog="coach", description="WorkOut Coach")
    sub = p.add_subparsers(dest="cmd", required=True)

    u = sub.add_parser("update", help="ingest an export and produce the weekly report")
    u.add_argument("csv")
    u.add_argument("--date", help="treat this YYYY-MM-DD as 'now' (default: latest session)")
    u.add_argument("--force", action="store_true", help="re-process even if file is identical")
    u.set_defaults(func=cmd_update)

    r = sub.add_parser("report", help="re-render the report from stored data")
    r.add_argument("--date")
    r.set_defaults(func=cmd_report)

    b = sub.add_parser("log-bw", help="log bodyweight")
    b.add_argument("weight", type=float)
    b.add_argument("--date")
    b.add_argument("--note")
    b.set_defaults(func=cmd_log_bw)

    g = sub.add_parser("set-goal", help="set a goal for a lift")
    g.add_argument("exercise")
    g.add_argument("metric", choices=["e1rm", "weight_for_reps", "bodyweight"])
    g.add_argument("value", type=float)
    g.add_argument("--reps", type=int)
    g.add_argument("--by", help="target date YYYY-MM-DD")
    g.set_defaults(func=cmd_set_goal)

    nt = sub.add_parser("note", help="record a coaching note (injury/program/etc.)")
    nt.add_argument("category")
    nt.add_argument("text")
    nt.set_defaults(func=cmd_note)

    pr = sub.add_parser("predict", help="predict reps + verdict for a weight")
    pr.add_argument("exercise")
    pr.add_argument("weight", type=float)
    pr.set_defaults(func=cmd_predict)

    ca = sub.add_parser("calibrate", help="optional calibration tips for lifts still being learned")
    ca.add_argument("exercise", nargs="?")
    ca.add_argument("--limit", type=int, default=8)
    ca.set_defaults(func=cmd_calibrate)

    cp = sub.add_parser("compare", help="which training style works better for you")
    cp.add_argument("muscle", nargs="?")
    cp.set_defaults(func=cmd_compare)

    se = sub.add_parser("sets", help="recovery-gated set targets per muscle next week")
    se.add_argument("muscle", nargs="?")
    se.add_argument("--date")
    se.set_defaults(func=cmd_sets)

    bt = sub.add_parser("backtest", help="measure prediction accuracy on your history")
    bt.set_defaults(func=cmd_backtest)

    st = sub.add_parser("status", help="quick store status")
    st.set_defaults(func=cmd_status)

    sy = sub.add_parser(
        "sync", help="pull workouts from the Hevy API (replaces the CSV drop)")
    sy.add_argument("--full", action="store_true",
                    help="force a full backfill instead of incremental events")
    sy.add_argument("--date",
                    help="treat this YYYY-MM-DD as 'now' (default: latest session)")
    sy.set_defaults(func=cmd_sync)

    pu = sub.add_parser(
        "push", help="write next week's targets into your existing Hevy routines")
    pu.add_argument("--push", action="store_true",
                    help="actually write to Hevy (default: preview only)")
    pu.add_argument("--date")
    pu.set_defaults(func=cmd_push)

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
