import { DateTime } from 'luxon';
import { inArray } from 'drizzle-orm';
import type { DailySummary } from '@timeblock/shared';
import { blocks } from '../db/schema.js';
import type { DB } from '../db/client.js';

const COUNTED_STATUSES: string[] = ['scheduled', 'pending_create', 'done', 'missed'];

/** Live block outcomes for one local day — the numbers shown in the shutdown flow. */
export function buildDailySummary(db: DB, tz: string, date: string): DailySummary {
  const dayStart = DateTime.fromISO(date, { zone: tz }).startOf('day');
  const startMs = dayStart.toMillis();
  const endMs = dayStart.plus({ days: 1 }).toMillis();

  const rows = db
    .select()
    .from(blocks)
    .where(inArray(blocks.status, COUNTED_STATUSES))
    .all()
    .filter((b) => {
      const s = Date.parse(b.startUtc);
      return s >= startMs && s < endMs;
    });

  const minutes = (b: (typeof rows)[number]) => Math.max(0, Math.round((Date.parse(b.endUtc) - Date.parse(b.startUtc)) / 60_000));

  let doneCount = 0;
  let missedCount = 0;
  let remainingCount = 0;
  let completedMin = 0;
  let plannedMin = 0;
  for (const b of rows) {
    plannedMin += minutes(b);
    if (b.status === 'done') {
      doneCount++;
      completedMin += minutes(b);
    } else if (b.status === 'missed') {
      missedCount++;
    } else {
      remainingCount++;
    }
  }

  return { doneCount, missedCount, remainingCount, plannedCount: rows.length, completedMin, plannedMin };
}
