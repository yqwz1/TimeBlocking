import { DateTime } from 'luxon';
import type { BlockReason } from '@timeblock/shared';
import { decompose } from './chunking.js';
import { buildEnergyIntervals, classifyTask, type EnergyIntervals } from './energy.js';
import { rruleMatchesDate, weekStartOf } from './habits.js';
import { effectiveDeadlineMs, scoreTask } from './score.js';
import { computeDayLoads, deadlinePressure, forecastCapacity, type ForecastTask, type TaskRisk } from './feasibility.js';
import { findBestSlot, reason, SLOT_WEIGHTS, type ScorePart, type SlotContext } from './slotScore.js';
import {
  buildDayWindows,
  ceilTo,
  dayWindow,
  isFree,
  localTimeToMs,
  mergeIntervals,
  msToUtcIso,
  subtractIntervals,
} from './slots.js';
import type { DesiredBlock, Interval, PlanHabitInput, PlanInput, PlanResult } from './types.js';

/** Turn the winning slot's score parts into user-facing reasons (dropping weak/baseline terms). */
function partsToReasons(parts: ScorePart[]): BlockReason[] {
  const out: BlockReason[] = [];
  for (const p of parts) {
    if (p.code === 'earliest_fit') continue; // baseline — only used as a fallback below
    if (p.code === 'energy_match' && p.value < SLOT_WEIGHTS.energy * 0.6) continue; // only surface a strong match
    if (p.code === 'learned_hour' && p.value < SLOT_WEIGHTS.hour * 0.15) continue; // skip neutral/negative hours
    out.push(reason(p.code, p.detail));
  }
  return out.length ? out : [reason('earliest_fit')];
}

/**
 * The pure planner: no I/O, deterministic for a given input.
 *
 * 1. Expand working-hour windows over the horizon (clamped to now).
 * 2. Treat external events + locked/in-progress blocks as immovable busy time.
 * 3. Anchor habit instances first (they are the skeleton of the day).
 * 4. Greedily place tasks by score into the earliest free slot, keeping
 *    still-valid placements when sticky (poll cycles) and repacking cleanly
 *    when not (Recalculate).
 */
export function plan(input: PlanInput): PlanResult {
  const tz = input.timezone;
  const granMs = input.granularityMin * 60_000;
  const bufMs = input.bufferMin * 60_000;
  const nowMs = Date.parse(input.nowUtc);
  const nowCeil = ceilTo(nowMs, granMs);

  const windows = buildDayWindows(nowMs, tz, input.horizonDays, input.workingHours, granMs);
  const horizonEnd = windows.length ? windows[windows.length - 1].end : nowCeil;
  const ctx: SlotContext = { nowCeil, horizonEnd, granMs, bufMs };
  const energyIntervals: EnergyIntervals | null =
    input.energy.mode === 'off' ? null : buildEnergyIntervals(nowMs, tz, input.horizonDays, input.energy.windows);
  const hourCtx =
    input.learned.enabled && input.learned.hourSuccess.totalWeight > 0
      ? { rates: input.learned.hourSuccess.rates, confidence: Math.min(1, input.learned.hourSuccess.totalWeight / 40), tz }
      : null;

  // Learned duration calibration: scale a task's estimate by the confident multiplier
  // (per-project first, then global), grid-aligned so idle cycles don't resize blocks.
  const effDuration = (t: PlanInput['tasks'][number]): { min: number; multiplier: number } => {
    if (!input.learned.enabled) return { min: t.durationMin, multiplier: 1 };
    const proj = t.projectId ? input.learned.multipliers.byProject[t.projectId] : undefined;
    let m = 1;
    if (proj && proj.weight >= 5) m = proj.value;
    else if (input.learned.multipliers.global.weight >= 10) m = input.learned.multipliers.global.value;
    m = Math.min(2.5, Math.max(0.5, m));
    const adj = Math.max(input.granularityMin, Math.round((t.durationMin * m) / input.granularityMin) * input.granularityMin);
    return { min: adj, multiplier: m };
  };

  let busy: Interval[] = mergeIntervals(
    input.busy
      .map((b) => ({ start: Date.parse(b.startUtc), end: Date.parse(b.endUtc) }))
      .filter((iv) => iv.end > nowMs),
  );
  const occupy = (iv: Interval) => {
    busy = mergeIntervals([...busy, iv]);
  };

  const result: PlanResult = { blocks: [], atRisk: [], unplaceable: [], risks: [], dayLoads: [] };
  const placementRisks: TaskRisk[] = []; // per-task: this block will slip / can't be placed

  // ---- horizon dates (local) ----
  const today = DateTime.fromMillis(nowMs, { zone: tz }).startOf('day');
  const horizonDates: string[] = [];
  for (let d = 0; d <= input.horizonDays; d++) horizonDates.push(today.plus({ days: d }).toISODate()!);

  // ---- 3. habits ----
  const placedPerHabitWeek = new Map<string, number>(); // `${habitId}|${weekStart}` -> minutes

  const tryPlaceHabit = (habit: PlanHabitInput, dateIso: string, extra: BlockReason[] = []): boolean => {
    const win = dayWindow(dateIso, tz, habit.windowStart, habit.windowEnd);
    if (!win || win.end <= nowCeil) return false;
    const clamped: Interval = { start: Math.max(win.start, nowCeil), end: win.end };
    const freeInWin = subtractIntervals([clamped], busy);
    const durMs = habit.durationMin * 60_000;

    let slot: Interval | null = null;
    const reasons: BlockReason[] = [...extra];
    if (habit.preferredStart) {
      const pref = localTimeToMs(dateIso, tz, habit.preferredStart);
      if (pref >= clamped.start && pref + durMs <= win.end && isFree(freeInWin, { start: pref, end: pref + durMs })) {
        slot = { start: pref, end: pref + durMs };
        reasons.push(reason('preferred_start', habit.preferredStart));
      }
    }
    if (!slot) {
      const best = findBestSlot(freeInWin, durMs, granMs, null, null, null, ctx);
      if (best) {
        slot = best.slot;
        reasons.push(reason('habit_window'));
      }
    }
    if (!slot) return false;

    occupy({ start: slot.start, end: slot.end + bufMs });
    result.blocks.push({
      key: `habit:${habit.id}:${dateIso}`,
      habitId: habit.id,
      habitName: habit.name,
      date: dateIso,
      startUtc: msToUtcIso(slot.start),
      endUtc: msToUtcIso(slot.end),
      reasons,
    });
    const wk = `${habit.id}|${weekStartOf(dateIso, tz)}`;
    placedPerHabitWeek.set(wk, (placedPerHabitWeek.get(wk) ?? 0) + habit.durationMin);
    return true;
  };

  const habitsSorted = [...input.habits].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  // Base recurrences, day by day so mornings fill in date order.
  for (const dateIso of horizonDates) {
    for (const habit of habitsSorted) {
      if (habit.excludedDates.includes(dateIso)) continue;
      if (!rruleMatchesDate(habit.rrule, dateIso, tz)) continue;
      tryPlaceHabit(habit, dateIso);
    }
  }

  // Learning goals: top up each week until the weekly minutes target is met.
  for (const habit of habitsSorted) {
    if (habit.kind !== 'learning' || !habit.weeklyTargetMin) continue;
    for (const dateIso of horizonDates) {
      const week = weekStartOf(dateIso, tz);
      const wk = `${habit.id}|${week}`;
      const planned = (placedPerHabitWeek.get(wk) ?? 0) + (habit.creditMin[week] ?? 0);
      if (planned >= habit.weeklyTargetMin) continue;
      if (habit.excludedDates.includes(dateIso)) continue;
      if (result.blocks.some((b) => b.key === `habit:${habit.id}:${dateIso}`)) continue;
      tryPlaceHabit(habit, dateIso, [reason('weekly_target')]);
    }
  }

  // ---- 4. tasks ----
  // Deadline-feasibility-aware ordering: place deadlined work first, in EDF
  // (earliest-deadline-first) order, so a high-score long task can't starve a
  // task with a tighter deadline. Undated work fills the gaps by score.
  const score = (t: PlanInput['tasks'][number]) => scoreTask(t, nowMs, tz);
  const deadlineOf = (t: PlanInput['tasks'][number]) => effectiveDeadlineMs(t, tz);
  // A task is "deadlined within the horizon" if its deadline falls before the end
  // of the last horizon day (not merely before the last working window).
  const horizonCutoff = today.plus({ days: input.horizonDays + 1 }).startOf('day').toMillis();
  const groupA = input.tasks.filter((t) => {
    const d = deadlineOf(t);
    return d != null && d <= horizonCutoff;
  });
  const groupB = input.tasks.filter((t) => {
    const d = deadlineOf(t);
    return d == null || d > horizonCutoff;
  });
  groupA.sort((a, b) => deadlineOf(a)! - deadlineOf(b)! || score(b) - score(a) || a.id.localeCompare(b.id));
  groupB.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  const tasksSorted = [...groupA, ...groupB];

  // Capacity forecast: warn before a deadline crunch, even if each task fits alone.
  const forecastTasks: ForecastTask[] = groupA.map((t) => ({
    id: t.id,
    deadlineMs: deadlineOf(t)!,
    loadMs: effDuration(t).min * 60_000 + bufMs,
    score: score(t),
  }));
  // Aggregate "this day/deadline is over-committed" warnings, kept separate from
  // per-task placement risks (a task can be both over-committed and individually late).
  const forecastRisks = forecastCapacity(forecastTasks, subtractIntervals(windows, busy), nowCeil, tz);

  // Next local-day start (used by the 'spread' chunk policy to push each sitting to a new day).
  const nextDayStartMs = (afterMs: number): number =>
    DateTime.fromMillis(afterMs, { zone: tz }).plus({ days: 1 }).startOf('day').toMillis();

  const placedByProject = new Map<string, Interval[]>(); // for same-project batching

  // ---- day-fullness budget (Phase 3): task time only — habits/external events are commitments, not planner ambition ----
  const dayOf = (ms: number) => DateTime.fromMillis(ms, { zone: tz }).toISODate()!;
  const capacityMsByDay = new Map<string, number>();
  if (input.dayBudget) {
    for (const w of windows) {
      const day = dayOf(w.start);
      capacityMsByDay.set(day, (capacityMsByDay.get(day) ?? 0) + (w.end - w.start));
    }
  }
  let taskMsByDay = new Map<string, number>();
  const withinBudget = (free: Interval[], tentative: Map<string, number>): Interval[] => {
    if (!input.dayBudget) return free;
    const frac = input.dayBudget.maxTaskFraction;
    return free.filter((iv) => {
      const day = dayOf(iv.start);
      const cap = capacityMsByDay.get(day) ?? 0;
      return cap === 0 || (tentative.get(day) ?? 0) < cap * frac;
    });
  };

  for (const t of tasksSorted) {
    const deadline = deadlineOf(t);
    const eff = effDuration(t);
    const pressure = deadlinePressure(deadline, nowCeil, eff.min * 60_000);
    const taskClass = classifyTask(t, input.energy.deepWorkMinMin, input.energy.deepLabel, input.energy.shallowLabel);
    const taskCtx: SlotContext = {
      ...ctx,
      pressure,
      energy: energyIntervals ? { intervals: energyIntervals, taskClass } : null,
      sameProjectBlocks: t.projectId ? placedByProject.get(t.projectId) ?? [] : [],
      hour: hourCtx,
    };
    const durationReason =
      Math.abs(eff.multiplier - 1) > 0.05
        ? reason('learned_duration', `${eff.multiplier > 1 ? '+' : '−'}${Math.round(Math.abs(eff.multiplier - 1) * 100)}% vs your estimate`)
        : null;
    const objectiveReason = (t.objectiveBoost ?? 0) > 0.15 ? reason('objective_boost') : null;
    const plannedReason = t.plannedForDate ? reason('picked_today') : null;
    const chunks = decompose(eff.min, input.granularityMin, input.maxChunkMin, input.minChunkMin, input.splitEnabled);
    const count = chunks.length;
    const deadlineUtc = deadline != null ? msToUtcIso(deadline) : undefined;

    // Stickiness: keep the whole set of current chunks if it still lines up (all-or-nothing).
    if (input.sticky && t.currentChunks.length === count) {
      const free = subtractIntervals(windows, busy);
      const cur = [...t.currentChunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
      const ivs = cur.map((c) => ({ start: Date.parse(c.startUtc), end: Date.parse(c.endUtc) }));
      const ordered = ivs.every((iv, i) => i === 0 || iv.start >= ivs[i - 1].end);
      const valid =
        ivs.every((iv) => iv.start >= nowMs && isFree(free, iv)) &&
        ordered &&
        (deadline == null || ivs[ivs.length - 1].end <= deadline);
      if (valid) {
        ivs.forEach((iv, i) => {
          const reasons = [reason('sticky')];
          if (plannedReason) reasons.push(plannedReason);
          if (objectiveReason) reasons.push(objectiveReason);
          if (durationReason) reasons.push(durationReason);
          if (count > 1) reasons.push(reason('chunk', `part ${i + 1} of ${count}`));
          result.blocks.push({
            key: `task:${t.id}:${i}`,
            taskId: t.id,
            startUtc: msToUtcIso(iv.start),
            endUtc: msToUtcIso(iv.end),
            reasons,
            ...(count > 1 ? { chunk: { index: i, count } } : {}),
          });
          occupy({ start: iv.start, end: iv.end + bufMs });
          const day = dayOf(iv.start);
          taskMsByDay.set(day, (taskMsByDay.get(day) ?? 0) + (iv.end - iv.start));
        });
        if (t.projectId) placedByProject.set(t.projectId, [...(placedByProject.get(t.projectId) ?? []), ...ivs]);
        continue;
      }
    }

    // Fresh placement: lay the chunks down in order into a tentative busy copy;
    // commit only if every chunk lands (so a task never ends up half-scheduled).
    let tentativeBusy = busy;
    let tentativeTaskMsByDay = new Map(taskMsByDay); // seeded so a task's own earlier chunks count toward its later chunks' budget
    const placed: { index: number; slot: Interval; parts: ScorePart[]; overBudget: boolean }[] = [];
    let missedDeadline = false;
    let failed = false;
    let prevEnd: number | null = null;

    for (const chunk of chunks) {
      const rawFree = subtractIntervals(windows, tentativeBusy);
      const free = withinBudget(rawFree, tentativeTaskMsByDay);
      const durMs = chunk.durMin * 60_000;
      let notBefore: number | null = null;
      if (prevEnd != null) notBefore = input.chunkGapPolicy === 'spread' ? nextDayStartMs(prevEnd) : prevEnd + bufMs;

      let best = findBestSlot(free, durMs, granMs, notBefore, deadline, t, taskCtx);
      let overBudget = false;

      // The day's task-budget is full, but this task is genuinely urgent (a real,
      // pressured deadline) — better to overflow today's budget than to relax the
      // deadline and slip to a later, merely under-budget day.
      if (!best && deadline != null && input.dayBudget && pressure > 0.5) {
        best = findBestSlot(rawFree, durMs, granMs, notBefore, deadline, t, taskCtx);
        if (best) overBudget = true;
      }

      if (!best && deadline != null) {
        best = findBestSlot(free, durMs, granMs, notBefore, null, t, taskCtx);
        if (best) missedDeadline = true;
      }
      if (!best && notBefore != null) {
        // 'spread' couldn't find a later day — fall back to packing right after the previous chunk.
        best = findBestSlot(free, durMs, granMs, prevEnd! + bufMs, null, t, taskCtx);
        if (best && deadline != null && best.slot.end > deadline) missedDeadline = true;
      }
      if (!best) {
        failed = true;
        break;
      }
      placed.push({ index: chunk.index, slot: best.slot, parts: best.parts, overBudget });
      tentativeBusy = mergeIntervals([...tentativeBusy, { start: best.slot.start, end: best.slot.end + bufMs }]);
      const day = dayOf(best.slot.start);
      tentativeTaskMsByDay = new Map(tentativeTaskMsByDay).set(day, (tentativeTaskMsByDay.get(day) ?? 0) + durMs);
      prevEnd = best.slot.end;
    }

    if (failed) {
      result.unplaceable.push(t.id);
      placementRisks.push({ taskId: t.id, kind: 'unplaceable' });
      continue;
    }
    taskMsByDay = tentativeTaskMsByDay;

    const overdue = deadline != null && deadline < nowMs;
    if (missedDeadline || overdue) {
      result.atRisk.push(t.id);
      placementRisks.push({ taskId: t.id, kind: overdue ? 'past_deadline' : 'placed_after_deadline', deadlineUtc });
    }

    busy = tentativeBusy; // commit the whole task's occupation
    if (t.projectId) placedByProject.set(t.projectId, [...(placedByProject.get(t.projectId) ?? []), ...placed.map((p) => p.slot)]);
    for (const p of placed) {
      const reasons = partsToReasons(p.parts);
      if (plannedReason) reasons.push(plannedReason);
      if (objectiveReason) reasons.push(objectiveReason);
      if (durationReason) reasons.push(durationReason);
      if (missedDeadline) reasons.push(reason('deadline_missed'));
      else if (pressure > 0.5) reasons.push(reason('deadline_pressure'));
      if (p.overBudget) reasons.push(reason('over_budget'));
      if (count > 1) reasons.push(reason('chunk', `part ${p.index + 1} of ${count}`));
      result.blocks.push({
        key: `task:${t.id}:${p.index}`,
        taskId: t.id,
        startUtc: msToUtcIso(p.slot.start),
        endUtc: msToUtcIso(p.slot.end),
        reasons,
        ...(count > 1 ? { chunk: { index: p.index, count } } : {}),
      });
    }
  }

  result.risks = [...dedupePlacementRisks(placementRisks), ...forecastRisks];
  result.dayLoads = computeDayLoads(windows, busy, tz);
  return result;
}

/** One placement risk per task, most-severe kind winning, so the UI shows a single clear message. */
function dedupePlacementRisks(risks: TaskRisk[]): TaskRisk[] {
  const severity: Record<TaskRisk['kind'], number> = {
    unplaceable: 4,
    past_deadline: 3,
    placed_after_deadline: 2,
    capacity_shortfall: 1,
  };
  const byTask = new Map<string, TaskRisk>();
  for (const r of risks) {
    const cur = byTask.get(r.taskId);
    if (!cur || severity[r.kind] > severity[cur.kind]) byTask.set(r.taskId, r);
  }
  return [...byTask.values()];
}
