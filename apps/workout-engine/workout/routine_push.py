"""Push next week's targets back into the user's Hevy routines - the write half
of the closed loop.

Strategy (user's choice): UPDATE EXISTING ROUTINES IN PLACE. We read the user's
current routines, overwrite each working set's target weight/reps with the
engine's next_target, and PUT them back - keeping the structure they already
train with, just refreshing the numbers. We never create or delete routines
here, and we never invent exercises: a routine exercise with no engine target is
passed through untouched (and surfaced in the preview).

Because PUT /routines/{id} REPLACES the whole routine, every exercise is sent
back - matched ones updated, unmatched ones reconstructed verbatim - so nothing
is ever dropped. Default flow previews only; writes happen on `coach.py push
--push`, matching the user's advise-not-auto style.
"""
from . import hevy_client, summary

# Fields the PUT set body accepts (PutRoutinesRequestSet). We deliberately drop
# `index` (positional) and `rpe` (not part of the routine set schema).
_REQ_SET_FIELDS = ("type", "weight_kg", "reps", "distance_meters",
                   "duration_seconds", "custom_metric", "rep_range")


def _set_to_request(s):
    """Reconstruct a GET routine set into the PUT request shape, verbatim."""
    return {k: s.get(k) for k in _REQ_SET_FIELDS}


def _is_working(s):
    """Only plain working sets get retargeted; warmups/dropsets are left alone."""
    return (s.get("type") or "normal") == "normal"


def _exercise_request(ex, sets):
    """Reconstruct a GET routine exercise into the PUT request shape. The GET
    uses `supersets_id`; the PUT expects `superset_id` - bridge that here."""
    return {
        "exercise_template_id": ex.get("exercise_template_id"),
        "superset_id": ex.get("superset_id", ex.get("supersets_id")),
        "rest_seconds": ex.get("rest_seconds"),
        "notes": ex.get("notes"),
        "sets": sets,
    }


def _target_index(obj, conn):
    """Index engine targets by exercise title, plus a template_id->title fallback
    built from the learned exercise_map (so a routine exercise still resolves if
    its title ever drifts from the logged title)."""
    by_title = {e["name"]: e["next_target"] for e in obj["exercises"]
                if e["next_target"].get("sets")}
    tid_to_title = {}
    for row in conn.execute(
            "SELECT exercise_title, exercise_template_id FROM exercise_map "
            "WHERE exercise_template_id IS NOT NULL"):
        tid_to_title[row["exercise_template_id"]] = row["exercise_title"]
    return by_title, tid_to_title


def _resolve(ex, by_title, tid_to_title):
    """Find the engine target for a routine exercise, by title then template_id."""
    t = by_title.get((ex.get("title") or "").strip())
    if t:
        return t
    tid = ex.get("exercise_template_id")
    if tid and tid in tid_to_title:
        return by_title.get(tid_to_title[tid])
    return None


def build_updates(conn, as_of=None):
    """Compute per-routine PUT payloads that refresh targets in place. Returns a
    list of update dicts: {routine_id, title, exercise_changes[], unmatched[],
    payload}. Only routines with >=1 real change are included."""
    obj = summary.build(conn, as_of)
    by_title, tid_to_title = _target_index(obj, conn)

    updates = []
    for r in hevy_client.iter_routines():
        if "exercises" not in r and r.get("id"):
            detail = hevy_client.get_routine(r["id"])
            r = detail.get("routine", detail) if isinstance(detail, dict) else r

        ex_payload, changes, unmatched = [], [], []
        for ex in (r.get("exercises") or []):
            title = (ex.get("title") or "").strip()
            target = _resolve(ex, by_title, tid_to_title)
            if not target:
                ex_payload.append(_exercise_request(ex, [
                    _set_to_request(s) for s in (ex.get("sets") or [])]))
                unmatched.append(title)
                continue

            tw, tr = target.get("weight"), target.get("reps")
            new_sets, set_diffs = [], []
            for s in (ex.get("sets") or []):
                ns = _set_to_request(s)
                if _is_working(s):
                    old = (s.get("weight_kg"), s.get("reps"))
                    if tw is not None:
                        ns["weight_kg"] = tw
                    if tr is not None:
                        ns["reps"] = tr
                        ns["rep_range"] = None  # concrete target beats a range
                    if (ns["weight_kg"], ns["reps"]) != old:
                        set_diffs.append({"old": old,
                                          "new": (ns["weight_kg"], ns["reps"])})
                new_sets.append(ns)
            ex_payload.append(_exercise_request(ex, new_sets))
            if set_diffs:
                changes.append({"exercise": title, "rec_type": target.get("rec_type"),
                                "rationale": target.get("rationale"), "sets": set_diffs})

        if changes:
            updates.append({
                "routine_id": r.get("id"), "title": r.get("title") or "(untitled)",
                "exercise_changes": changes, "unmatched": unmatched,
                "payload": {"routine": {"title": r.get("title"),
                                        "notes": r.get("notes"),
                                        "exercises": ex_payload}}})
    return updates


def preview(updates):
    """Print a human-readable old->new diff. Read-only: makes no API writes."""
    if not updates:
        print("No routine changes. Either no routines matched the engine's "
              "targets, or every target already matches your routines.")
        return
    print(f"Routine updates ready ({len(updates)} routine(s)). Preview - nothing "
          "written yet. Re-run with --push to apply.\n")
    for u in updates:
        print(f"== {u['title']} ==")
        for c in u["exercise_changes"]:
            tag = f" [{c['rec_type']}]" if c.get("rec_type") else ""
            print(f"  {c['exercise']}{tag}")
            for d in c["sets"]:
                ow, orr = d["old"]
                nw, nr = d["new"]
                fmt = lambda w, rp: f"{(w if w is not None else '-')}kg x {rp}"
                print(f"     {fmt(ow, orr)}  ->  {fmt(nw, nr)}")
            if c.get("rationale"):
                print(f"     ({c['rationale']})")
        if u["unmatched"]:
            print(f"  (left unchanged, no target: {', '.join(u['unmatched'])})")
        print()


def push(conn, updates):
    """Write the updates to Hevy via PUT. Returns the number of routines written.
    Targets were already persisted to `recommendations` by the report step, so
    adherence grading still closes the loop on next sync."""
    n = 0
    for u in updates:
        hevy_client.update_routine(u["routine_id"], u["payload"])
        print(f"Updated: {u['title']}")
        n += 1
    return n
