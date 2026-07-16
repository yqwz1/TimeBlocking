import { eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Settings } from '@timeblock/shared';
import { analyticsDaily, blocks, habitInstances, habits, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';

interface Bucket {
  planned: number;
  done: number;
}

/** Recompute the analytics_daily row for one local date from current block state. */
export function rollupDay(
  db: DB,
  settings: Settings,
  dateLocal: string,
  externalBusy: { startUtc: string; endUtc: string }[],
): void {
  const tz = settings.timezone;
  const dayStart = DateTime.fromISO(dateLocal, { zone: tz }).startOf('day');
  const startMs = dayStart.toMillis();
  const endMs = dayStart.plus({ days: 1 }).toMillis();

  const rows = db
    .select()
    .from(blocks)
    .where(inArray(blocks.status, ['scheduled', 'pending_create', 'done', 'missed']))
    .all()
    .filter((b) => {
      const s = Date.parse(b.startUtc);
      return s >= startMs && s < endMs;
    });

  let plannedMin = 0;
  let completedMin = 0;
  let missedMin = 0;
  const byProject: Record<string, Bucket> = {};
  const byLabel: Record<string, Bucket> = {};
  const byHabit: Record<string, Bucket> = {};

  const bump = (map: Record<string, Bucket>, key: string, min: number, done: boolean) => {
    if (!map[key]) map[key] = { planned: 0, done: 0 };
    map[key].planned += min;
    if (done) map[key].done += min;
  };

  for (const b of rows) {
    const min = Math.round((Date.parse(b.endUtc) - Date.parse(b.startUtc)) / 60_000);
    plannedMin += min;
    const done = b.status === 'done';
    if (done) completedMin += min;
    if (b.status === 'missed') missedMin += min;

    if (b.taskId) {
      const t = db.select().from(tasks).where(eq(tasks.id, b.taskId)).get();
      if (t) {
        bump(byProject, t.projectName ?? 'No project', min, done);
        const labels: string[] = JSON.parse(t.labels || '[]');
        for (const l of labels) bump(byLabel, l, min, done);
      }
    } else if (b.habitInstanceId) {
      const inst = db.select().from(habitInstances).where(eq(habitInstances.id, b.habitInstanceId)).get();
      const h = inst ? db.select().from(habits).where(eq(habits.id, inst.habitId)).get() : null;
      if (h) bump(byHabit, h.name, min, inst?.status === 'done');
    }
  }

  const externalBusyMin = Math.round(
    externalBusy.reduce((sum, ev) => {
      const s = Math.max(Date.parse(ev.startUtc), startMs);
      const e = Math.min(Date.parse(ev.endUtc), endMs);
      return sum + Math.max(0, e - s) / 60_000;
    }, 0),
  );

  const values = {
    plannedMin,
    completedMin,
    missedMin,
    externalBusyMin,
    byProject: JSON.stringify(byProject),
    byLabel: JSON.stringify(byLabel),
    byHabit: JSON.stringify(byHabit),
  };

  db.insert(analyticsDaily)
    .values({ date: dateLocal, ...values })
    .onConflictDoUpdate({ target: analyticsDaily.date, set: values })
    .run();
}
