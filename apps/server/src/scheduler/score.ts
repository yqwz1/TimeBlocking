import { DateTime } from 'luxon';
import type { PlanTaskInput } from './types.js';

const DAY_MS = 86_400_000;

/** Tunable in one place. */
export const WEIGHTS = { urgency: 5, priority: 2, age: 1, objective: 3 };

/**
 * The deadline the planner treats as binding: the real due date/time if set,
 * softened further by "picked for <date>" in the Plan Day ritual — but only
 * when the pick is earlier than any real due date, so picking an already-due
 * task for today never pushes its deadline later.
 */
export function effectiveDeadlineMs(t: PlanTaskInput, tz: string): number | null {
  const real = t.dueDatetimeUtc
    ? Date.parse(t.dueDatetimeUtc)
    : t.dueDate
      ? DateTime.fromISO(t.dueDate, { zone: tz }).endOf('day').toMillis()
      : null;
  if (!t.plannedForDate) return real;
  const planned = DateTime.fromISO(t.plannedForDate, { zone: tz }).endOf('day').toMillis();
  return real == null ? planned : Math.min(real, planned);
}

export function scoreTask(t: PlanTaskInput, nowMs: number, tz: string): number {
  const deadline = effectiveDeadlineMs(t, tz);
  let urgency: number;
  if (deadline == null) urgency = 0.15;
  else if (deadline < nowMs) urgency = 3;
  else urgency = 1 / (1 + (deadline - nowMs) / DAY_MS);
  const ageDays = t.createdAtUtc
    ? Math.min(Math.max(0, (nowMs - Date.parse(t.createdAtUtc)) / DAY_MS), 14)
    : 0;
  return (
    WEIGHTS.urgency * urgency +
    WEIGHTS.priority * (t.priority - 1) +
    WEIGHTS.age * (ageDays / 14) +
    WEIGHTS.objective * (t.objectiveBoost ?? 0)
  );
}
