"""Render report.md and dashboard.html - both pure functions of summary.json."""
import json
import os

READINESS_WORD = {"green": "Good to push", "amber": "Proceed with care",
                  "red": "Back off / recover"}
STATUS_ICON = {"progressing": "UP", "plateau": "FLAT", "declining": "DOWN",
               "building": "NEW", "insufficient": "-"}


def _fmt(x, dash="-"):
    return dash if x is None else (f"{x:g}" if isinstance(x, (int, float)) else str(x))


def render_markdown(o):
    w = o["window"]
    ws = o["week_summary"]
    fat = o["fatigue"]
    L = []
    L.append(f"# Weekly Coaching Report - {w['latest_session']}")
    L.append("")
    L.append(f"*Covering {w['weeks_covered']} weeks of training "
             f"({w['first_session']} -> {w['latest_session']}).*")
    L.append("")

    L.append("## Snapshot")
    L.append("")
    L.append(f"- **Sessions (last 7d):** {ws['sessions']}  |  "
             f"**Hard sets:** {ws['total_hard_sets']}  |  "
             f"**~{fat['frequency']['per_week_28d']}/wk** over the last 4 weeks")
    L.append(f"- **Readiness:** {fat['readiness'].upper()} - {READINESS_WORD[fat['readiness']]}")
    gc = o.get("grace_overview")
    if gc:
        L.append(f"- **Coach confidence:** {gc.get('confident',0)} lifts learned, "
                 f"{gc.get('learning',0)} learning, {gc.get('calibrating',0)} still calibrating")
    if o["data_quality"]["import"]["inserted"]:
        imp = o["data_quality"]["import"]
        L.append(f"- **New this import:** {imp['inserted']} sets added"
                 + (f", {imp['updated']} edited" if imp["updated"] else ""))
    L.append("")

    na = o.get("next_actions")
    if na:
        L.append("## Do next")
        L.append("")
        for a in na:
            L.append(f"- **{a['title']}** - {a['detail']}")
        L.append("")

    if o["headline_flags"]:
        L.append("## What matters most")
        L.append("")
        for f in o["headline_flags"]:
            L.append(f"- {f}")
        L.append("")

    L.append("## Fatigue & readiness")
    L.append("")
    for r in fat["reasons"]:
        L.append(f"- {r}")
    bits = []
    if fat["acwr_global"] is not None:
        bits.append(f"ACWR {fat['acwr_global']}")
    if fat["monotony"] is not None:
        bits.append(f"monotony {fat['monotony']}")
    if fat["intra_session_dropoff_avg"] is not None:
        bits.append(f"last-session rep drop-off {int(fat['intra_session_dropoff_avg']*100)}%")
    if bits:
        L.append("")
        L.append("*Signals: " + ", ".join(bits) + ".*")
    L.append("")

    L.append("## Muscle balance (avg sets/week, last 4 weeks)")
    L.append("")
    L.append("| Muscle | Sets/wk | MEV | Target | Status |")
    L.append("|---|---|---|---|---|")
    det = ws["muscle_detail"]
    for m, d in sorted(det.items(), key=lambda x: -(x[1]["sets_per_week"])):
        if d["mev"] is None:
            continue
        L.append(f"| {m} | {d['sets_per_week']} | {d['mev']} | {d['mav']} | {d['status']} |")
    r = ws["ratios"]
    L.append("")
    L.append(f"- **Push:Pull** {_fmt(r['push_pull'])} (target ~{r['push_pull_target']})  |  "
             f"**Upper:Lower** {_fmt(r['upper_lower'])} (target ~{r['upper_lower_target']})")
    L.append("")

    from datetime import timedelta
    as_of_dt = __import__("workout.dates", fromlist=["from_iso"]).from_iso(
        o["window"]["latest_session"] + "T00:00:00")
    cutoff = (as_of_dt - timedelta(days=56)).strftime("%Y-%m-%d")
    recent = [e for e in o["exercises"] if (e.get("last_trained") or "") >= cutoff]
    older = len(o["exercises"]) - len(recent)

    L.append("## Progress & next-session targets")
    L.append("")
    L.append(f"*Your current rotation - {len(recent)} lifts trained in the last 8 weeks"
             + (f"; {older} older lifts are in the dashboard/JSON." if older else "") + "*")
    L.append("")
    L.append("| Lift | Status | Best e1RM | Trend/wk | Next session | Predicted |")
    L.append("|---|---|---|---|---|---|")
    for e in recent:
        nt = e["next_target"]
        if nt.get("sets"):
            tgt = f"{nt['rec_type']}: {nt['n_sets']}x{nt['sets'][0]['reps']} @ {nt['weight']:g}"
        else:
            tgt = nt["rec_type"]
        if nt.get("predicted_reps") is not None:
            pr = nt["predicted_range"]
            pred = f"~{nt['predicted_reps']:g} reps ({pr[0]:g}-{pr[1]:g})"
        else:
            pred = "learning"
        L.append(f"| {e['name']} | {STATUS_ICON.get(e['status'],'-')} {e['status']} | "
                 f"{_fmt(e['best_e1rm'])} | {_fmt(e['e1rm_trend_per_week'])} | {tgt} | {pred} |")
    L.append("")

    fcs = [e for e in o["exercises"] if e["forecast"]["e1rm_in_horizon"]]
    if fcs:
        L.append("## Forecasts (8-week projection)")
        L.append("")
        for e in fcs[:8]:
            fc = e["forecast"]
            band = f" (range {fc['band'][0]}-{fc['band'][1]})" if fc["band"] else ""
            L.append(f"- **{e['name']}**: {_fmt(e['best_e1rm'])} -> "
                     f"~{fc['e1rm_in_horizon']}{band}")
        L.append("")

    if o["goals"]:
        L.append("## Goals")
        L.append("")
        for g in o["goals"]:
            extra = f" - projected {g.get('projected_date')}" if g.get("projected_date") else ""
            L.append(f"- **{g['exercise']}** -> {g['target_value']} ({g['metric']}): "
                     f"{g['verdict']}{extra}")
        L.append("")

    vp = o.get("volume_plan")
    if vp and vp.get("recommendations"):
        recs = vp["recommendations"]
        movers = [r for r in recs if r["action"] not in ("hold",)]
        L.append("## Set targets next week (recovery-gated)")
        L.append("")
        conf = vp.get("recovery_confidence")
        if conf == "low":
            L.append(f"> **Recovery confidence: low.** {vp.get('recovery_confidence_basis','')} "
                     "These targets lean on your volume landmarks (MEV/MAV/MRV), not the "
                     "recovery read.")
            L.append("")
        elif conf:
            L.append(f"*Recovery confidence: {conf} — {vp.get('recovery_confidence_basis','')}.*")
            L.append("")
        L.append("*Sets are only added where you're recovering well. Where recovery "
                 "is poor, the plan holds or cuts instead of digging deeper. Recovery "
                 "is a directional estimate — run `coach.py backtest` to see how "
                 "predictive it's been on your data, and log RPE to strengthen it.*")
        L.append("")
        L.append("| Muscle | Now | Target | Change | Recovery | Why |")
        L.append("|---|---|---|---|---|---|")
        REC_WORD = {"recovering_well": "good", "under_recovering": "poor",
                    "borderline": "mixed", "neutral": "ok", "unknown": "no data",
                    "insufficient_data": "no data"}
        show = movers if movers else recs
        for r in show[:12]:
            ch = ("+%d" % r["delta"]) if r["delta"] > 0 else (str(r["delta"]) if r["delta"] else "hold")
            tgt = f"{r['target_sets']:g}" + (f" (->{r['final_target']:g})" if r.get("ramping") else "")
            L.append(f"| {r['muscle']} | {r['current_sets']:g} | {tgt} | "
                     f"{ch} | {REC_WORD.get(r['recovery'], r['recovery'])} | {r['reason']} |")
        L.append("")

    if o.get("detraining"):
        L.append("## Detraining alert")
        L.append("")
        L.append(f"- {o['detraining']['message']}")
        L.append("")

    if o.get("deload"):
        dl = o["deload"]
        L.append("## Deload check")
        L.append("")
        for r in dl["reasons"]:
            L.append(f"- {r}")
        L.append("")
        L.append(f"*{dl['protocol']} {dl['note']}*")
        L.append("")

    ind1 = [e for e in o["exercises"]
            if e.get("individualization", {}).get("individ_1rm")]
    if ind1:
        L.append("## Personalized 1RM estimates (from your own load-rep curve)")
        L.append("")
        for e in ind1[:8]:
            iv = e["individualization"]
            L.append(f"- **{e['name']}**: ~{iv['individ_1rm']} "
                     f"({iv['confidence']}% confident)")
        L.append("")

    exp = o.get("experiment", {})
    if exp.get("muscles"):
        L.append("## What's working for your body (experiment & compare)")
        L.append("")
        for m in exp["muscles"]:
            L.append(f"- {m['text']}")
        if exp.get("note"):
            L.append("")
            L.append(f"*{exp['note']}*")
        L.append("")

    calib = [e for e in o["exercises"]
             if e.get("individualization", {}).get("grace_state") == "calibrating"
             and (e.get("last_trained") or "") >= cutoff]
    if calib:
        L.append("## Still calibrating (the coach is honest about what it doesn't know yet)")
        L.append("")
        L.append("These lifts need a bit more data before rep predictions are reliable. "
                 "Run `python coach.py calibrate` for optional ways to speed it up:")
        L.append("")
        for e in calib[:8]:
            L.append(f"- {e['name']} ({e['individualization']['n_fresh']} fresh sets)")
        L.append("")

    dq = o["data_quality"]
    if dq["anomalies_corrected"] or dq["unit_epochs"]:
        L.append("## Data quality notes")
        L.append("")
        for a in dq["anomalies_corrected"]:
            L.append(f"- Corrected {a['exercise']} ({a['date']}): {a['field']} "
                     f"{a['raw']} -> {a['corrected']} (kept raw).")
        for u in dq["unit_epochs"]:
            L.append(f"- {u['exercise']}: {u['epochs']} logging-unit eras detected; "
                     "progression indexed per-era.")
        L.append("")

    L.append("---")
    L.append("*Generated by WorkOut Coach. Estimates (e1RM, fatigue, forecasts) are "
             "directional, not medical advice.*")
    return "\n".join(L)


def render_dashboard(o):
    data = json.dumps(o)
    return _DASHBOARD_HTML.replace("/*__DATA__*/", data)


def write_all(o, outdir):
    with open(os.path.join(outdir, "report.md"), "w", encoding="utf-8") as f:
        f.write(render_markdown(o))
    with open(os.path.join(outdir, "dashboard.html"), "w", encoding="utf-8") as f:
        f.write(render_dashboard(o))


_DASHBOARD_HTML = r"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WorkOut Coach</title>
<style>
:root{
 --bg:#fbfcfe;--surface:#ffffff;--surface-2:#f3f5f9;--border:#e7eaf0;--border-2:#d7dce5;
 --text:#171c26;--text-2:#586173;--text-3:#8b94a6;
 --ac:#4f46e5;--ac-text:#4338ca;
 --ok:#1f8a4d;--warn:#a96a12;--bad:#c23a2e;
 /* soft data-viz palette (charts only; chrome stays slate+indigo) */
 --v-blue:#5b8def;--v-teal:#2fb6ac;--v-green:#3fa46a;--v-amber:#e0a83b;--v-orange:#e0843b;--v-rose:#e0739a;--v-violet:#9b7ede;
 --r-sm:8px;--r:12px;--r-lg:16px;
 --fs:15px;
}
:root[data-theme="dark"]{
 --bg:#0a0d13;--surface:#0f131b;--surface-2:#151b24;--border:#212834;--border-2:#2e3744;
 --text:#e7ebf3;--text-2:#9aa4b5;--text-3:#69727f;
 --ac:#828bf8;--ac-text:#a9b2ff;
 --ok:#4ec27d;--warn:#d49a3b;--bad:#e16a5e;
 --v-blue:#6e9bf2;--v-teal:#3fc7bc;--v-green:#52b87e;--v-amber:#e8bb5a;--v-orange:#e8975a;--v-rose:#e88aaa;--v-violet:#ad92e8;
}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){
 --bg:#0a0d13;--surface:#0f131b;--surface-2:#151b24;--border:#212834;--border-2:#2e3744;
 --text:#e7ebf3;--text-2:#9aa4b5;--text-3:#69727f;
 --ac:#828bf8;--ac-text:#a9b2ff;
 --ok:#4ec27d;--warn:#d49a3b;--bad:#e16a5e;
 --v-blue:#6e9bf2;--v-teal:#3fc7bc;--v-green:#52b87e;--v-amber:#e8bb5a;--v-orange:#e8975a;--v-rose:#e88aaa;--v-violet:#ad92e8;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);
 font:var(--fs)/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
 font-feature-settings:"cv05","ss01";letter-spacing:-.005em}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.num{font-variant-numeric:tabular-nums}
svg{display:block}
a{color:var(--ac);text-decoration:none}
.ic{display:inline-flex;align-items:center;justify-content:center}
.ic svg{width:18px;height:18px;stroke:currentColor;stroke-width:1.75;fill:none;stroke-linecap:round;stroke-linejoin:round}

.topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:14px;
 padding:11px 22px;background:color-mix(in srgb,var(--surface) 88%,transparent);
 backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--border)}
.brand{font-weight:600;font-size:16px;letter-spacing:-.02em;display:flex;align-items:center;gap:9px}
.logo{width:24px;height:24px;border-radius:7px;background:var(--ac);display:grid;place-items:center;color:#fff}
.logo svg{width:15px;height:15px;stroke:#fff;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}
.subdate{color:var(--text-3);font-size:12.5px}
.spacer{flex:1}
.search{display:flex;align-items:center;gap:8px;background:var(--surface-2);border:1px solid var(--border);
 border-radius:var(--r-sm);padding:0 11px;height:36px;min-width:150px;color:var(--text-3)}
.search:focus-within{border-color:var(--ac);color:var(--text-2)}
.search input{border:0;background:transparent;color:var(--text);outline:none;font-size:13.5px;flex:1;width:auto;min-width:40px}
.srch-clear{flex:none;border:0;background:transparent;color:var(--text-3);cursor:pointer;display:inline-flex;align-items:center;padding:2px;border-radius:5px}
.srch-clear svg{width:14px;height:14px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}
.srch-clear:hover{color:var(--text);background:var(--border)}
.srch-clear[hidden]{display:none}
.iconbtn{display:inline-flex;align-items:center;gap:7px;cursor:pointer;height:36px;padding:0 11px;
 border:1px solid var(--border);background:var(--surface);color:var(--text-2);border-radius:var(--r-sm);
 font-size:13.5px;font-weight:500}
.iconbtn:hover{background:var(--surface-2);color:var(--text)}
.menu{position:relative}
.menu .pop{position:absolute;right:0;top:42px;background:var(--surface);border:1px solid var(--border);
 border-radius:var(--r);box-shadow:0 8px 28px rgba(16,24,40,.12);padding:6px;display:none;min-width:208px;z-index:40}
.menu.open .pop{display:block}
.menu .pop button{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;background:transparent;
 color:var(--text);padding:9px 11px;border-radius:var(--r-sm);cursor:pointer;font-size:13.5px}
.menu .pop button:hover{background:var(--surface-2)}

.tabsbar{position:sticky;top:59px;z-index:20;background:color-mix(in srgb,var(--bg) 92%,transparent);
 backdrop-filter:blur(6px);border-bottom:1px solid var(--border);padding:9px 18px}
.tabs{display:flex;gap:3px;max-width:1120px;margin:0 auto;overflow-x:auto;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tab{white-space:nowrap;cursor:pointer;border:0;background:transparent;color:var(--text-2);
 font-weight:500;font-size:13.5px;padding:7px 12px;border-radius:var(--r-sm);
 display:inline-flex;align-items:center;gap:7px}
.tab .tic{display:inline-flex;color:var(--text-3)}
.tab .tic svg{width:15px;height:15px;stroke:currentColor;stroke-width:1.85;fill:none;stroke-linecap:round;stroke-linejoin:round}
.tab:hover{color:var(--text);background:var(--surface-2)}
.tab:hover .tic{color:var(--text-2)}
.tab.active{color:var(--ac-text);background:color-mix(in srgb,var(--ac) 12%,var(--surface))}
.tab.active .tic{color:var(--ac)}

.wrap{max-width:1120px;margin:0 auto;padding:26px 22px 40px}
.panel{display:none}.panel.on{display:block;animation:fade .18s ease}
@keyframes fade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
h2{font-size:22px;font-weight:600;letter-spacing:-.02em;margin:2px 0 6px}
h3{font-size:15.5px;font-weight:600;letter-spacing:-.01em;margin:34px 0 14px;padding-top:18px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px;color:var(--text)}
h3::before{content:"";flex:none;width:3px;height:15px;border-radius:2px;background:var(--ac)}
.panel>h3:first-of-type{border-top:0;padding-top:0;margin-top:22px}
.subhd{border-top:0;padding-top:0;margin-top:20px;font-size:14px;color:var(--text-2)}
.subhd::before{display:none}
.lead{color:var(--text-2);margin:0 0 22px;font-size:15px;max-width:68ch}

.kpis{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.metric{background:var(--surface-2);border-radius:var(--r);padding:15px 17px}
.metric .k{color:var(--text-2);font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px}
.metric .v{font-size:25px;font-weight:600;margin-top:6px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:17px 19px}

.pill{display:inline-flex;align-items:center;padding:2px 10px;border-radius:999px;font-size:12.5px;font-weight:500;letter-spacing:0}
.pill[data-tone=ok]{color:var(--ok);background:color-mix(in srgb,var(--ok) 13%,var(--surface))}
.pill[data-tone=warn]{color:var(--warn);background:color-mix(in srgb,var(--warn) 15%,var(--surface))}
.pill[data-tone=bad]{color:var(--bad);background:color-mix(in srgb,var(--bad) 13%,var(--surface))}
.pill[data-tone=ac]{color:var(--ac-text);background:color-mix(in srgb,var(--ac) 12%,var(--surface))}
.pill[data-tone=mut]{color:var(--text-2);background:var(--surface-2)}
.s-progressing,.s-recovering_well{color:var(--ok)}
.s-plateau,.s-borderline{color:var(--warn)}
.s-declining,.s-under_recovering{color:var(--bad)}
.s-building,.s-insufficient,.s-insufficient_data,.s-unknown,.s-neutral{color:var(--text-3)}
.info{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;
 border:1px solid var(--border-2);color:var(--text-3);font-size:10px;font-weight:600;cursor:help;font-style:normal}

.hero{display:grid;gap:11px;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));margin:4px 0}
.act{display:flex;gap:13px;align-items:flex-start;background:var(--surface);border:1px solid var(--border);
 border-radius:var(--r);padding:14px 15px}
.act.p0{border-color:color-mix(in srgb,var(--ac) 42%,var(--border))}
.act .em{flex:none;width:34px;height:34px;border-radius:var(--r-sm);display:grid;place-items:center}
.act .em svg{width:18px;height:18px;stroke-width:1.75;fill:none;stroke-linecap:round;stroke-linejoin:round}
.act .t{font-weight:600;font-size:14px;letter-spacing:-.01em}
.act .d{color:var(--text-2);font-size:13px;margin-top:3px}
.act .go{margin-top:9px;display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:500;
 color:var(--ac);background:none;border:0;cursor:pointer;padding:0}
.act .go svg{width:14px;height:14px;stroke:currentColor;stroke-width:1.75;fill:none}
.status{display:flex;gap:16px;align-items:flex-start;background:var(--surface);border:1px solid var(--border);
 border-radius:var(--r-lg);padding:18px 20px;margin:6px 0 4px}
.status.p0{border-color:color-mix(in srgb,var(--ac) 38%,var(--border));background:color-mix(in srgb,var(--ac) 5%,var(--surface))}
.status .em{flex:none;width:44px;height:44px;border-radius:var(--r);display:grid;place-items:center}
.status .em svg{width:23px;height:23px;stroke-width:1.7;fill:none;stroke-linecap:round;stroke-linejoin:round}
.status .body{flex:1;min-width:0}
.status .eyebrow{font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--text-3)}
.status .title{font-size:18px;font-weight:600;letter-spacing:-.01em;margin:3px 0 4px}
.status .detail{color:var(--text-2);font-size:13.5px}
.status .go{margin-top:11px;display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:500;color:var(--ac);background:none;border:0;cursor:pointer;padding:0}
.status .go svg{width:15px;height:15px;stroke:currentColor;stroke-width:1.75;fill:none}
.status .readiness{flex:none;text-align:right}
.status .readiness .rlabel{font-size:11px;color:var(--text-3);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em}
ol.focus{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;max-width:860px}
ol.focus li{display:flex;gap:12px;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:10px 14px}
ol.focus .em{flex:none;width:30px;height:30px;border-radius:8px;display:grid;place-items:center}
ol.focus .em svg{width:17px;height:17px;stroke-width:1.75;fill:none;stroke-linecap:round;stroke-linejoin:round}
ol.focus .ftx{flex:1;min-width:0}
ol.focus .t{font-weight:600;font-size:13.5px;display:block}
ol.focus .d{color:var(--text-2);font-size:12.5px;display:block;margin-top:1px}
ol.focus .go{flex:none;color:var(--ac);background:none;border:0;cursor:pointer;display:inline-flex;padding:4px}
ol.focus .go svg{width:16px;height:16px;stroke:currentColor;stroke-width:1.75;fill:none}
.wins{display:flex;flex-wrap:wrap;gap:8px;max-width:860px}
.win{display:inline-flex;align-items:center;gap:8px;background:color-mix(in srgb,var(--ok) 10%,var(--surface));
 border:1px solid color-mix(in srgb,var(--ok) 26%,var(--border));border-radius:999px;padding:6px 13px;font-size:12.5px;color:var(--text)}
.win .ic{display:inline-flex;color:var(--ok)}.win .ic svg{width:14px;height:14px;stroke:currentColor;stroke-width:1.75;fill:none}

ul.flags{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;max-width:860px}
.flag{display:flex;gap:12px;align-items:flex-start;background:var(--surface);border:1px solid var(--border);
 border-radius:var(--r);padding:11px 14px}
.flag .fic{flex:none;width:28px;height:28px;border-radius:8px;display:grid;place-items:center}
.flag .fic svg{width:16px;height:16px;stroke-width:1.75;fill:none;stroke-linecap:round;stroke-linejoin:round}
.flag .ft{font-size:13.5px;color:var(--text-2);line-height:1.5;align-self:center}
.flag .ft b{color:var(--text);font-weight:600}

.tablewrap{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--border);vertical-align:top;white-space:nowrap}
th{color:var(--text-2);font-weight:600;font-size:12.5px;position:sticky;top:0;background:var(--surface)}
th.num,td.num{text-align:right;font-variant-numeric:tabular-nums}
tbody td:first-child{font-weight:500}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--surface-2)}

.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0 16px}
select{font:inherit;font-size:13.5px;font-weight:500;height:36px;padding:0 32px 0 12px;border:1px solid var(--border);
 border-radius:var(--r-sm);background:var(--surface);color:var(--text);
 appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--text-3) 50%),linear-gradient(135deg,var(--text-3) 50%,transparent 50%);
 background-position:calc(100% - 16px) 15px,calc(100% - 11px) 15px;background-size:5px 5px;background-repeat:no-repeat}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{cursor:pointer;border:1px solid var(--border);background:var(--surface);color:var(--text-2);
 border-radius:999px;padding:6px 13px;font-size:12.5px;font-weight:500;text-transform:capitalize}
.chip:hover{color:var(--text);border-color:var(--border-2)}
.chip.on{background:color-mix(in srgb,var(--ac) 12%,var(--surface));color:var(--ac-text);border-color:transparent}
.chip .cdot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:middle}

.srchnote{display:flex;align-items:center;gap:9px;margin:-4px 0 16px;padding:9px 13px;font-size:13px;color:var(--text-2);
 background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-sm)}
.srchnote[hidden]{display:none}
.srchnote .sn-ic{display:inline-flex;color:var(--text-3)}
.srchnote .sn-ic svg{width:15px;height:15px;stroke:currentColor;stroke-width:1.85;fill:none;stroke-linecap:round;stroke-linejoin:round}
.srchnote b{color:var(--text);font-weight:600}
.srchnote .go{color:var(--ac);background:none;border:0;cursor:pointer;font:inherit;font-weight:600;padding:0}
.srchnote .go:hover{text-decoration:underline}

.statline{display:flex;gap:10px;flex-wrap:wrap;margin:4px 0 16px}
.statline .s{display:flex;flex-direction:column;gap:2px;min-width:80px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-sm);padding:8px 13px;font-size:11px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--text-3)}
.statline .s b{color:var(--text);font-weight:600;font-size:15px;font-variant-numeric:tabular-nums;margin-left:0;letter-spacing:0;text-transform:none}
.chartbox{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px}
svg.chart,svg.heat{width:100%;height:auto}
.chart .grid{stroke:var(--border)}
.chart .ax{fill:var(--text-3);font-size:10.5px;font-variant-numeric:tabular-nums}
.chart .area{fill:var(--v-blue);opacity:.1}
.chart .line{fill:none;stroke:var(--v-blue);stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}
.chart .pt{fill:var(--surface);stroke:var(--v-blue);stroke-width:1.6}
.chart .fc{fill:none;stroke:var(--v-violet);stroke-width:1.8;stroke-dasharray:5 5}
.chart .fcpt{fill:var(--v-violet)}
.chart .star{fill:var(--warn);stroke:none}
.chart .onset{stroke:var(--warn);stroke-width:1.3;stroke-dasharray:3 4}
.chart .bar{transition:opacity .12s}
.chart .bar:hover{opacity:.78}
.chart .base{stroke:var(--border-2)}
.clegend{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--text-3);margin-bottom:10px;align-items:center}
.clegend i{display:inline-block;width:14px;height:0;border-top:2px solid var(--v-blue);vertical-align:middle;margin-right:5px}
.clegend i.dash{border-top-style:dashed;border-color:var(--v-violet)}
.clegend i.dot{width:9px;height:9px;border:0;border-radius:50%;background:var(--warn)}

.rrow{display:flex;align-items:center;gap:13px;margin:11px 0;font-size:14px}
.rlab{width:96px;text-transform:capitalize;font-weight:600;color:var(--text)}
.rtrack{flex:1;position:relative;height:22px}
.rzones{position:absolute;inset:0;border:1px solid var(--border);border-radius:var(--r-sm);overflow:hidden}
.rdot{position:absolute;top:50%;width:13px;height:13px;border-radius:50%;transform:translate(-50%,-50%);
 border:2px solid var(--surface);box-shadow:0 0 0 1px var(--border-2);z-index:2}
.rtick{position:absolute;top:-3px;bottom:-3px;width:2px;border-radius:2px;background:var(--ac);transform:translateX(-50%);z-index:1}
.rtick::after{content:"";position:absolute;left:50%;top:-6px;transform:translateX(-50%);
 border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--ac)}
.rval{width:158px;text-align:right;color:var(--text-2);font-variant-numeric:tabular-nums;font-size:13px}
.rval b{color:var(--text);font-weight:600;margin-right:4px}
.lgdot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--text-2);
 border:2px solid var(--surface);box-shadow:0 0 0 1px var(--border-2);vertical-align:-1px;margin-right:6px}
.lgtick{display:inline-block;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;
 border-top:6px solid var(--ac);vertical-align:2px;margin-right:6px}

.reccards{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
.reccard{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--border-2);border-radius:var(--r);padding:16px 18px;scroll-margin-top:130px;transition:box-shadow .15s}
.reccard.hl{box-shadow:0 0 0 3px color-mix(in srgb,var(--ac) 18%,transparent);border-left-color:var(--ac)}
.reccard[data-tone=ok]{border-left-color:var(--ok)}
.reccard[data-tone=warn]{border-left-color:var(--warn)}
.reccard[data-tone=bad]{border-left-color:var(--bad)}
.reccard[data-tone=ac]{border-left-color:var(--ac)}
.reccard .top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:14px}
.reccard .nm{font-weight:700;text-transform:capitalize;font-size:15px;letter-spacing:-.01em;line-height:1.3}
.reccard .sets-row{display:flex;align-items:baseline;gap:6px;margin-bottom:14px}
.reccard .sets-now{font-size:26px;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.reccard .sets-arr{color:var(--text-3);font-size:15px;margin:0 1px}
.reccard .sets-tgt{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums}
.reccard[data-tone=ok] .sets-tgt{color:var(--ok)}
.reccard[data-tone=warn] .sets-tgt{color:var(--warn)}
.reccard[data-tone=bad] .sets-tgt{color:var(--bad)}
.reccard[data-tone=ac] .sets-tgt{color:var(--ac-text)}
.reccard .sets-unit{font-size:11px;color:var(--text-3);font-weight:500;text-transform:uppercase;letter-spacing:.04em;align-self:flex-end;padding-bottom:3px}
.reccard .sigs{margin-bottom:10px;display:flex;flex-direction:column;gap:4px}
.reccard .sig{color:var(--text-2);font-size:12.5px;display:flex;gap:6px;align-items:flex-start;line-height:1.45}
.reccard .sig-dot{flex:none;width:5px;height:5px;border-radius:50%;background:var(--border-2);margin-top:5.5px}
.reccard .reason{color:var(--text-2);font-size:12.5px;border-top:1px solid var(--border);padding-top:10px;line-height:1.5}
.reccard .reason b{color:var(--text);font-weight:600}
.reccard .star{color:var(--warn)}
.grphd{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin:24px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--text-2)}
.grphd span{font-weight:500;letter-spacing:0;text-transform:none;color:var(--text-3);font-variant-numeric:tabular-nums}
#vol-ranges>.grphd:first-child,#vol-recovery>.grp:first-child>.grphd{margin-top:6px}
.grp{margin-bottom:6px}
#vol-table .grprow td{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--text-3);background:var(--surface-2);padding:9px 12px 6px}
#rec-table th[data-sort]{cursor:pointer;user-select:none;white-space:nowrap}
#rec-table th[data-sort]:hover{color:var(--text-2)}
#rec-table th.sorted{color:var(--ac-text)}
#rec-table th .arr{margin-left:4px;font-size:10px}
#rec-table td .big{color:var(--text);font-weight:600}
#rec-table .dim{color:var(--text-3)}
.recstar{display:inline-flex;width:13px;height:13px;color:var(--warn);vertical-align:-2px;margin-right:5px}
.recstar svg{width:13px;height:13px;stroke:currentColor;stroke-width:1.75;fill:none}

.gauge{margin:13px 0}
.glabel{font-size:12.5px;color:var(--text-2);font-weight:500;margin-bottom:6px;display:flex;justify-content:space-between}
.glabel b{color:var(--text);font-variant-numeric:tabular-nums}
.gtrack{position:relative;height:10px;background:var(--surface-2);border-radius:999px;overflow:visible}
.gfill{height:100%;background:var(--ac);border-radius:999px}
.gtarget{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--text);border-radius:2px}
.balwarn{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--warn);background:color-mix(in srgb,var(--warn) 9%,var(--surface));border:1px solid color-mix(in srgb,var(--warn) 26%,var(--border));border-radius:var(--r-sm);padding:9px 12px;margin-bottom:14px}
.balwarn svg{width:15px;height:15px;flex:none;margin-top:1px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}

.legend{font-size:12.5px;color:var(--text-2);margin:0 0 14px;display:flex;gap:16px;flex-wrap:wrap;align-items:center}
.swatch{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:6px;vertical-align:-1px}

.bodywrap{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:14px}
.bodywrap svg{width:100%;height:auto;max-width:540px;margin:0 auto}
.sil{fill:var(--surface-2);stroke:var(--border);stroke-width:1}
.mz{stroke:var(--surface);stroke-width:1;stroke-linejoin:round;cursor:pointer;transition:opacity .12s}
.mz:hover{opacity:.8}
.det{fill:none;stroke:var(--surface);stroke-width:1.3;stroke-linecap:round;opacity:.6;pointer-events:none}
.figlabel{fill:var(--text-3);font-size:11px;font-weight:500;text-anchor:middle}

.heat .cell{stroke:var(--surface);stroke-width:1.5}
.heat .cell.has{cursor:pointer}
.heat .cell.has:hover{stroke:var(--text);stroke-width:1.5}
.heat .wd{fill:var(--text-3);font-size:10px}
.heatlegend{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text-3);margin-top:10px;justify-content:flex-end}
.heatlegend .sq{width:11px;height:11px;border-radius:3px}

.calgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;max-width:330px}
.calgrid .cell{aspect-ratio:1;border:1px solid var(--border);border-radius:var(--r-sm);display:flex;align-items:center;
 justify-content:center;font-size:12.5px;color:var(--text-3);font-variant-numeric:tabular-nums}
.calgrid .cell.has{cursor:pointer;color:var(--text);font-weight:500;border-color:transparent}
.calgrid .cell.sel{box-shadow:0 0 0 2px var(--ac)}
.calgrid .hd{aspect-ratio:auto;border:0;color:var(--text-3);font-size:11px;font-weight:600}
.monthnav{display:flex;align-items:center;gap:14px;margin:16px 0 11px}
.monthnav b{font-size:14px;font-weight:600;min-width:96px}
.monthnav button{cursor:pointer;border:1px solid var(--border);background:var(--surface);color:var(--text-2);
 border-radius:var(--r-sm);width:32px;height:32px;display:grid;place-items:center}
.monthnav button:hover{background:var(--surface-2);color:var(--text)}
.monthnav button svg{width:16px;height:16px;stroke:currentColor;stroke-width:1.75;fill:none;stroke-linecap:round;stroke-linejoin:round}
.daydetail{margin-top:16px}

.rings{display:grid;gap:13px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.goalcard{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:16px;text-align:center}
.goalcard .nm{font-weight:600;margin-bottom:8px;text-transform:capitalize}
.ring{width:118px;height:118px}
.ringbg{fill:none;stroke:var(--surface-2);stroke-width:10}
.ringfg{fill:none;stroke-width:10;stroke-linecap:round}
.ringtx{fill:var(--text);font-size:21px;font-weight:600;font-variant-numeric:tabular-nums}

.empty{color:var(--text-3);background:var(--surface);border:1px dashed var(--border-2);border-radius:var(--r);
 padding:24px;text-align:center;font-size:13.5px;display:flex;flex-direction:column;align-items:center;gap:10px}
.empty svg{width:26px;height:26px;stroke:var(--text-3);stroke-width:1.5;fill:none;stroke-linecap:round;stroke-linejoin:round}
.empty code{background:var(--surface-2);padding:2px 6px;border-radius:5px;font-size:12.5px}

.tip{position:fixed;z-index:60;display:none;pointer-events:none;background:var(--text);color:var(--bg);
 padding:8px 11px;border-radius:var(--r-sm);font-size:12px;max-width:280px;line-height:1.5;
 box-shadow:0 6px 22px rgba(0,0,0,.22)}
.tip b{font-weight:600}
.foot{color:var(--text-3);font-size:12px;margin:34px 0 4px;border-top:1px solid var(--border);padding-top:16px}

/* ---- powerlifting tab ---- */
.pl-sub{color:var(--text-2);font-size:12.5px;line-height:1.5}
.pl-u{font-size:12px;color:var(--text-3);font-weight:500;margin-left:3px}
.pl-gain{font-size:14px;font-weight:600;color:var(--ok);margin-left:3px}
.pl-hero{display:flex;gap:16px;flex-wrap:wrap;align-items:stretch;background:var(--surface);border:1px solid var(--border);
 border-radius:var(--r-lg);padding:18px 20px;margin:6px 0 14px}
.pl-hero-main{flex:1;min-width:200px}
.pl-hero-k{font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--text-3)}
.pl-hero-v{font-size:44px;font-weight:700;letter-spacing:-.03em;line-height:1.05;margin-top:4px}
.pl-hero-sub{color:var(--text-2);font-size:13px;margin-top:4px}
.pl-hero-stats{display:grid;grid-template-columns:repeat(3,minmax(96px,1fr));gap:10px;align-items:start}
.plcards{display:grid;gap:11px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));margin-bottom:6px}
.plcard{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:15px 16px;border-top:3px solid var(--ac)}
.plcard[data-go-lift]{cursor:pointer;transition:box-shadow .15s,border-color .15s}
.plcard[data-go-lift]:hover{box-shadow:0 4px 18px rgba(16,24,40,.08);border-color:var(--border-2)}
.plcard.absent{border-top-color:var(--border-2);opacity:.85}
.plcard .pl-k{font-size:13px;font-weight:600;color:var(--text-2);display:flex;align-items:center;gap:8px;justify-content:space-between}
.plcard .pl-v{font-size:30px;font-weight:700;letter-spacing:-.03em;margin:6px 0 4px;font-variant-numeric:tabular-nums}
.plcard .pl-row{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;color:var(--text-2);flex-wrap:wrap}
.plcard .pl-row b{color:var(--text);font-weight:600}
.plcard .pl-ceil{margin-top:10px;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-3)}
.plcard .pl-ceilbar{flex:1;height:5px;background:var(--surface-2);border-radius:999px;overflow:hidden}
.plcard .pl-ceilbar>div{height:100%;background:var(--ac);border-radius:999px}
.plcard .pl-absent{display:flex;align-items:center;gap:8px;color:var(--text-3);font-size:18px;font-weight:600;margin:8px 0 2px}
.plcard .pl-absent svg{width:18px;height:18px;stroke:currentColor;stroke-width:1.75;fill:none}
.plcard .pl-sub{margin-top:2px}
.chip.disabled{opacity:.4;cursor:not-allowed;text-decoration:line-through}

.strow{display:flex;align-items:center;gap:13px;margin:10px 0;font-size:13px}
.stlab{width:96px;font-weight:600;display:flex;flex-direction:column;gap:1px}
.stbracket{font-size:11px;font-weight:500;color:var(--ac-text)}
.sttrack{flex:1;position:relative;height:18px;border-radius:var(--r-sm);overflow:hidden;background:var(--surface-2)}
.stseg{position:absolute;top:0;bottom:0}
.stmark{position:absolute;top:-3px;bottom:-3px;width:3px;background:var(--text);border-radius:2px;transform:translateX(-50%);z-index:2}
.stval{width:120px;text-align:right;color:var(--text-3);font-size:12px;font-variant-numeric:tabular-nums}
.stval b{color:var(--text);font-weight:600}

.pl-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.pl-plates{display:flex;gap:3px;flex-wrap:wrap}
.plchip{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:20px;padding:0 5px;border-radius:5px;
 background:color-mix(in srgb,var(--ac) 14%,var(--surface-2));color:var(--ac-text);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}
.pl-plates2{display:flex;gap:3px;flex-wrap:wrap;justify-content:flex-end;margin-top:4px}

.pcalc label{font-size:13px;color:var(--text-2);font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pcalc input{font:inherit;font-size:14px;font-weight:600;width:96px;height:36px;padding:0 10px;border:1px solid var(--border);
 border-radius:var(--r-sm);background:var(--surface-2);color:var(--text);text-align:right;font-variant-numeric:tabular-nums}
.pcalc input:focus{outline:none;border-color:var(--ac)}
.meetset{display:flex;align-items:center;gap:11px;flex-wrap:wrap;margin-bottom:14px}
.meetset label{font-size:13px;color:var(--text-2);font-weight:500;display:inline-flex;align-items:center;gap:7px}
.meetset label svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;color:var(--text-3)}
.meetset input[type=date]{font:inherit;font-size:13.5px;height:36px;padding:0 11px;border:1px solid var(--border);
 border-radius:var(--r-sm);background:var(--surface-2);color:var(--text);color-scheme:light dark}
.meetset input[type=date]:focus{outline:none;border-color:var(--ac)}
.pbar{display:flex;align-items:flex-end;gap:3px;margin:16px 0 8px;min-height:60px;padding-left:6px;border-left:3px solid var(--text-3)}
.pbar-sleeve{width:30px;height:8px;background:var(--text-3);border-radius:2px;align-self:center}
.pplate{display:flex;align-items:center;justify-content:center;width:18px;border-radius:3px;
 background:var(--ac);color:#fff;font-size:10px;font-weight:700;writing-mode:vertical-rl;text-orientation:mixed;padding:4px 0}

.balrows{display:flex;flex-direction:column;gap:11px}
.balrow{display:flex;align-items:center;gap:12px;font-size:13px}
.ballab{width:84px;font-weight:600}
.baltrack{flex:1;height:12px;background:var(--surface-2);border-radius:999px;overflow:hidden}
.balfill{height:100%;background:var(--ac);border-radius:999px;min-width:3px}
.balfill.weak{background:var(--warn)}
.balval{color:var(--text-3);font-size:11.5px;font-variant-numeric:tabular-nums;white-space:nowrap}
#pl-balance .pl-sub svg,#pl-meet .pl-sub svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.75;vertical-align:-2px;color:var(--warn)}

:focus-visible{outline:2px solid var(--ac);outline-offset:2px;border-radius:3px}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media print{
 .topbar,.tabsbar,.menu,.search,.iconbtn{display:none!important}
 .panel{display:block!important;page-break-inside:avoid;margin-bottom:24px}
 body{background:#fff}.card,.chartbox,.tablewrap,.bodywrap,.metric{border:1px solid #ddd}
}
@media(max-width:640px){.rval{width:118px}.wrap{padding:18px 14px 32px}
 h2{font-size:20px}h3{font-size:14.5px}.pl-hero{flex-direction:column}
 .statline .s{font-size:10.5px}.statline .s b{font-size:14px}}
</style></head>
<body>
<h1 class="sr-only">WorkOut Coach dashboard</h1>
<header class="topbar">
 <div class="brand"><span class="logo"><svg viewBox="0 0 24 24"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg></span>WorkOut Coach</div>
 <div class="subdate" id="subdate"></div>
 <div class="spacer"></div>
 <div class="search"><span class="ic" id="ic-search" aria-hidden="true"></span><input id="search" placeholder="Search lifts &amp; muscles…" aria-label="Search lifts and muscles"><button class="srch-clear" id="srch-clear" type="button" aria-label="Clear search" hidden></button></div>
 <button class="iconbtn" id="themebtn" aria-label="Toggle light or dark theme"></button>
 <div class="menu" id="exportmenu">
  <button class="iconbtn" id="exportbtn">Export <span class="ic" id="ic-exp" aria-hidden="true"></span></button>
  <div class="pop">
   <button data-x="json"><span class="ic" data-i="download"></span>Download data (JSON)</button>
   <button data-x="csv"><span class="ic" data-i="download"></span>Download lifts (CSV)</button>
   <button data-x="print"><span class="ic" data-i="printer"></span>Print / Save as PDF</button>
  </div>
 </div>
</header>
<div class="tabsbar"><nav class="tabs" id="tabs" role="tablist"></nav></div>
<main class="wrap">
 <div class="srchnote" id="srchnote" role="status" hidden></div>
 <section id="tab-overview" class="panel" role="tabpanel">
  <h2>This week at a glance</h2>
  <p class="lead" id="ov-lead"></p>
  <div id="ov-status"></div>
  <h3 id="ov-focus-h">Then focus on <span class="info" title="The next most important changes for your sessions, ranked. Synthesized from recovery, volume, plateaus, deload and detraining checks.">i</span></h3>
  <div id="ov-focus"></div>
  <div id="ov-wins"></div>
  <h3>Snapshot <span class="info" title="Quick reference numbers for the last week and 4 weeks - context, not action items.">i</span></h3>
  <div class="kpis" id="ov-kpis"></div>
  <h3>Training consistency <span class="info" title="Working (hard) sets logged each month. Taller means more volume that month.">i</span></h3>
  <div class="chartbox" id="ov-monthly"></div>
 </section>

 <section id="tab-powerlifting" class="panel" role="tabpanel">
  <h2>Powerlifting &mdash; the big 3</h2>
  <p class="lead">Squat, bench and deadlift in depth: estimated 1RMs, your total, relative-strength score, training percentages, plate math and meet planning.</p>
  <div id="pl-partial"></div>
  <div id="pl-score"></div>
  <h3>Strength standards <span class="info" title="Where each lift sits on a Beginner&rarr;Elite scale, using bodyweight-multiple estimates for your bodyweight. Tunable in settings, not official classifications.">i</span></h3>
  <div id="pl-standards"></div>
  <h3>Lift deep dive <span class="info" title="Pick a lift for its e1RM history, training percentages, rep maxes, plate loading and recent sets.">i</span></h3>
  <div class="toolbar"><span class="chips" id="pl-liftsel"></span></div>
  <div class="statline" id="pl-stats"></div>
  <div class="clegend"><span><i></i>e1RM</span><span><i class="dash"></i>forecast</span><span><i class="dot"></i>recent PR</span></div>
  <div class="chartbox" id="pl-chart"></div>
  <div class="pl-grid">
   <div><h3 class="subhd">Training percentages <span class="info" title="Working weights as a % of your estimated 1RM, rounded to loadable plates, with the rep target each load roughly supports.">i</span></h3><div class="tablewrap" id="pl-pct"></div></div>
   <div><h3 class="subhd">Rep maxes <span class="info" title="Predicted weight for each rep max from your current e1RM (inverse Epley). A planning guide, not a guarantee.">i</span></h3><div class="tablewrap" id="pl-rm"></div></div>
  </div>
  <h3>Plate calculator <span class="info" title="Plates per side for any target weight, given your bar weight and available plates (settings.json).">i</span></h3>
  <div class="card" id="pl-plate"></div>
  <h3>Recent sets <span class="info" title="Your most recent working sets for this lift.">i</span></h3>
  <div class="tablewrap" id="pl-sets"></div>
  <h3>Lift balance <span class="info" title="How each lift compares as a share of your total and against elite standard for your bodyweight, to spot the lagging lift.">i</span></h3>
  <div id="pl-balance"></div>
  <h3>Meet planner <span class="info" title="Attempt selection (opener / second / third) off your current e1RM, plus a projected meet-day total if a meet date is set.">i</span></h3>
  <div id="pl-meet"></div>
 </section>

 <section id="tab-strength" class="panel" role="tabpanel" data-status-filter="all">
  <h2>Strength explorer</h2>
  <p class="lead">Pick a lift to see its estimated-1RM history, forecast and PRs. Filter by status or search by name.</p>
  <div class="toolbar"><select id="liftsel" aria-label="Choose a lift"></select><span class="chips" id="strchips"></span><span class="chips" id="str-range"></span></div>
  <div class="statline" id="str-stats"></div>
  <div class="clegend"><span><i></i>e1RM</span><span><i class="dash"></i>forecast</span><span><i class="dot"></i>recent PR</span></div>
  <div class="chartbox" id="str-chart"></div>
  <h3>Next-session targets <span class="info" title="Double-progression plan vs your 5-8 rep goal. Predicted reps anchor on your last top set and adjust for the load change.">i</span></h3>
  <div class="tablewrap"><table id="str-table"><thead><tr>
   <th>Lift</th><th>Status</th><th class="num">Best e1RM</th><th class="num">Trend/wk</th><th>Plan</th><th>Predicted reps</th><th class="num">Conf</th>
  </tr></thead><tbody></tbody></table></div>
 </section>

 <section id="tab-volume" class="panel" role="tabpanel">
  <h2>Volume &amp; recovery</h2>
  <p class="lead" id="vol-note"></p>
  <h3>Upper : lower balance <span class="info" title="Your upper:lower and push:pull set ratios over the last 4 weeks vs target. The dark tick is the target. Everything below is grouped by this split.">i</span></h3>
  <div class="card" id="vol-ratios"></div>
  <h3>Sets vs landmarks <span class="info" title="MEV = minimum effective volume, MAV = adaptive (productive) volume, MRV = max recoverable. The marker is your current sets/week, colored by recovery. The triangle is next week's target.">i</span></h3>
  <div class="legend" id="vol-legend"></div>
  <div id="vol-ranges"></div>
  <h3>Recovery by muscle <span class="info" title="Inferred from performance: e1RM trend, per-muscle load (ACWR) and in-session rep drop-off. Directional without RPE - log RPE to sharpen it.">i</span></h3>
  <div id="vol-recovery"></div>
  <h3>Set targets next week</h3>
  <div class="tablewrap"><table id="vol-table"><thead><tr>
   <th>Muscle</th><th class="num">Now</th><th class="num">Target</th><th class="num">Change</th><th>Recovery</th><th>Why</th>
  </tr></thead><tbody></tbody></table></div>
 </section>

 <section id="tab-body" class="panel" role="tabpanel">
  <h2>Muscle map</h2>
  <p class="lead">Hover a muscle for detail; click to jump to its plan. Switch what the colors mean below.</p>
  <div class="chips" id="body-controls"></div>
  <div class="legend" id="body-legend"></div>
  <div class="bodywrap" id="body-map"></div>
 </section>

 <section id="tab-calendar" class="panel" role="tabpanel">
  <h2>Training calendar</h2>
  <p class="lead">Every training day in your history. Click a day to see exactly what you did.</p>
  <div class="kpis" id="cal-stats"></div>
  <h3>Activity <span class="info" title="Darker means more volume that day. Hover for the session summary, click to open it.">i</span></h3>
  <div class="chartbox" id="cal-heat"></div>
  <div class="monthnav"><button id="prevm" aria-label="Previous month"></button><b id="monthlabel"></b><button id="nextm" aria-label="Next month"></button></div>
  <div class="calgrid" id="cal-month"></div>
  <div class="daydetail" id="cal-detail"></div>
 </section>

 <section id="tab-records" class="panel" role="tabpanel" data-status-filter="all">
  <h2>Records</h2>
  <p class="lead">Your bests per lift in the current logging-unit era. Click a column to sort, tap a muscle to filter, or use search. Stars mark PRs from the last 90 days.</p>
  <div class="chips" id="rec-musc" style="margin-bottom:14px"></div>
  <div class="tablewrap"><table id="rec-table"><thead><tr>
   <th data-sort="name">Lift</th>
   <th data-sort="muscle">Muscle</th>
   <th class="num" data-sort="e1rm">Best e1RM</th>
   <th class="num" data-sort="heaviest">Heaviest</th>
   <th class="num" data-sort="reps">Top reps</th>
   <th class="num" data-sort="vol">Best vol</th>
   <th class="num" data-sort="date">PR date</th>
  </tr></thead><tbody></tbody></table></div>
 </section>

 <section id="tab-goals" class="panel" role="tabpanel">
  <h2>Goals</h2>
  <p class="lead">Progress toward the targets you set with <code>coach.py set-goal</code>.</p>
  <div class="rings" id="goal-wrap"></div>
 </section>

 <div class="foot">Generated by WorkOut Coach &middot; works fully offline &middot; estimates are directional, not medical advice.</div>
</main>
<div class="tip" id="tip" role="status"></div>
<script>
const D = /*__DATA__*/;
const $=id=>document.getElementById(id);
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const num=(x,d='-')=>x==null?d:(Math.round(x*100)/100);

const TONE={ok:'var(--ok)',warn:'var(--warn)',bad:'var(--bad)',ac:'var(--ac)',mut:'var(--text-3)'};
// Continuous, theme-aware cool->warm heat ramp (blue->teal->green->amber->rose).
// Built from CSS viz tokens via color-mix so it follows light/dark automatically.
const HEAT_STOPS=['var(--v-blue)','var(--v-teal)','var(--v-green)','var(--v-amber)','var(--v-rose)'];
function heatGrad(t){
 t=Math.max(0,Math.min(1,t));
 const seg=t*(HEAT_STOPS.length-1),i=Math.min(HEAT_STOPS.length-2,Math.floor(seg)),f=seg-i;
 return `color-mix(in srgb,${HEAT_STOPS[i+1]} ${Math.round(f*100)}%,${HEAT_STOPS[i]})`;
}
// Soften any viz color toward the card surface (for fills/tints).
const soft=(c,p)=>`color-mix(in srgb,${c} ${p}%,var(--surface-2))`;
const REC_TONE={recovering_well:'ok',borderline:'warn',under_recovering:'bad',neutral:'mut',unknown:'mut',insufficient_data:'mut'};
const REC_W={recovering_well:'good',borderline:'mixed',under_recovering:'poor',neutral:'ok',unknown:'no data',insufficient_data:'no data'};
const STAT_TONE={progressing:'ok',plateau:'warn',declining:'bad',building:'mut',insufficient:'mut'};
const READY_W={green:'Good to push',amber:'Caution',red:'Back off'};
const READY_TONE={green:'ok',amber:'warn',red:'bad'};

// ---- icons (inline SVG, currentColor) ---------------------------------
const ICONS={
 search:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
 moon:'<path d="M21 12.8A8 8 0 1 1 11.2 3a6 6 0 0 0 9.8 9.8z"/>',
 download:'<path d="M12 3v12M7 11l5 5 5-5M5 21h14"/>',
 printer:'<path d="M7 8V3h10v5M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/>',
 chevron:'<path d="M6 9l6 6 6-6"/>',
 left:'<path d="M15 6l-6 6 6 6"/>',
 right:'<path d="M9 6l6 6-6 6"/>',
 arrow:'<path d="M5 12h13M12 5l7 7-7 7"/>',
 star:'<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.4 9.6l5.8-.8z"/>',
 pause:'<path d="M9 5v14M15 5v14"/>',
 refresh:'<path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v4h-4"/>',
 warn:'<path d="M12 3l9 16H3z"/><path d="M12 9.5v4M12 16.5v.5"/>',
 trenddown:'<path d="M22 17l-8.5-8.5-4 4L2 5"/><path d="M16 17h6v-6"/>',
 trendup:'<path d="M22 7l-8.5 8.5-4-4L2 19"/><path d="M16 7h6v6"/>',
 target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
 check:'<path d="M5 12.5l4.5 4.5L19 6"/>',
 calendar:'<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
 flag:'<path d="M5 21V4M5 4h11l-2 3 2 3H5"/>',
 grid:'<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
 bars:'<path d="M5 21V10M12 21V4M19 21v-7"/>',
 body:'<circle cx="12" cy="5" r="2.6"/><path d="M12 8v7M12 11l-5 2.5M12 11l5 2.5M12 15l-3.5 6M12 15l3.5 6"/>',
 x:'<path d="M6 6l12 12M18 6L6 18"/>',
 barbell:'<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>'
};
const ICON_FOR={rest:'pause',deload:'refresh',warn:'warn',down:'trenddown',up:'trendup',progress:'trendup',goal:'target',ok:'check'};
const ACT_TONE={rest:'ac',deload:'warn',warn:'bad',down:'bad',up:'ac',progress:'ok',goal:'ac',ok:'ok'};
function icon(name){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]||''}</svg>`;}

// Classify a headline flag into {text,tone,icon} - strips the [!]/[deload]/[PR]
// tags and gives each flag a semantic icon + color so the list scans by type.
function classifyFlag(t){
 let s=t,tone='mut',ic='flag';
 if(s.startsWith('[!]')){s=s.slice(3).trim();
  if(/days since|strength dip|detrain/i.test(s)){ic='pause';tone='warn';}else{ic='warn';tone='bad';}}
 else if(s.startsWith('[deload]')){s=s.slice(8).trim();ic='refresh';tone='warn';}
 else if(s.startsWith('[PR]')){s=s.slice(4).trim();ic='star';tone='ok';}
 else if(/under MEV/i.test(s)){ic='trendup';tone='ac';}
 else if(/^Plateaued/i.test(s)){ic='pause';tone='warn';}
 else if(/^Declining/i.test(s)){ic='trenddown';tone='bad';}
 else if(/ACWR|detraining risk/i.test(s)){ic='warn';tone='warn';}
 else if(/upper-dominant|lower-body|:1\b/i.test(s)){ic='warn';tone='warn';}
 return {text:s,tone:tone,icon:ic};
}
function leadBold(t){
 const m=t.match(/^(.{3,70}?)( [-—] |: |\. )(.+)$/);
 return m?`<b>${esc(m[1])}</b>${esc(m[2])}${esc(m[3])}`:esc(t);
}

// ---- theme -------------------------------------------------------------
const root=document.documentElement;
const savedTheme=localStorage.getItem('wo-theme');
if(savedTheme)root.dataset.theme=savedTheme;
function isDark(){return (root.dataset.theme||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'))==='dark';}
function updateThemeIcon(){$('themebtn').innerHTML=`<span class="ic">${icon(isDark()?'sun':'moon')}</span>`;}
$('themebtn').onclick=()=>{const nx=isDark()?'light':'dark';root.dataset.theme=nx;localStorage.setItem('wo-theme',nx);updateThemeIcon();buildAll();};

// ---- tooltip -----------------------------------------------------------
const tip=$('tip');
document.addEventListener('mouseover',e=>{const t=e.target.closest('[data-tip]');if(t){tip.innerHTML=t.getAttribute('data-tip');tip.style.display='block';}});
document.addEventListener('mousemove',e=>{if(tip.style.display==='block'){let x=e.clientX+14,y=e.clientY+14;if(x>innerWidth-290)x=e.clientX-290;tip.style.left=x+'px';tip.style.top=y+'px';}});
document.addEventListener('mouseout',e=>{if(e.target.closest('[data-tip]'))tip.style.display='none';});

// ---- tabs / routing ----------------------------------------------------
const TABS=[['overview','Overview','grid'],['powerlifting','Powerlifting','barbell'],['strength','Strength','trendup'],['volume','Volume & recovery','bars'],
 ['body','Body map','body'],['calendar','Calendar','calendar'],['records','Records','star'],['goals','Goals','flag']];
$('tabs').innerHTML=TABS.map(t=>`<button class="tab" role="tab" aria-selected="false" data-tab="${t[0]}"><span class="tic" aria-hidden="true">${icon(t[2])}</span><span class="tlbl">${t[1]}</span></button>`).join('');
function showTab(name){
 if(!TABS.some(t=>t[0]===name))name='overview';
 document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('on',p.id==='tab-'+name));
 document.querySelectorAll('.tab').forEach(b=>{const on=b.dataset.tab===name;b.classList.toggle('active',on);b.setAttribute('aria-selected',on);});
 if(location.hash!=='#'+name)location.hash=name;
 applyFilter();
}
$('tabs').onclick=e=>{const b=e.target.closest('.tab');if(b)showTab(b.dataset.tab);};
$('tabs').addEventListener('keydown',e=>{
 const cur=Math.max(0,TABS.findIndex(t=>t[0]===(location.hash.replace('#','')||'overview')));
 let ni=-1;
 if(e.key==='ArrowRight')ni=(cur+1)%TABS.length;
 else if(e.key==='ArrowLeft')ni=(cur-1+TABS.length)%TABS.length;
 else if(e.key==='Home')ni=0; else if(e.key==='End')ni=TABS.length-1;
 if(ni>=0){e.preventDefault();showTab(TABS[ni][0]);const b=document.querySelector(`.tab[data-tab="${TABS[ni][0]}"]`);if(b)b.focus();}
});
addEventListener('hashchange',()=>showTab(location.hash.replace('#','')));

// ---- search + filter ---------------------------------------------------
const sNote=$('srchnote'),sClear=$('srch-clear');
$('search').addEventListener('input',applyFilter);
sClear.onclick=()=>{$('search').value='';applyFilter();$('search').focus();};
// Enter from a tab with nothing to filter jumps to the lift explorer.
$('search').addEventListener('keydown',e=>{if(e.key==='Enter'){
 const p=document.querySelector('.panel.on');if(p&&!p.querySelector('[data-srch]'))showTab('strength');}});
function applyFilter(){
 const q=($('search').value||'').toLowerCase().trim();
 sClear.hidden=!q;
 const panel=document.querySelector('.panel.on');if(!panel){sNote.hidden=true;return;}
 const sf=panel.dataset.statusFilter||'all';
 const items=panel.querySelectorAll('[data-srch]');let shown=0;
 items.forEach(el=>{
  const okq=!q||el.dataset.srch.includes(q);
  const oks=sf==='all'||el.dataset.status===sf;
  const vis=okq&&oks;el.style.display=vis?'':'none';if(vis)shown++;
 });
 if(!q){sNote.hidden=true;return;}
 sNote.hidden=false;
 if(!items.length){
  sNote.innerHTML=`<span class="sn-ic">${icon('search')}</span><span>Nothing to filter on this tab. `
   +`<button class="go" data-gosrch="strength">Search lifts in Strength &rarr;</button></span>`;
  const g=sNote.querySelector('[data-gosrch]');if(g)g.onclick=()=>showTab(g.dataset.gosrch);
 } else if(!shown){
  sNote.innerHTML=`<span class="sn-ic">${icon('search')}</span><span>No matches for &ldquo;<b>${esc(q)}</b>&rdquo; on this tab.</span>`;
 } else {
  sNote.innerHTML=`<span class="sn-ic">${icon('search')}</span><span><b>${shown}</b> match${shown===1?'':'es'} for &ldquo;${esc(q)}&rdquo;.</span>`;
 }
}

// ---- export ------------------------------------------------------------
const em=$('exportmenu');
$('exportbtn').onclick=()=>em.classList.toggle('open');
document.addEventListener('click',e=>{if(!em.contains(e.target))em.classList.remove('open');});
function dl(name,text,type){const b=new Blob([text],{type:type});const u=URL.createObjectURL(b);
 const a=document.createElement('a');a.href=u;a.download=name;a.click();URL.revokeObjectURL(u);}
em.querySelectorAll('.pop button').forEach(b=>b.onclick=()=>{
 em.classList.remove('open');const x=b.dataset.x;
 if(x==='json')dl('summary.json',JSON.stringify(D,null,2),'application/json');
 else if(x==='csv'){
  const rows=[['Lift','Muscle','Status','Best e1RM','Trend/wk','Plan','Predicted reps','Confidence %']];
  (D.exercises||[]).forEach(e=>{const nt=e.next_target||{};
   const plan=nt.sets&&nt.sets.length?`${nt.rec_type} ${nt.n_sets}x${nt.sets[0].reps}@${nt.weight}`:(nt.rec_type||'');
   const pred=nt.predicted_reps!=null?`~${nt.predicted_reps} (${nt.predicted_range[0]}-${nt.predicted_range[1]})`:'';
   rows.push([e.name,e.muscle,e.status,e.best_e1rm??'',e.e1rm_trend_per_week??'',plan,pred,(e.individualization||{}).confidence??'']);});
  dl('lifts.csv',rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n'),'text/csv');
 } else window.print();
});

// =======================================================================
function buildAll(){renderOverview();renderPowerlifting();renderStrength();renderVolume();renderBody();renderCalendar();renderRecords();renderGoals();}

// ---- overview ----------------------------------------------------------
function renderOverview(){
 const w=D.window,ws=D.week_summary,f=D.fatigue,gc=D.grace_overview||{};
 $('subdate').textContent=`latest ${w.latest_session} · ${w.weeks_covered} wks`;
 $('ov-lead').textContent='Your training at a glance, ordered by what matters most - start at the top.';
 const acts=D.next_actions||[];
 // 1) hero = the single top priority
 const top=acts[0], rt=READY_TONE[f.readiness]||'mut';
 if(top){const c=TONE[ACT_TONE[top.icon]||'mut'];
  $('ov-status').innerHTML=`<div class="status p${Math.min(top.priority,3)}">
   <div class="em" style="color:${c};background:color-mix(in srgb,${c} 14%,var(--surface-2))">${icon(ICON_FOR[top.icon]||'check')}</div>
   <div class="body"><div class="eyebrow">Top priority</div><div class="title">${esc(top.title)}</div>
    <div class="detail">${esc(top.detail)}</div>${top.tab&&top.tab!=='overview'?`<button class="go" data-go="${top.tab}">Open ${top.tab} ${icon('arrow')}</button>`:''}</div>
   <div class="readiness"><div class="rlabel">Readiness</div><span class="pill" data-tone="${rt}">${READY_W[f.readiness]||f.readiness}</span></div></div>`;
  const gb=$('ov-status').querySelector('[data-go]'); if(gb)gb.onclick=()=>showTab(gb.dataset.go);
 } else $('ov-status').innerHTML='';
 // 2) focus = the next few priorities (capped)
 const focus=acts.slice(1,5);
 $('ov-focus-h').style.display=focus.length?'':'none';
 $('ov-focus').innerHTML=focus.length?`<ol class="focus">`+focus.map(a=>{const c=TONE[ACT_TONE[a.icon]||'mut'];
   return `<li><span class="em" style="color:${c};background:color-mix(in srgb,${c} 13%,var(--surface-2))">${icon(ICON_FOR[a.icon]||'check')}</span>`
    +`<span class="ftx"><span class="t">${esc(a.title)}</span><span class="d">${esc(a.detail)}</span></span>`
    +(a.tab&&a.tab!=='overview'?`<button class="go" data-go="${a.tab}" aria-label="Open ${a.tab}">${icon('arrow')}</button>`:'')+`</li>`;}).join('')+`</ol>`:'';
 $('ov-focus').querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>showTab(b.dataset.go));
 // 3) wins = recent PRs, surfaced as good news (separate from problems)
 const wins=(D.headline_flags||[]).filter(x=>classifyFlag(x).icon==='star').map(x=>classifyFlag(x).text);
 $('ov-wins').innerHTML=wins.length?`<h3>Recent wins</h3><div class="wins">`
   +wins.map(t=>`<span class="win"><span class="ic">${icon('star')}</span>${esc(t)}</span>`).join('')+`</div>`:'';
 // 4) snapshot = compact reference stats (readiness already shown in the hero)
 const kp=[
  ['Sessions / 7d',ws.sessions,'Distinct training days in the last 7 days.'],
  ['Hard sets / 7d',ws.total_hard_sets,'Working (non-warmup) sets in the last 7 days.'],
  ['Avg / week',f.frequency.per_week_28d,'Average sessions per week over the last 4 weeks.'],
  ['Global ACWR',num(f.acwr_global),'Acute:chronic workload ratio. ~0.8-1.3 is a healthy band; above 1.3 is a load spike.'],
  ['Coach confidence',`${gc.confident||0} / ${gc.learning||0} / ${gc.calibrating||0}`,'Lifts that are confident / learning / still calibrating.'],
 ];
 $('ov-kpis').innerHTML=kp.map(c=>`<div class="metric"><div class="k">${c[0]} <span class="info" title="${esc(c[2])}">i</span></div><div class="v">${c[1]}</div></div>`).join('');
 $('ov-monthly').innerHTML=monthlyChart(D.history||[]);
}
function monthlyChart(H){
 if(!H.length)return '<div class="empty">'+icon('calendar')+'No history yet.</div>';
 const H18=H.slice(-18);
 const W=760,Hh=210,pl=38,pr=14,pt=12,pb=40,max=Math.max(...H18.map(h=>h.hard_sets),1);
 const bw=(W-pl-pr)/H18.length;let bars='',grid='';
 for(let g=0;g<=4;g++){const v=Math.round(max*g/4),y=pt+(Hh-pt-pb)*(1-g/4);
  grid+=`<line class="grid" x1="${pl}" y1="${y}" x2="${W-pr}" y2="${y}"/><text class="ax" x="${pl-7}" y="${y+3}" text-anchor="end">${v}</text>`;}
 const step=Math.ceil(H18.length/9);
 H18.forEach((h,i)=>{const x=pl+i*bw,bh=(h.hard_sets/max)*(Hh-pt-pb),y=Hh-pb-bh;
  bars+=`<rect class="bar" x="${x+bw*0.18}" y="${y}" width="${bw*0.64}" height="${Math.max(bh,1)}" rx="3" fill="${heatGrad(h.hard_sets/max)}" data-tip="<b>${h.month}</b><br>${h.hard_sets} sets &middot; ${h.sessions} sessions${h.volume?'<br>vol '+Math.round(h.volume).toLocaleString():''}"/>`;
  if(i%step===0||i===H18.length-1)bars+=`<text class="ax" x="${x+bw/2}" y="${Hh-pb+15}" text-anchor="middle">${h.month.slice(2)}</text>`;});
 return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Working sets per month"><title>Working sets per month</title>${grid}<line class="base" x1="${pl}" y1="${Hh-pb}" x2="${W-pr}" y2="${Hh-pb}"/>${bars}</svg>`;
}

// ---- strength ----------------------------------------------------------
// Any lift with at least one e1RM point is selectable; lifts with a single
// session can't draw a trend line yet (the chart says so) but the lifter can
// still see them, their status and recent sets.
const SER=(D.exercises||[]).filter(e=>e.series&&e.series.length>=1);
let strWindowMs=365*864e5;
function renderStrength(){
 $('liftsel').innerHTML=SER.map((e,i)=>`<option value="${i}">${esc(e.name)} (${e.status})</option>`).join('')||'<option>no lifts logged yet</option>';
 const STAT=['all','progressing','plateau','declining'];
 const SF_TONE={all:'mut',progressing:'ok',plateau:'warn',declining:'bad'};
 $('strchips').innerHTML=STAT.map(s=>`<span class="chip${s==='all'?' on':''}" data-sf="${s}"><i class="cdot" style="background:${TONE[SF_TONE[s]]}"></i>${s}</span>`).join('');
 $('strchips').onclick=e=>{const c=e.target.closest('.chip');if(!c)return;
  $('strchips').querySelectorAll('.chip').forEach(x=>x.classList.toggle('on',x===c));
  $('tab-strength').dataset.statusFilter=c.dataset.sf;applyFilter();};
 const RANGES=[['1Y',365*864e5],['All',null]];
 $('str-range').innerHTML=RANGES.map(([l,v])=>`<span class="chip${v===strWindowMs?' on':''}" data-ms="${v}">${l}</span>`).join('');
 $('str-range').onclick=e=>{const c=e.target.closest('.chip');if(!c)return;
  strWindowMs=c.dataset.ms==='null'?null:+c.dataset.ms;
  $('str-range').querySelectorAll('.chip').forEach(x=>x.classList.toggle('on',x===c));
  drawLift(+$('liftsel').value);};
 let di=SER.findIndex(e=>e.status==='progressing');if(di<0)di=0;
 $('liftsel').value=di;drawLift(di);
 $('liftsel').onchange=()=>drawLift(+$('liftsel').value);
 $('str-table').querySelector('tbody').innerHTML=(D.exercises||[]).map(e=>{
  const nt=e.next_target||{},iv=e.individualization||{};
  const planTxt=nt.sets&&nt.sets.length?`${nt.rec_type}: ${nt.n_sets}&times;${nt.sets[0].reps} @ ${nt.weight}`:(nt.rec_type||'-');
  const rpeTag=nt.last_rpe!=null?` <span style="color:var(--text-3)" data-tip="${esc(nt.rationale||'')}">&middot; RPE ${nt.last_rpe}</span>`:'';
  const plan=planTxt+rpeTag;
  const pred=nt.predicted_reps!=null?`~${nt.predicted_reps} (${nt.predicted_range[0]}&ndash;${nt.predicted_range[1]})`:'<span class="s-building">learning</span>';
  return `<tr data-srch="${esc((e.name+' '+e.muscle).toLowerCase())}" data-status="${e.status}">
   <td>${esc(e.name)}</td><td class="s-${e.status}">${e.status}</td><td class="num">${num(e.best_e1rm)}</td>
   <td class="num">${num(e.e1rm_trend_per_week)}</td><td>${plan}</td><td>${pred}</td><td class="num">${iv.confidence||0}%</td></tr>`;
 }).join('');
}
function drawLift(i){
 const e=SER[i];if(!e){$('str-chart').innerHTML='<div class="empty">No data.</div>';$('str-stats').innerHTML='';return;}
 const iv=e.individualization||{},pl=e.plateau||{},nt=e.next_target||{};
 const lr=nt.last_rpe;
 $('str-stats').innerHTML=[
  `Best e1RM<b>${num(e.best_e1rm)}${lr!=null?' <span style="font-weight:500;color:var(--text-3)">&middot; RPE-adj</span>':''}</b>`,
  `Trend<b class="s-${e.status}">${num(e.e1rm_trend_per_week)}/wk</b>`,
  `Status<b class="s-${e.status}">${e.status}</b>`,
  lr!=null?`Last top-set RPE<b>${lr}${nt.last_reserve!=null?` <span style="font-weight:500;color:var(--text-3)">(~${nt.last_reserve} RIR)</span>`:''}</b>`:'',
  `Model<b>${iv.grace_state||'-'} ${iv.confidence||0}%</b>`,
  iv.individ_1rm?`Personalized 1RM<b>~${iv.individ_1rm}</b>`:'',
  (pl.ceiling&&pl.ceiling.ceiling)?`Est. ceiling<b>${pl.ceiling.ceiling}</b>`:'',
  pl.onset?`Plateau since<b>${pl.onset}</b>`:'',
 ].filter(Boolean).map(s=>`<span class="s">${s}</span>`).join('');
 $('str-chart').innerHTML=strengthChart(e);
}
function strengthChart(e){
 const W=760,H=300,pl=44,pr=18,pt=14,pb=30;
 let pts=e.series.map(p=>[Date.parse(p[0]+'T00:00:00'),p[1]]);
 if(strWindowMs){const cutoff=pts[pts.length-1][0]-strWindowMs;pts=pts.filter(p=>p[0]>=cutoff);}
 if(pts.length<2)return '<div class="empty">'+icon('trendup')+'Not enough data to chart yet.</div>';
 const fc=e.forecast;let fpt=null;
 if(fc&&fc.e1rm_in_horizon){const lt=pts[pts.length-1][0];fpt=[lt+(fc.horizon_weeks||8)*7*864e5,fc.e1rm_in_horizon];}
 const xs=pts.map(p=>p[0]).concat(fpt?[fpt[0]]:[]);
 let ys=pts.map(p=>p[1]).concat(fpt?[fpt[1]]:[]).concat(fc&&fc.band?fc.band:[]);
 const minT=Math.min(...xs),maxT=Math.max(...xs);
 let minY=Math.min(...ys),maxY=Math.max(...ys);const pad=(maxY-minY)*0.12||1;minY-=pad;maxY+=pad;
 const X=t=>pl+(t-minT)/((maxT-minT)||1)*(W-pl-pr);
 const Y=v=>pt+(maxY-v)/((maxY-minY)||1)*(H-pt-pb);
 let grid='';for(let g=0;g<=4;g++){const v=minY+(maxY-minY)*g/4,y=Y(v);
  grid+=`<line class="grid" x1="${pl}" y1="${y}" x2="${W-pr}" y2="${y}"/><text class="ax" x="${pl-7}" y="${y+3}" text-anchor="end">${Math.round(v)}</text>`;}
 const fd=t=>{const d=new Date(t);return (d.getMonth()+1)+'/'+(d.getFullYear()%100);};
 let xl='';[0,Math.floor(pts.length/2),pts.length-1].forEach(ix=>{const t=pts[ix][0];xl+=`<text class="ax" x="${X(t)}" y="${H-9}" text-anchor="middle">${fd(t)}</text>`;});
 const line=pts.map((p,i)=>(i?'L':'M')+X(p[0]).toFixed(1)+' '+Y(p[1]).toFixed(1)).join(' ');
 const area=`M${X(pts[0][0]).toFixed(1)} ${Y(minY).toFixed(1)} `+pts.map(p=>'L'+X(p[0]).toFixed(1)+' '+Y(p[1]).toFixed(1)).join(' ')+` L${X(pts[pts.length-1][0]).toFixed(1)} ${Y(minY).toFixed(1)} Z`;
 const dots=pts.map(p=>`<circle class="pt" cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="2.4" data-tip="${new Date(p[0]).toISOString().slice(0,10)}: ${Math.round(p[1]*10)/10}"/>`).join('');
 let fc_svg='';
 if(fpt){const lp=pts[pts.length-1];
  fc_svg=`<path class="fc" d="M${X(lp[0]).toFixed(1)} ${Y(lp[1]).toFixed(1)} L${X(fpt[0]).toFixed(1)} ${Y(fpt[1]).toFixed(1)}"/><circle class="fcpt" cx="${X(fpt[0]).toFixed(1)}" cy="${Y(fpt[1]).toFixed(1)}" r="3.2" data-tip="forecast +${fc.horizon_weeks||8}wk: ~${fpt[1]}${fc.band?'<br>range '+fc.band[0]+'-'+fc.band[1]:''}"/>`;}
 let star='';const pr0=e.recent_pr;
 if(pr0&&pr0.type==='e1rm'){const t=Date.parse(pr0.date+'T00:00:00');if(t>=minT&&t<=maxT){const x=X(t),y=Y(pr0.value);
  star=`<g transform="translate(${(x-7).toFixed(1)} ${(y-16).toFixed(1)}) scale(.6)" class="star" data-tip="recent PR: ${pr0.value} (${pr0.date})">${ICONS.star.replace('fill="none"','')}</g>`;}}
 let onset='';if((e.plateau||{}).onset){const t=Date.parse(e.plateau.onset+'T00:00:00');if(t>=minT&&t<=maxT){const x=X(t);
  onset=`<line class="onset" x1="${x}" y1="${pt}" x2="${x}" y2="${H-pb}" data-tip="plateau onset ${e.plateau.onset}"/>`;}}
 return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Estimated 1RM history for ${esc(e.name)}"><title>${esc(e.name)} estimated 1RM</title>${grid}<path class="area" d="${area}"/><path class="line" d="${line}"/>${fc_svg}${dots}${onset}${star}${xl}</svg>`;
}

// ---- powerlifting ------------------------------------------------------
const PL=D.powerlifting||{};
const PLMAP={};(D.exercises||[]).forEach(e=>PLMAP[e.name]=e);
const PL_LABEL={squat:'Squat',bench:'Bench',deadlift:'Deadlift'};
let plSel=null;
function plBest(name){const e=PLMAP[name];return e&&e.best_e1rm!=null?e.best_e1rm:null;}
function plRound(w,inc){return Math.round(w/inc)*inc;}
function fmtKg(x){return (Math.round(x*100)/100);}
// DOTS / Wilks coefficients (published constants); score = total * 500 / poly(bw).
function plCoef(bw,sex,kind){
 const C=kind==='wilks'
  ?(sex==='female'?[594.31747775582,-27.23842536447,0.82112226871,-0.00930733913,0.00004731582,-0.00000009054]
                  :[-216.0475144,16.2606339,-0.002388645,-0.00113732,0.00000701863,-0.00000001291])
  :(sex==='female'?[-57.96288,13.6175032,-0.1126655495,0.0005158568,-0.0000010706]
                  :[-307.75076,24.0900756,-0.1918759221,0.0007391293,-0.000001093]);
 let d=0;for(let i=0;i<C.length;i++)d+=C[i]*Math.pow(bw,i);return d?500/d:null;
}
function plScore(total,bw,cfg){if(!total||!bw)return null;
 const c=plCoef(bw,cfg.sex||'male',cfg.score==='wilks'?'wilks':'dots');return c?Math.round(total*c*10)/10:null;}
function plates(target,bar,pairs){let per=(target-bar)/2,out=[];if(per<=1e-9)return out;
 pairs.forEach(p=>{while(per>=p-1e-9){out.push(p);per-=p;}});return out;}
function plateChips(w,bar,pairs){const ps=plates(w,bar,pairs);
 if(!ps.length)return '<span class="dim">bar only</span>';
 return `<span class="pl-plates">`+ps.map(p=>`<span class="plchip">${fmtKg(p)}</span>`).join('')+`</span>`;}

function plBestE1rm(L){const e=PLMAP[L.name];return e&&e.best_e1rm!=null?e.best_e1rm:(L.best_e1rm||null);}
function renderPowerlifting(){
 const cfg=PL.config||{},bw=PL.bodyweight_kg,lifts=PL.lifts||[];
 const present=lifts.filter(L=>L.present);
 const missing=lifts.filter(L=>!L.present);
 $('pl-partial').innerHTML=missing.length
  ?`<div class="balwarn">${icon('warn')}<span>${missing.map(L=>esc(L.name)).join(' & ')} not logged yet &mdash; total, ${(cfg.score==='wilks'?'Wilks':'DOTS')} score and balance are partial (${present.length} of 3 lifts). Log it in Hevy and it appears here automatically.</span></div>`:'';

 const headTotal=present.reduce((a,L)=>a+(plBestE1rm(L)||0),0);
 const score=plScore(headTotal,bw,cfg),scoreName=cfg.score==='wilks'?'Wilks':'DOTS';
 const bwMult=(headTotal&&bw)?(headTotal/bw).toFixed(2):null;
 const hero=`<div class="pl-hero">
   <div class="pl-hero-main"><div class="pl-hero-k">Powerlifting total${present.length<3?' &middot; partial':''}</div>
    <div class="pl-hero-v num">${headTotal?Math.round(headTotal):'&ndash;'}<span class="pl-u">kg</span></div>
    <div class="pl-hero-sub">${present.length?present.map(L=>PL_LABEL[L.slot]+' '+Math.round(plBestE1rm(L))).join(' + '):'no competition lifts logged yet'}</div></div>
   <div class="pl-hero-stats">
    <div class="metric"><div class="k">${scoreName} score</div><div class="v num">${score!=null?score:'&ndash;'}</div></div>
    <div class="metric"><div class="k">Total / BW</div><div class="v num">${bwMult?bwMult+'&times;':'&ndash;'}</div></div>
    <div class="metric"><div class="k">Bodyweight</div><div class="v num">${bw?bw+'<span class="pl-u">kg</span>':'&ndash;'}</div></div>
   </div></div>`;
 const cards=lifts.map(L=>{const e=PLMAP[L.name];
  if(!L.present)return `<div class="plcard absent"><div class="pl-k">${PL_LABEL[L.slot]}</div>
    <div class="pl-absent">${icon('flag')}<span>Not logged</span></div><div class="pl-sub">start logging ${esc(L.name)}</div></div>`;
  const best=plBestE1rm(L);
  const ceil=(e&&e.plateau&&e.plateau.ceiling)?e.plateau.ceiling.pct_of_ceiling:null,tr=e?e.e1rm_trend_per_week:null;
  const status=e?e.status:'building';
  return `<div class="plcard" data-go-lift="${L.slot}">
    <div class="pl-k"><span>${PL_LABEL[L.slot]}</span><span class="pill" data-tone="${STAT_TONE[status]||'mut'}">${status}</span></div>
    <div class="pl-v num">${num(best)}<span class="pl-u">kg e1RM</span></div>
    <div class="pl-row"><span>heaviest <b>${e?esc(e.heaviest||'-'):'-'}</b></span><span>${tr!=null?'trend <b class="s-'+status+'">'+(tr>0?'+':'')+num(tr)+'/wk</b>':'<span class="s-building">calibrating</span>'}</span></div>
    ${ceil!=null?`<div class="pl-ceil"><div class="pl-ceilbar"><div style="width:${Math.min(100,ceil)}%"></div></div><span>${ceil}% of ceiling</span></div>`:''}</div>`;
 }).join('');
 $('pl-score').innerHTML=hero+`<div class="plcards">${cards}</div>`;
 $('pl-score').querySelectorAll('[data-go-lift]').forEach(c=>c.onclick=()=>{plSelect(c.dataset.goLift);
   document.getElementById('pl-liftsel').scrollIntoView({behavior:'smooth',block:'center'});});

 renderPlStandards(present,bw,cfg);
 $('pl-liftsel').innerHTML=lifts.map(L=>`<span class="chip${!L.present?' disabled':''}" data-pl="${L.slot}">${PL_LABEL[L.slot]}</span>`).join('');
 $('pl-liftsel').onclick=ev=>{const c=ev.target.closest('.chip');if(!c||c.classList.contains('disabled'))return;plSelect(c.dataset.pl);};
 if(!plSel||!present.find(L=>L.slot===plSel))plSel=(present[0]||{}).slot||null;
 plSelect(plSel);
 renderPlBalance(present,cfg);
 renderPlMeet(present,cfg);
}

function renderPlStandards(present,bw,cfg){
 const st=cfg.standards||{},labels=st.labels||[],mult=st.bw_mult||{};
 if(!bw){$('pl-standards').innerHTML=`<div class="empty">${icon('target')}<div>Log your bodyweight to see strength standards.</div></div>`;return;}
 const rows=present.map(L=>{const v=plBestE1rm(L),ms=mult[L.slot]||[];if(!ms.length||v==null)return '';
   const ths=ms.map(m=>m*bw),maxv=ths[ths.length-1]*1.1,pct=Math.min(100,v/maxv*100);
   let bi=0;for(let i=0;i<ths.length;i++)if(v>=ths[i])bi=i;
   const segs=ths.map((t,i)=>{const l=Math.min(100,(i?ths[i-1]:0)/maxv*100),r=Math.min(100,t/maxv*100);
     return `<span class="stseg" style="left:${l}%;width:${r-l}%;background:color-mix(in srgb,var(--ac) ${8+i*15}%,var(--surface-2))" data-tip="<b>${labels[i]||''}</b><br>${Math.round(t)} kg (${ms[i]}&times;BW)"></span>`;}).join('');
   return `<div class="strow"><div class="stlab">${PL_LABEL[L.slot]}<span class="stbracket">${labels[bi]||''}</span></div>
     <div class="sttrack" data-tip="<b>${PL_LABEL[L.slot]}</b>: ${num(v)} kg &middot; ${(v/bw).toFixed(2)}&times;BW">${segs}<div class="stmark" style="left:${pct}%"></div></div>
     <div class="stval"><b>${num(v)}</b> / ${Math.round(ths[ths.length-1])}kg</div></div>`;
 }).filter(Boolean).join('');
 $('pl-standards').innerHTML=(rows||`<div class="empty">No standards available.</div>`)
  +`<div class="pl-sub" style="margin-top:8px">Bodyweight-multiple estimates at ${bw} kg &mdash; tunable guides, not official classifications.</div>`;
}

function plSelect(slot){
 const cfg=PL.config||{},bar=cfg.bar_weight_kg||20,pairs=(cfg.plate_pairs_kg||[25,20,15,10,5,2.5,1.25]).slice().sort((a,b)=>b-a);
 const inc=2*Math.min(...(pairs.length?pairs:[1.25]));
 const L=(PL.lifts||[]).find(x=>x.slot===slot),e=L&&PLMAP[L.name];
 document.querySelectorAll('#pl-liftsel .chip').forEach(c=>c.classList.toggle('on',c.dataset.pl===slot));
 if(!L||!L.present){plSel=slot;['pl-stats','pl-pct','pl-rm','pl-plate','pl-sets'].forEach(id=>$(id).innerHTML='');
  $('pl-chart').innerHTML=`<div class="empty">${icon('barbell')}<div>${L?esc(L.name)+' not logged yet &mdash; once you log it, its full breakdown shows here.':'No lift selected.'}</div></div>`;return;}
 plSel=slot;
 const one=plBestE1rm(L),pl=(e&&e.plateau)||{};
 $('pl-stats').innerHTML=[
  `Best e1RM<b>${num(one)}</b>`,
  e?`Trend<b class="s-${e.status}">${num(e.e1rm_trend_per_week)}/wk</b>`:'',
  e?`Status<b class="s-${e.status}">${e.status}</b>`:'Status<b class="s-building">building</b>',
  (pl.ceiling&&pl.ceiling.ceiling)?`Est. ceiling<b>${pl.ceiling.ceiling}</b>`:'',
  pl.onset?`Plateau since<b>${pl.onset}</b>`:'',
 ].filter(Boolean).map(s=>`<span class="s">${s}</span>`).join('');
 $('pl-chart').innerHTML=(e&&e.series&&e.series.length>=2)?strengthChart(e):`<div class="empty">${icon('trendup')}Not enough data to chart yet &mdash; log more sessions.</div>`;
 const pcts=[100,95,90,85,80,75,70,65,60];
 $('pl-pct').innerHTML=`<table><thead><tr><th>%1RM</th><th class="num">Weight</th><th class="num">~Reps</th><th>Plates / side</th></tr></thead><tbody>`
  +pcts.map(p=>{const w=plRound(one*p/100,inc),reps=Math.max(1,Math.round(30*(100/p-1)));
    return `<tr><td><b>${p}%</b></td><td class="num">${w}</td><td class="num">${p>=100?1:reps}</td><td>${plateChips(w,bar,pairs)}</td></tr>`;}).join('')+`</tbody></table>`;
 const reps=[1,2,3,5,8,10];
 $('pl-rm').innerHTML=`<table><thead><tr><th>Rep max</th><th class="num">Predicted</th><th class="num">% of 1RM</th></tr></thead><tbody>`
  +reps.map(r=>{const w=(r===1)?plRound(one,inc):plRound(one/(1+r/30),inc);return `<tr><td><b>${r}RM</b></td><td class="num">${w}</td><td class="num">${Math.round(w/one*100)}%</td></tr>`;}).join('')+`</tbody></table>`;
 renderPlateCalc(plRound(one,inc),bar,pairs,inc);
 const rs=L.recent_sets||[];
 $('pl-sets').innerHTML=rs.length
  ?`<table><thead><tr><th>Date</th><th class="num">Weight</th><th class="num">Reps</th><th class="num">e1RM</th></tr></thead><tbody>`
   +rs.map(s=>`<tr><td class="dim">${s.date}</td><td class="num">${s.weight}</td><td class="num">${s.reps}</td><td class="num">${num(s.e1rm)}</td></tr>`).join('')+`</tbody></table>`
  :`<div class="empty">No recent sets.</div>`;
}
function renderPlateCalc(init,bar,pairs,inc){
 $('pl-plate').innerHTML=`<div class="pcalc"><label>Target weight <input id="pl-target" type="number" inputmode="decimal" value="${init}" step="${inc}" min="${bar}" aria-label="Target weight in kg"> kg</label><div id="pl-plateout"></div></div>`;
 const draw=()=>{const t=parseFloat($('pl-target').value);if(isNaN(t)){$('pl-plateout').innerHTML='';return;}
  const ps=plates(t,bar,pairs),per=ps.reduce((a,b)=>a+b,0),loaded=Math.round((bar+2*per)*100)/100;
  $('pl-plateout').innerHTML=ps.length
   ?`<div class="pbar">${ps.map(p=>`<span class="pplate" style="height:${Math.round(28+p*1.5)}px" data-tip="${fmtKg(p)} kg">${fmtKg(p)}</span>`).join('')}<span class="pbar-sleeve"></span></div>
     <div class="pl-sub">${ps.map(fmtKg).join(' + ')} per side &middot; bar ${bar} &middot; loaded <b style="color:var(--text)">${loaded} kg</b>${Math.abs(loaded-t)>0.01?` (asked ${t})`:''}</div>`
   :`<div class="pl-sub">Below the empty bar (${bar} kg).</div>`;};
 $('pl-target').addEventListener('input',draw);draw();
}
function renderPlBalance(present,cfg){
 if(present.length<2){$('pl-balance').innerHTML=`<div class="empty">${icon('bars')}<div>Need at least two competition lifts logged to compare balance.</div></div>`;return;}
 const bw=PL.bodyweight_kg,mult=(cfg.standards||{}).bw_mult||{};
 const rows=present.map(L=>{const v=plBestE1rm(L),ms=mult[L.slot],el=(bw&&ms)?ms[ms.length-1]*bw:null;
   return {slot:L.slot,v:v,rel:el?v/el:null};});
 const total=rows.reduce((a,r)=>a+r.v,0);
 const ranked=rows.filter(r=>r.rel!=null).slice().sort((a,b)=>a.rel-b.rel),weak=ranked[0];
 $('pl-balance').innerHTML=`<div class="card"><div class="balrows">`
  +rows.map(r=>{const share=Math.round(r.v/total*100);
    return `<div class="balrow"><span class="ballab">${PL_LABEL[r.slot]}</span>
     <div class="baltrack"><div class="balfill${weak&&r.slot===weak.slot?' weak':''}" style="width:${r.rel!=null?Math.min(100,r.rel*100):share}%"></div></div>
     <span class="balval">${num(r.v)}kg &middot; ${share}% of total${r.rel!=null?' &middot; '+Math.round(r.rel*100)+'% to elite':''}</span></div>`;}).join('')
  +`</div>${weak?`<div class="pl-sub" style="margin-top:11px">${icon('trendup')} Your <b style="color:var(--text)">${PL_LABEL[weak.slot]}</b> is furthest from the elite standard for your bodyweight &mdash; the biggest opportunity to raise your total.</div>`:''}</div>`;
}
const MEET_KEY='wo-meet-date';
function meetDate(cfg){return localStorage.getItem(MEET_KEY)||cfg.meet_date||'';}
function renderPlMeet(present,cfg){
 const ap=cfg.attempt_pct||[0.91,0.96,1.01],bar=cfg.bar_weight_kg||20,
   pairs=(cfg.plate_pairs_kg||[25,20,15,10,5,2.5,1.25]).slice().sort((a,b)=>b-a),inc=2*Math.min(...(pairs.length?pairs:[1.25]));
 if(!present.length){$('pl-meet').innerHTML=`<div class="empty">${icon('target')}<div>No competition lifts logged yet.</div></div>`;return;}
 const md=meetDate(cfg),overridden=!!localStorage.getItem(MEET_KEY);
 // date picker the lifter sets themselves (persists in this browser)
 const setter=`<div class="meetset"><label>${icon('calendar')} Meet date
   <input type="date" id="pl-meetdate" value="${esc(md)}" aria-label="Meet date"></label>
   ${md?`<button class="iconbtn" id="pl-meetclear" type="button">Clear</button>`:''}
   <span class="pl-sub">${md?'saved in this browser'+(!overridden&&cfg.meet_date?' &middot; from settings':''):'pick a date for a countdown &amp; projected total'}</span></div>`;
 // days out from the real current date, not the last logged session
 const _t=new Date(),_todayMid=new Date(_t.getFullYear(),_t.getMonth(),_t.getDate()).getTime();
 let daysOut=null;
 if(md)daysOut=Math.round((Date.parse(md+'T00:00:00')-_todayMid)/864e5);
 const wks=Math.max(0,(daysOut||0)/7);
 // project each lift to meet day: grow its best e1RM along its current (non-negative)
 // weekly trend, capped at the estimated ceiling. An "if progress continues" number.
 const projLift=L=>{const e=PLMAP[L.name],best=plBestE1rm(L);if(best==null)return null;
   if(!e)return best;
   const fc=e.forecast||{},cur=(e.series&&e.series.length)?e.series[e.series.length-1][1]:best;
   const hw=fc.horizon_weeks||8,slope=Math.max(0,((fc.e1rm_in_horizon==null?cur:fc.e1rm_in_horizon)-cur)/hw);
   const ceil=(e.plateau&&e.plateau.ceiling&&e.plateau.ceiling.ceiling)||Infinity;
   return Math.min(ceil,best+slope*wks);};
 let projTotal=0;present.forEach(L=>{const p=projLift(L);if(p!=null)projTotal+=p;});
 const totalNow=present.reduce((a,L)=>a+(plBestE1rm(L)||0),0),gain=Math.round(projTotal-totalNow);
 const dOut=daysOut==null?'&ndash;':(daysOut<0?'passed':daysOut);
 const head=md
  ?`<div class="kpis" style="margin-bottom:14px"><div class="metric"><div class="k">Meet date</div><div class="v">${esc(md)}</div></div>
    <div class="metric"><div class="k">Days out</div><div class="v num">${dOut}</div></div>
    <div class="metric"><div class="k">Projected total <span class="info" title="Your total projected to meet day: each lift grown from its best e1RM along its current weekly trend, capped at its estimated ceiling. An 'if progress continues' estimate, not a guarantee.">i</span></div><div class="v num">${Math.round(projTotal)}<span class="pl-u">kg</span>${gain>0?` <span class="pl-gain">+${gain}</span>`:''}</div></div></div>`
  :'';
 const tbl=`<div class="tablewrap"><table><thead><tr><th>Lift</th>`
   +`<th class="num">Opener ${Math.round(ap[0]*100)}%</th><th class="num">Second ${Math.round(ap[1]*100)}%</th><th class="num">Third ${Math.round(ap[2]*100)}%</th></tr></thead><tbody>`
   +present.map(L=>{const v=plBestE1rm(L);
     return `<tr><td>${PL_LABEL[L.slot]}</td>`+ap.map(p=>{const w=plRound(v*p,inc);
       return `<td class="num"><b>${w}</b><span class="pl-plates2">${plateChips(w,bar,pairs)}</span></td>`;}).join('')+`</tr>`;}).join('')
   +`</tbody></table></div>`;
 $('pl-meet').innerHTML=setter+head+tbl
   +`<div class="pl-sub" style="margin-top:8px">Openers should be a smooth single you can hit any day; thirds sit near or above your current best e1RM.</div>`;
 $('pl-meetdate').addEventListener('change',e=>{const v=e.target.value;
   if(v)localStorage.setItem(MEET_KEY,v);else localStorage.removeItem(MEET_KEY);renderPlMeet(present,cfg);});
 const clr=$('pl-meetclear');if(clr)clr.onclick=()=>{localStorage.removeItem(MEET_KEY);renderPlMeet(present,cfg);};
}

// ---- volume & recovery -------------------------------------------------
function renderVolume(){
 const det=D.week_summary.muscle_detail||{},vp=D.volume_plan||{},recov=vp.recovery||{};
 $('vol-note').textContent='Grouped by your upper/lower split. Sets are added only where you are recovering well; where recovery is poor the plan holds or cuts. Below MEV it still ramps gently toward the minimum.';
 const tint=(c,p)=>`color-mix(in srgb,${c} ${p}%,var(--surface))`;
 // group muscles by training region so the whole tab reads along the upper/lower split
 const REGION_ORDER=['upper','lower','core','other'],REGION_LABEL={upper:'Upper body',lower:'Lower body',core:'Core',other:'Other'};
 const regionOf=m=>{const d=det[m];return (d&&d.region)||'other';};
 const byRegion=(items,key)=>REGION_ORDER
   .map(reg=>({label:REGION_LABEL[reg],items:items.filter(it=>regionOf(key(it))===reg)}))
   .filter(g=>g.items.length);

 // --- upper:lower balance, surfaced at the top of the tab ---
 const rt=D.week_summary.ratios||{};
 const balWarn=((rt.lower_sets||0)===0&&(rt.upper_sets||0)>0)
   ?`<div class="balwarn">${icon('warn')}<span>No lower-body sets in the last 4 weeks - your upper/lower split is upper-only right now. The Lower body group below is your biggest gap to close.</span></div>`:'';
 $('vol-ratios').innerHTML=balWarn+gauge('Upper : lower',rt.upper_lower,rt.upper_lower_target)+gauge('Push : pull',rt.push_pull,rt.push_pull_target)
  +`<div class="sig" style="color:var(--text-3);font-size:12.5px">upper ${rt.upper_sets??'-'} &middot; lower ${rt.lower_sets??'-'} &middot; push ${rt.push_sets??'-'} &middot; pull ${rt.pull_sets??'-'} sets/4wk</div>`;

 $('vol-legend').innerHTML=[
   [tint('var(--ok)',24),'productive (MEV–MAV)'],
   [tint('var(--warn)',16),'high (MAV–MRV)'],
   [tint('var(--bad)',15),'over MRV'],
 ].map(l=>`<span><span class="swatch" style="background:${l[0]}"></span>${l[1]}</span>`).join('')
  +'<span><span class="lgdot"></span>now (by recovery)</span><span><span class="lgtick"></span>next-week target</span>';
 const vpmap={};(vp.recommendations||[]).forEach(r=>vpmap[r.muscle]=r);
 const muscles=Object.keys(det).filter(m=>det[m].mev!=null).sort((a,b)=>det[b].sets_per_week-det[a].sets_per_week);
 const clamp=v=>Math.max(2,Math.min(98,v));

 // --- sets vs landmarks, grouped by region ---
 const rangeRow=m=>{const d=det[m];
  const max=Math.max(d.mrv*1.12,d.sets_per_week*1.1,1),pc=v=>Math.min(100,100*v/max);
  const rc=(recov[m]||{}).recovery||'insufficient_data',recC=TONE[REC_TONE[rc]];
  // "now" is the recency-weighted EWMA (robust to one empty/surge week); the
  // flat 4-wk mean is shown alongside as the "typical" reference.
  const cur=(d.sets_per_week_ewma!=null?d.sets_per_week_ewma:d.sets_per_week),typ=d.sets_per_week,tgt=vpmap[m]?vpmap[m].target_sets:null;
  const bg=`linear-gradient(to right,var(--surface-2) 0,var(--surface-2) ${pc(d.mev)}%,${tint('var(--ok)',24)} ${pc(d.mev)}%,${tint('var(--ok)',24)} ${pc(d.mav)}%,${tint('var(--warn)',16)} ${pc(d.mav)}%,${tint('var(--warn)',16)} ${pc(d.mrv)}%,${tint('var(--bad)',15)} ${pc(d.mrv)}%,${tint('var(--bad)',15)} 100%)`;
  const dot=`<div class="rdot" style="left:${clamp(pc(cur))}%;background:${recC}"></div>`;
  const tick=(tgt!=null)?`<div class="rtick" style="left:${clamp(pc(tgt))}%"></div>`:'';
  const valNum=(tgt!=null&&tgt!==cur)?`${cur} &rarr; ${tgt}`:`${cur}`;
  return `<div class="rrow"><div class="rlab">${m}</div>`
   +`<div class="rtrack" data-tip="<b>${cap(m)}</b><br>now ${cur} sets/wk (recent)${tgt!=null?' &rarr; target '+tgt:''}<br>typical (4wk) ${typ} &middot; active ${d.active_weeks_4wk!=null?d.active_weeks_4wk:'-'}/4 wks<br>MEV ${d.mev} &middot; MAV ${d.mav} &middot; MRV ${d.mrv}<br>recovery: ${REC_W[rc]}"><div class="rzones" style="background:${bg}"></div>${dot}${tick}</div>`
   +`<div class="rval"><b>${valNum}</b>sets &middot; MEV ${d.mev}</div></div>`;
 };
 $('vol-ranges').innerHTML=byRegion(muscles,m=>m).map(g=>{
   const tot=Math.round(g.items.reduce((a,m)=>a+(det[m].sets_per_week||0),0)*10)/10;
   return `<div class="grphd">${g.label}<span>${tot} sets/wk</span></div>`+g.items.map(rangeRow).join('');
 }).join('')||'<div class="empty">No landmark muscles tracked.</div>';

 // --- recovery by muscle, grouped by region ---
 const recs=vp.recommendations||[];
 const recCard=r=>{const tone=REC_TONE[r.recovery]||'mut';
  const sc=r.recovery_score!=null?` &middot; ${r.recovery_score}`:'';
  const sigs=(r.signals||[]).map(s=>`<div class="sig"><span class="sig-dot"></span><span>${esc(s)}</span></div>`).join('');
  const setsRow=(r.current_sets!=null&&r.target_sets!=null)
   ?`<div class="sets-row"><span class="sets-now">${r.current_sets}</span><span class="sets-arr">&#8594;</span><span class="sets-tgt">${r.target_sets}</span><span class="sets-unit">sets/wk</span></div>`:'';
  // Split the composite into momentum (the lift's own trend) vs fatigue (load +
  // drop-off, the leakage-free part) so the read is honest about what it sees.
  const rpeBit=r.rpe!=null?` &middot; rpe ${r.rpe}${r.mean_rpe!=null?' (avg top '+r.mean_rpe+')':''}`:'';
  const mf=(r.momentum!=null||r.fatigue!=null)
   ?`<div class="sig" style="color:var(--text-3);font-size:11.5px;margin:-2px 0 8px">momentum ${r.momentum!=null?r.momentum:'-'} &middot; fatigue ${r.fatigue!=null?r.fatigue:'-'}${rpeBit}${r.confidence?' &middot; confidence '+r.confidence:''}</div>`:'';
  const reason=r.reason?`<div class="reason">${esc(r.reason)}</div>`:'';
  return `<div class="reccard" id="m-${r.muscle}" data-tone="${tone}" data-srch="${r.muscle}">
   <div class="top"><span class="nm">${r.muscle}</span><span class="pill" data-tone="${tone}">${REC_W[r.recovery]}${sc}</span></div>
   ${setsRow}
   ${mf}
   ${sigs?`<div class="sigs">${sigs}</div>`:'<div class="sig" style="color:var(--text-3);font-size:12px;margin-bottom:10px">&mdash; not enough recent data</div>'}
   ${reason}</div>`;
 };
 const confLvl=vp.recovery_confidence,confBasis=vp.recovery_confidence_basis||'';
 const confBanner=confLvl==='low'
   ?`<div class="balwarn">${icon('warn')}<span>Recovery reads are <b>low-confidence</b> on your data right now${confBasis?' ('+esc(confBasis)+')':''}. The set targets below lean on your volume landmarks (MEV/MAV/MRV), not the recovery read &mdash; log RPE to sharpen it.</span></div>`:'';
 $('vol-recovery').innerHTML=confBanner+(byRegion(recs,r=>r.muscle).map(g=>
   `<div class="grp" data-srch="${g.items.map(r=>r.muscle).join(' ')}"><div class="grphd">${g.label}</div><div class="reccards">${g.items.map(recCard).join('')}</div></div>`
 ).join('')||'<div class="empty">No recovery data yet.</div>');

 // --- set targets next week, grouped by region ---
 const tableRow=r=>{const t=r.target_sets+(r.ramping?` &rarr;${r.final_target}`:'');
  const ch=r.delta>0?'+'+r.delta:(r.delta||'hold');
  return `<tr><td>${r.muscle}</td><td class="num">${r.current_sets}</td><td class="num">${t}</td><td class="num">${ch}</td>
   <td><span class="s-${r.recovery}">${REC_W[r.recovery]||r.recovery}</span></td><td>${esc(r.reason)}</td></tr>`;
 };
 $('vol-table').querySelector('tbody').innerHTML=byRegion(recs,r=>r.muscle).map(g=>
   `<tr class="grprow"><td colspan="6">${g.label}</td></tr>`+g.items.map(tableRow).join('')
 ).join('');
}
function gauge(label,val,target){
 if(val==null)return `<div class="gauge"><div class="glabel">${label}<span style="color:var(--text-3)">not enough data</span></div></div>`;
 const max=Math.max(val,target)*1.4,p=v=>Math.min(100,v/max*100);
 const dev=target?Math.abs(val-target)/target:0;
 const col=dev<=0.12?'var(--v-green)':dev<=0.3?'var(--v-amber)':'var(--v-rose)';
 return `<div class="gauge"><div class="glabel">${label}<b>${val} <span style="color:var(--text-3);font-weight:400">target ${target}</span></b></div>
  <div class="gtrack"><div class="gfill" style="width:${p(val)}%;background:${col}"></div><div class="gtarget" style="left:${p(target)}%"></div></div></div>`;
}

// ---- body map ----------------------------------------------------------
// Muscle groups as anatomical paths, authored for the LEFT side relative to a
// figure centre cx; bilateral muscles (mir:1) are mirrored to the right side.
function frontZones(cx){return [
 {m:'neck',d:`M${cx-7} 47 Q${cx-8} 45 ${cx-5} 45 L${cx+5} 45 Q${cx+8} 45 ${cx+7} 47 L${cx+6} 57 Q${cx} 61 ${cx-6} 57 Z`},
 {m:'abs',d:`M${cx-14} 98 Q${cx-15} 96 ${cx-12} 96 L${cx+12} 96 Q${cx+15} 96 ${cx+14} 98 L${cx+11} 131 Q${cx+9} 136 ${cx} 136 Q${cx-9} 136 ${cx-11} 131 Z`},
 {m:'traps',mir:1,d:`M${cx-5} 55 Q${cx-16} 56 ${cx-25} 63 L${cx-23} 66 Q${cx-14} 60 ${cx-5} 60 Z`},
 {m:'shoulders',mir:1,d:`M${cx-25} 61 Q${cx-42} 60 ${cx-45} 76 Q${cx-46} 88 ${cx-38} 90 Q${cx-30} 85 ${cx-28} 72 Q${cx-27} 63 ${cx-25} 61 Z`},
 {m:'chest',mir:1,d:`M${cx-4} 63 L${cx-25} 66 Q${cx-31} 73 ${cx-28} 84 Q${cx-23} 94 ${cx-11} 95 Q${cx-4} 94 ${cx-4} 86 Z`},
 {m:'biceps',mir:1,d:`M${cx-38} 73 Q${cx-46} 82 ${cx-45} 101 Q${cx-44} 117 ${cx-38} 121 Q${cx-33} 113 ${cx-33} 96 Q${cx-33} 81 ${cx-38} 73 Z`},
 {m:'forearms',mir:1,d:`M${cx-37} 125 Q${cx-45} 133 ${cx-44} 149 Q${cx-43} 165 ${cx-38} 170 Q${cx-33} 160 ${cx-34} 145 Q${cx-35} 131 ${cx-37} 125 Z`},
 {m:'quads',mir:1,d:`M${cx-21} 141 Q${cx-25} 158 ${cx-23} 184 Q${cx-21} 201 ${cx-13} 204 Q${cx-8} 197 ${cx-9} 174 Q${cx-9} 152 ${cx-13} 141 Q${cx-17} 138 ${cx-21} 141 Z`},
 {m:'calves',mir:1,d:`M${cx-18} 210 Q${cx-23} 221 ${cx-21} 235 Q${cx-20} 247 ${cx-14} 249 Q${cx-10} 241 ${cx-11} 227 Q${cx-12} 215 ${cx-18} 210 Z`},
];}
function backZones(cx){return [
 {m:'traps',d:`M${cx} 56 Q${cx-22} 59 ${cx-31} 70 Q${cx-19} 70 ${cx-9} 77 L${cx-5} 103 Q${cx} 109 ${cx+5} 103 L${cx+9} 77 Q${cx+19} 70 ${cx+31} 70 Q${cx+22} 59 ${cx} 56 Z`},
 {m:'back',d:`M${cx-5} 104 L${cx+5} 104 L${cx+4} 128 Q${cx} 132 ${cx-4} 128 Z`},
 {m:'shoulders',mir:1,d:`M${cx-27} 62 Q${cx-43} 61 ${cx-46} 77 Q${cx-47} 89 ${cx-39} 91 Q${cx-31} 86 ${cx-30} 73 Q${cx-29} 64 ${cx-27} 62 Z`},
 {m:'back',mir:1,d:`M${cx-27} 82 Q${cx-31} 100 ${cx-25} 117 Q${cx-17} 128 ${cx-7} 123 L${cx-7} 86 Q${cx-17} 82 ${cx-27} 82 Z`},
 {m:'triceps',mir:1,d:`M${cx-38} 74 Q${cx-46} 84 ${cx-45} 103 Q${cx-44} 119 ${cx-38} 123 Q${cx-32} 113 ${cx-33} 96 Q${cx-34} 82 ${cx-38} 74 Z`},
 {m:'forearms',mir:1,d:`M${cx-37} 126 Q${cx-45} 134 ${cx-44} 150 Q${cx-43} 166 ${cx-38} 171 Q${cx-33} 161 ${cx-34} 146 Q${cx-35} 132 ${cx-37} 126 Z`},
 {m:'hamstrings',mir:1,d:`M${cx-21} 142 Q${cx-24} 160 ${cx-22} 185 Q${cx-20} 201 ${cx-13} 204 Q${cx-8} 197 ${cx-8} 174 Q${cx-9} 153 ${cx-12} 142 Q${cx-16} 139 ${cx-21} 142 Z`},
 {m:'calves',mir:1,d:`M${cx-17} 209 Q${cx-23} 221 ${cx-21} 236 Q${cx-19} 248 ${cx-14} 250 Q${cx-10} 240 ${cx-11} 226 Q${cx-12} 214 ${cx-17} 209 Z`},
];}
let bodyMode='volume';
function muscleColor(m){
 const det=(D.week_summary.muscle_detail||{})[m],rec=(D.volume_plan&&D.volume_plan.recovery||{})[m];
 if(bodyMode==='recovery')return TONE[REC_TONE[rec?rec.recovery:'insufficient_data']]||'var(--text-3)';
 if(bodyMode==='recency'){const ds=det?det.days_since:null;if(ds==null)return 'var(--text-3)';
  const t=Math.max(0,1-ds/24);return soft('var(--v-blue)',Math.round(22+t*68));}
 if(!det||det.mev==null)return 'var(--text-3)';
 // Continuous heat: cool (blue) = undertrained, warm (red) = lots of volume.
 // Piecewise so landmark boundaries (MEV/MAV/MRV) stay meaningful on the ramp.
 return heatGrad(volHeat(det.sets_per_week,det.mev,det.mav,det.mrv));
}
// Map weekly sets onto 0..1 with MEV->.28, MAV->.62, MRV->.85 anchors.
function volHeat(v,mev,mav,mrv){
 if(v<=0)return 0;
 if(v<mev)return mev>0?0.28*(v/mev):0;
 if(v<=mav)return 0.28+0.34*((v-mev)/Math.max(1e-6,mav-mev));
 if(v<=mrv)return 0.62+0.23*((v-mav)/Math.max(1e-6,mrv-mav));
 return Math.min(1,0.85+0.15*((v-mrv)/Math.max(1e-6,mrv)));
}
function cap(s){return s?s.charAt(0).toUpperCase()+s.slice(1):s;}
function zoneTip(m){
 const det=(D.week_summary.muscle_detail||{})[m],rec=(D.volume_plan&&D.volume_plan.recovery||{})[m];
 let l=`<b>${cap(m)}</b>`;
 if(det&&det.mev!=null)l+=`<br>${det.sets_per_week} sets/wk (${det.status.replace('_',' ')})`;
 if(rec)l+=`<br>recovery: ${REC_W[rec.recovery]}`;
 if(det&&det.days_since!=null)l+=`<br>last trained ${det.days_since}d ago`;
 return l;
}
function sil(cx){return `
 <circle class="sil" cx="${cx}" cy="29" r="16"/>
 <rect class="sil" x="${cx-8}" y="43" width="16" height="12" rx="6"/>
 <path class="sil" d="M${cx-24} 58 Q${cx-32} 60 ${cx-31} 70 L${cx-29} 120 Q${cx-28} 134 ${cx-14} 135 L${cx+14} 135 Q${cx+28} 134 ${cx+29} 120 L${cx+31} 70 Q${cx+32} 60 ${cx+24} 58 Z"/>
 <rect class="sil" x="${cx-45}" y="63" width="14" height="112" rx="7"/>
 <rect class="sil" x="${cx+31}" y="63" width="14" height="112" rx="7"/>
 <rect class="sil" x="${cx-25}" y="135" width="19" height="121" rx="9.5"/>
 <rect class="sil" x="${cx+6}" y="135" width="19" height="121" rx="9.5"/>`;}
function zonePaths(list,cx){return list.map(z=>{const t=zoneTip(z.m);
 let s=`<path class="mz" data-m="${z.m}" data-tip="${t}" d="${z.d}"/>`;
 if(z.mir)s+=`<path class="mz" data-m="${z.m}" data-tip="${t}" d="${z.d}" transform="translate(${2*cx} 0) scale(-1 1)"/>`;
 return s;
}).join('');}
function details(cx,side){
 const d=side==='front'
  ?[`M${cx} 99 L${cx} 132`,`M${cx-11} 110 L${cx+11} 110`,`M${cx-10} 121 L${cx+10} 121`,`M${cx} 64 L${cx} 93`]
  :[`M${cx} 73 L${cx} 128`];
 return d.map(p=>`<path class="det" d="${p}"/>`).join('');
}
function renderBody(){
 const modes=[['volume','Volume'],['recovery','Recovery'],['recency','Recency']];
 $('body-controls').innerHTML=modes.map(m=>`<span class="chip${m[0]===bodyMode?' on':''}" data-mode="${m[0]}">${m[1]}</span>`).join('');
 $('body-controls').onclick=e=>{const c=e.target.closest('.chip');if(!c)return;bodyMode=c.dataset.mode;renderBody();};
 const legends={
  volume:[[heatGrad(.14),'under MEV'],[heatGrad(.45),'productive'],[heatGrad(.72),'high'],[heatGrad(1),'over MRV'],['var(--text-3)','untrained']],
  recovery:[['var(--ok)','good'],['var(--warn)','mixed'],['var(--bad)','poor'],['var(--text-3)','no data']],
  recency:[[soft('var(--v-blue)',85),'trained recently'],[soft('var(--v-blue)',35),'a while ago'],['var(--text-3)','long ago / never']],
 };
 $('body-legend').innerHTML=legends[bodyMode].map(l=>`<span><span class="swatch" style="background:${l[0]}"></span>${l[1]}</span>`).join('');
 $('body-map').innerHTML=`<svg viewBox="30 8 300 272" role="img" aria-label="Muscle map colored by ${bodyMode}">
  ${sil(90)}${sil(270)}
  ${zonePaths(frontZones(90),90)}${zonePaths(backZones(270),270)}
  ${details(90,'front')}${details(270,'back')}
  <text class="figlabel" x="90" y="266">Front</text><text class="figlabel" x="270" y="266">Back</text></svg>`;
 $('body-map').querySelectorAll('.mz').forEach(el=>{el.style.fill=muscleColor(el.dataset.m);
  el.onclick=()=>{showTab('volume');const c=$('m-'+el.dataset.m);if(c){c.scrollIntoView({behavior:'smooth',block:'center'});c.classList.add('hl');setTimeout(()=>c.classList.remove('hl'),1600);}};});
}

// ---- calendar ----------------------------------------------------------
const CAL=D.calendar||[];const CALMAP={};CAL.forEach(c=>CALMAP[c.date]=c);
function fmtD(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function parseD(s){const p=s.split('-');return new Date(+p[0],+p[1]-1,+p[2]);}
function heatFill(t){return t<=0?'var(--surface-2)':`color-mix(in srgb,var(--v-green) ${Math.round(14+t*72)}%,var(--surface-2))`;}
let curY,curM;
function renderCalendar(){
 if(!CAL.length){$('cal-heat').innerHTML='<div class="empty">'+icon('calendar')+'No sessions logged.</div>';return;}
 const dates=CAL.map(c=>c.date).sort();
 const totDays=CAL.length;let maxGap=0;
 for(let i=1;i<dates.length;i++){const g=(parseD(dates[i])-parseD(dates[i-1]))/864e5;if(g>maxGap)maxGap=g;}
 const lastAgo=Math.round((Date.now()-parseD(dates[dates.length-1]))/864e5);
 const busy=(D.history||[]).slice().sort((a,b)=>b.hard_sets-a.hard_sets)[0];
 $('cal-stats').innerHTML=[
  ['Training days',totDays,'Distinct days with at least one working set.'],
  ['Avg / week',D.fatigue.frequency.per_week_28d,'Sessions per week over the last 4 weeks.'],
  ['Last trained',lastAgo+'d ago','Days since your most recent session (real today).'],
  ['Longest layoff',maxGap+'d','Biggest gap between two training days in your history.'],
  ['Busiest month',busy?busy.month.slice(2):'-','Month with the most working sets.'],
 ].map(c=>`<div class="metric"><div class="k">${c[0]} <span class="info" title="${esc(c[2])}">i</span></div><div class="v">${c[1]}</div></div>`).join('');
 const first=parseD(dates[0]),last=parseD(dates[dates.length-1]);
 const start=new Date(first);start.setDate(start.getDate()-((start.getDay()+6)%7));
 const cols=Math.ceil(((last-start)/864e5+1)/7);
 const maxv=Math.max(...CAL.map(c=>c.volume||c.sets),1);
 const cell=13,gap=3;let rects='',labels='',wd='',lastMo=-1,d=new Date(start);
 ['M','W','F'].forEach((w,i)=>{wd+=`<text class="wd" x="-6" y="${[0,2,4][i]*(cell+gap)+10}" text-anchor="end">${w}</text>`;});
 for(let col=0;col<cols;col++){for(let row=0;row<7;row++){
  const ds=fmtD(d),info=CALMAP[ds],x=col*(cell+gap),y=row*(cell+gap);
  let fill='var(--surface-2)',attr='',cls='cell';
  if(info){fill=heatFill(Math.min(1,(info.volume||info.sets)/maxv));cls='cell has';
   attr=`data-tip="<b>${ds}</b><br>${info.sets} sets &middot; ${info.n_exercises} lifts${info.volume?'<br>vol '+Math.round(info.volume):''}<br>${esc(info.muscles.join(', '))}" data-day="${ds}"`;}
  rects+=`<rect class="${cls}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${fill}" ${attr}/>`;
  if(row===0&&d.getMonth()!==lastMo){lastMo=d.getMonth();labels+=`<text class="wd" x="${x}" y="-5">${MON[d.getMonth()]}</text>`;}
  d.setDate(d.getDate()+1);
 }}
 const Wp=cols*(cell+gap),Hp=7*(cell+gap);
 $('cal-heat').innerHTML=`<svg class="heat" viewBox="-18 -16 ${Wp+24} ${Hp+22}" style="max-width:${Wp+24}px;margin:auto" role="img" aria-label="Training activity heatmap">${wd}${labels}${rects}</svg>`
  +`<div class="heatlegend">less <span class="sq" style="background:var(--surface-2)"></span><span class="sq" style="background:${heatFill(.35)}"></span><span class="sq" style="background:${heatFill(.7)}"></span><span class="sq" style="background:${heatFill(1)}"></span> more</div>`;
 $('cal-heat').onclick=e=>{const r=e.target.closest('[data-day]');if(r)showDay(r.dataset.day);};
 const lm=parseD(dates[dates.length-1]);curY=lm.getFullYear();curM=lm.getMonth();
 renderMonth();showDay(dates[dates.length-1]);
}
function renderMonth(){
 $('monthlabel').textContent=MON[curM]+' '+curY;
 const lead=(new Date(curY,curM,1).getDay()+6)%7,days=new Date(curY,curM+1,0).getDate();
 const maxv=Math.max(...CAL.map(c=>c.volume||c.sets),1);
 let cells=['Mo','Tu','We','Th','Fr','Sa','Su'].map(h=>`<div class="cell hd">${h}</div>`).join('');
 for(let i=0;i<lead;i++)cells+='<div class="cell" style="border:0"></div>';
 for(let day=1;day<=days;day++){const ds=fmtD(new Date(curY,curM,day)),info=CALMAP[ds];
  if(info){const bg=heatFill(Math.min(1,(info.volume||info.sets)/maxv));
   cells+=`<div class="cell has" data-day="${ds}" style="background:${bg}">${day}</div>`;}
  else cells+=`<div class="cell">${day}</div>`;}
 $('cal-month').innerHTML=cells;
 $('cal-month').onclick=e=>{const c=e.target.closest('[data-day]');if(c){
  $('cal-month').querySelectorAll('.cell').forEach(x=>x.classList.remove('sel'));c.classList.add('sel');showDay(c.dataset.day);}};
}
$('prevm').onclick=()=>{curM--;if(curM<0){curM=11;curY--;}renderMonth();};
$('nextm').onclick=()=>{curM++;if(curM>11){curM=0;curY++;}renderMonth();};
function showDay(ds){
 const s=(D.sessions||{})[ds];
 if(!s){$('cal-detail').innerHTML=`<div class="empty">No session on ${ds}.</div>`;return;}
 const rows=s.exercises.map(x=>`<tr><td>${esc(x.name)}</td><td class="s-building" style="text-transform:capitalize">${x.muscle||''}</td><td class="num">${x.n_sets}</td>
  <td class="num">${x.top_weight!=null?x.top_weight+'×'+(x.top_reps??'-'):'-'}</td><td class="num">${x.e1rm??'-'}</td></tr>`).join('');
 $('cal-detail').innerHTML=`<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px">
   <div style="font-weight:600;font-size:15px">${esc(s.title)} <span style="color:var(--text-3);font-weight:400">· ${ds}</span></div>
   <span style="color:var(--text-3);font-size:12.5px">${s.total_sets} sets · vol ${s.volume}${s.duration_min?' · '+s.duration_min+'m':''}</span></div>
  <div class="tablewrap" style="margin-top:12px;border:0"><table><thead><tr><th>Exercise</th><th>Muscle</th><th class="num">Sets</th><th class="num">Top set</th><th class="num">e1RM</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// ---- records -----------------------------------------------------------
let recSort={key:'e1rm',dir:-1};
const REC_KEYS={
 name:r=>r.name.toLowerCase(), muscle:r=>r.muscle,
 e1rm:r=>r.best_e1rm?r.best_e1rm.value:-1,
 heaviest:r=>r.heaviest?r.heaviest.weight:-1,
 reps:r=>r.best_reps?r.best_reps.reps:-1,
 vol:r=>r.best_session_volume?r.best_session_volume.value:-1,
 date:r=>{const d=(r.best_e1rm||{}).date||(r.heaviest||{}).date||(r.best_session_volume||{}).date;return d?Date.parse(d):0;},
};
function renderRecords(){
 const recs=D.records||[];
 if(!recs.length){$('rec-musc').innerHTML='';
  $('rec-table').querySelector('tbody').innerHTML='<tr><td colspan="7"><div class="empty">'+icon('star')+'No records yet.</div></td></tr>';return;}
 const muscles=[...new Set(recs.map(r=>r.muscle))].sort();
 $('rec-musc').innerHTML=`<span class="chip on" data-m="all">all</span>`+muscles.map(m=>`<span class="chip" data-m="${m}">${m}</span>`).join('');
 $('rec-musc').onclick=e=>{const c=e.target.closest('.chip');if(!c)return;
  $('rec-musc').querySelectorAll('.chip').forEach(x=>x.classList.toggle('on',x===c));
  $('tab-records').dataset.statusFilter=c.dataset.m;applyFilter();};
 $('rec-table').querySelector('thead').onclick=e=>{const th=e.target.closest('th[data-sort]');if(!th)return;
  const k=th.dataset.sort;if(recSort.key===k)recSort.dir*=-1;else recSort={key:k,dir:(k==='name'||k==='muscle')?1:-1};drawRecRows();};
 drawRecRows();
}
function drawRecRows(){
 const recs=(D.records||[]).slice(),acc=REC_KEYS[recSort.key];
 recs.sort((a,b)=>{const x=acc(a),y=acc(b);return x<y?-recSort.dir:x>y?recSort.dir:a.name.localeCompare(b.name);});
 const cut=new Date(Date.parse(D.window.latest_session+'T00:00:00')-90*864e5);
 const fresh=ds=>ds&&parseD(ds)>=cut, star=`<span class="recstar">${icon('star')}</span>`;
 const cell=(o,fmt)=>o?fmt(o):'<span class="dim">&ndash;</span>';
 const tipAttr=o=>o.date?` data-tip="on ${o.date}"`:'';
 $('rec-table').querySelectorAll('th[data-sort]').forEach(th=>{const a=th.querySelector('.arr');if(a)a.remove();
  const on=th.dataset.sort===recSort.key;th.classList.toggle('sorted',on);
  if(on)th.insertAdjacentHTML('beforeend',`<span class="arr">${recSort.dir<0?'&#9660;':'&#9650;'}</span>`);});
 $('rec-table').querySelector('tbody').innerHTML=recs.map(r=>{
  const pr=(r.best_e1rm||{}).date||(r.heaviest||{}).date,isF=fresh(pr);
  return `<tr data-srch="${esc((r.name+' '+r.muscle).toLowerCase())}" data-status="${r.muscle}">
   <td>${isF?star:''}${esc(r.name)}</td>
   <td class="dim" style="text-transform:capitalize">${r.muscle}</td>
   <td class="num">${cell(r.best_e1rm,o=>`<b class="big" data-tip="from ${o.set} on ${o.date}">${o.value}</b>`)}</td>
   <td class="num">${cell(r.heaviest,o=>`<span${tipAttr(o)}>${o.weight}&times;${o.reps}</span>`)}</td>
   <td class="num">${cell(r.best_reps,o=>`<span${tipAttr(o)}>${o.reps} @ ${o.weight}</span>`)}</td>
   <td class="num">${cell(r.best_session_volume,o=>`<span${tipAttr(o)}>${Math.round(o.value)}</span>`)}</td>
   <td class="num dim">${pr||'&ndash;'}</td></tr>`;
 }).join('');
 applyFilter();
}

// ---- goals -------------------------------------------------------------
function renderGoals(){
 const goals=D.goals||[];
 if(!goals.length){$('goal-wrap').innerHTML=`<div class="empty">${icon('target')}<div>No goals set. Add one with<br><code>python coach.py set-goal "Bench Press (Barbell)" e1rm 120 --by 2026-12-31</code></div></div>`;return;}
 const VC={on_track:'ok',ahead:'ok',achieved:'ok',behind:'warn',off_track:'bad',unknown:'mut'};
 $('goal-wrap').innerHTML=goals.map(g=>{
  const cur=g.current,tgt=g.target_value,pct=cur!=null&&tgt?Math.max(0,Math.min(1,cur/tgt)):0;
  const tone=VC[g.verdict]||'mut',col=TONE[tone];
  return `<div class="goalcard"><div class="nm">${esc(g.exercise)}</div>
   ${ring(pct,col)}
   <div style="margin-top:8px;font-variant-numeric:tabular-nums">${cur!=null?cur:'?'} / <b>${tgt}</b> ${esc(g.metric)}</div>
   <div style="margin-top:9px"><span class="pill" data-tone="${tone}">${(g.verdict||'unknown').replace('_',' ')}</span></div>
   ${g.projected_date?`<div style="margin-top:8px;color:var(--text-3);font-size:12px">projected ${g.projected_date}${g.target_date?' · target '+g.target_date:''}</div>`:''}</div>`;
 }).join('');
}
function ring(pct,color){const r=46,c=2*Math.PI*r,off=c*(1-pct);
 return `<svg class="ring" viewBox="0 0 120 120"><circle class="ringbg" cx="60" cy="60" r="${r}"/>
  <circle class="ringfg" cx="60" cy="60" r="${r}" stroke="${color}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 60 60)"/>
  <text class="ringtx" x="60" y="68" text-anchor="middle">${Math.round(pct*100)}%</text></svg>`;}

// ---- boot --------------------------------------------------------------
function initChrome(){
 $('ic-search').innerHTML=icon('search');
 $('srch-clear').innerHTML=icon('x');
 $('ic-exp').innerHTML=icon('chevron');
 updateThemeIcon();
 document.querySelectorAll('[data-i]').forEach(el=>el.innerHTML=icon(el.dataset.i));
 $('prevm').innerHTML=icon('left');$('nextm').innerHTML=icon('right');
}
initChrome();buildAll();
showTab(location.hash.replace('#','')||'overview');
</script>
</body></html>"""
