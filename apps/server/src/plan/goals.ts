import { DateTime } from 'luxon';
import { eq, inArray } from 'drizzle-orm';
import { blocks, goals, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';

export interface GoalProgress {
  progressMinutes: number;
  plannedMinutes: number;
  progressCount: number;
  deadline: string;
  daysRemaining: number;
  periodElapsedPct: number;
}

/** Quarter-start through the resolved deadline (customDeadline end-of-day, else quarter end), in the given timezone. */
function goalWindow(g: typeof goals.$inferSelect, tz: string): { startMs: number; endMs: number; deadline: string } {
  const start = DateTime.fromObject({ year: g.year, month: (g.quarter - 1) * 3 + 1, day: 1 }, { zone: tz }).startOf('day');
  const end = g.customDeadline ? DateTime.fromISO(g.customDeadline, { zone: tz }).endOf('day') : start.plus({ months: 3 });
  // `end` is an exclusive upper bound for the quarter case (00:00 of next quarter) — the
  // human-facing deadline is the day before; customDeadline's end-of-day already reads correctly.
  const deadline = g.customDeadline ? end.toISODate()! : end.minus({ days: 1 }).toISODate()!;
  return { startMs: start.toMillis(), endMs: end.toMillis(), deadline };
}

export function computeGoalProgress(db: DB, g: typeof goals.$inferSelect, tz: string): GoalProgress {
  const { startMs, endMs, deadline } = goalWindow(g, tz);
  const now = DateTime.now().setZone(tz);
  const daysRemaining = Math.max(0, Math.ceil(DateTime.fromMillis(endMs, { zone: tz }).diff(now, 'days').days));
  const periodElapsedPct = Math.min(100, Math.max(0, Math.round(((now.toMillis() - startMs) / (endMs - startMs)) * 100)));

  if (!g.linkKind || !g.linkValue) {
    return { progressMinutes: 0, plannedMinutes: 0, progressCount: 0, deadline, daysRemaining, periodElapsedPct };
  }
  const linkKind = g.linkKind;
  const linkValue = g.linkValue;

  // Minutes: blocks in the window, matched via their task's project/label link.
  // Load matched blocks' tasks once (a quarter window is ~13x a week — no per-block queries).
  const relevantBlocks = db
    .select()
    .from(blocks)
    .where(inArray(blocks.status, ['scheduled', 'pending_create', 'done']))
    .all()
    .filter((b) => b.taskId && Date.parse(b.startUtc) >= startMs && Date.parse(b.startUtc) < endMs);

  const taskIds = [...new Set(relevantBlocks.map((b) => b.taskId!))];
  const taskMap = new Map(
    (taskIds.length ? db.select().from(tasks).where(inArray(tasks.id, taskIds)).all() : []).map((t) => [t.id, t]),
  );

  let progressMinutes = 0;
  let plannedMinutes = 0;
  for (const b of relevantBlocks) {
    const t = taskMap.get(b.taskId!);
    if (!t) continue;
    const matches = linkKind === 'project' ? t.projectId === linkValue : (JSON.parse(t.labels || '[]') as string[]).includes(linkValue);
    if (!matches) continue;
    const min = Math.round((Date.parse(b.endUtc) - Date.parse(b.startUtc)) / 60_000);
    plannedMinutes += min;
    if (b.status === 'done') progressMinutes += min;
  }

  // Count: distinct tasks completed in the window, by completedAtUtc — not via blocks, which
  // undercount over a quarter (many tasks complete without a surviving scheduled block).
  const completedTasks = db
    .select()
    .from(tasks)
    .where(eq(tasks.status, 'done'))
    .all()
    .filter((t) => {
      if (!t.completedAtUtc) return false;
      const ms = Date.parse(t.completedAtUtc);
      if (ms < startMs || ms >= endMs) return false;
      return linkKind === 'project' ? t.projectId === linkValue : (JSON.parse(t.labels || '[]') as string[]).includes(linkValue);
    });

  return { progressMinutes, plannedMinutes, progressCount: completedTasks.length, deadline, daysRemaining, periodElapsedPct };
}
