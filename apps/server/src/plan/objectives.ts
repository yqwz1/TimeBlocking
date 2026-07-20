import { DateTime } from 'luxon';
import { eq, inArray } from 'drizzle-orm';
import type { ObjectiveDTO } from '@timeblock/shared';
import { blocks, habitInstances, habits, objectives, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';

export interface ObjectiveProgress {
  progressMinutes: number;
  plannedMinutes: number;
  progressCount: number;
}

const ZERO: ObjectiveProgress = { progressMinutes: 0, plannedMinutes: 0, progressCount: 0 };

/** Single source of truth for objective row -> DTO, so every route reports the same totals. */
export function objectiveToDTO(db: DB, o: typeof objectives.$inferSelect, tz: string): ObjectiveDTO {
  const auto = computeObjectiveProgress(db, o, tz);
  return {
    id: o.id,
    weekStart: o.weekStart,
    title: o.title,
    targetMinutes: o.targetMinutes,
    targetCount: o.targetCount,
    linkKind: o.linkKind as ObjectiveDTO['linkKind'],
    linkValue: o.linkValue,
    notes: o.notes,
    status: o.status as ObjectiveDTO['status'],
    progressMinutes: auto.progressMinutes + o.manualMinutes,
    plannedMinutes: auto.plannedMinutes + o.manualMinutes,
    progressCount: auto.progressCount + o.manualCount,
    manualMinutes: o.manualMinutes,
    manualCount: o.manualCount,
  };
}

/** [weekStart 00:00, +7d) in the given timezone, as epoch ms. */
function weekRangeMs(weekStart: string, tz: string): { startMs: number; endMs: number } {
  const start = DateTime.fromISO(weekStart, { zone: tz }).startOf('day');
  return { startMs: start.toMillis(), endMs: start.plus({ days: 7 }).toMillis() };
}

export function computeObjectiveProgress(db: DB, o: typeof objectives.$inferSelect, tz: string): ObjectiveProgress {
  if (!o.linkKind || !o.linkValue) return ZERO;
  const { startMs, endMs } = weekRangeMs(o.weekStart, tz);

  if (o.linkKind === 'habit') {
    const h = db.select().from(habits).where(eq(habits.id, o.linkValue)).get();
    if (!h) return ZERO;
    const instances = db
      .select()
      .from(habitInstances)
      .where(eq(habitInstances.habitId, o.linkValue))
      .all()
      .filter((i) => {
        const ms = DateTime.fromISO(i.date, { zone: tz }).toMillis();
        return ms >= startMs && ms < endMs;
      });
    const done = instances.filter((i) => i.status === 'done').length;
    const planned = instances.filter((i) => i.status !== 'skipped').length;
    return { progressMinutes: done * h.durationMin, plannedMinutes: planned * h.durationMin, progressCount: done };
  }

  // project | label
  const relevant = db
    .select()
    .from(blocks)
    .where(inArray(blocks.status, ['scheduled', 'pending_create', 'done']))
    .all()
    .filter((b) => b.taskId && Date.parse(b.startUtc) >= startMs && Date.parse(b.startUtc) < endMs);

  let progressMinutes = 0;
  let plannedMinutes = 0;
  const doneTaskIds = new Set<string>();
  for (const b of relevant) {
    const t = db.select().from(tasks).where(eq(tasks.id, b.taskId!)).get();
    if (!t) continue;
    const matches = o.linkKind === 'project' ? t.projectId === o.linkValue : (JSON.parse(t.labels || '[]') as string[]).includes(o.linkValue);
    if (!matches) continue;
    const min = Math.round((Date.parse(b.endUtc) - Date.parse(b.startUtc)) / 60_000);
    plannedMinutes += min;
    if (b.status === 'done') {
      progressMinutes += min;
      doneTaskIds.add(t.id);
    }
  }
  return { progressMinutes, plannedMinutes, progressCount: doneTaskIds.size };
}
