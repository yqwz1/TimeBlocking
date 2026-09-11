import { DateTime } from 'luxon';
import type { ScheduleItemDTO } from '@timeblock/shared';
import { blocks, events, habitInstances, habits } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { blockToItem, eventToItem } from './mappers.js';
import { rruleMatchesDate } from '../scheduler/habits.js';

export const VISIBLE_SCHEDULE_STATUSES = new Set(['scheduled', 'pending_create', 'done', 'missed']);

/**
 * Habit blocks exist only when the planner can place them. These display-only
 * occurrences keep recurring habits visible without reserving calendar time.
 */
function addUnblockedHabitOccurrences(db: DB, items: ScheduleItemDTO[], from: string, to: string, timezone: string) {
  const fromUtc = DateTime.fromISO(from, { zone: 'utc' });
  const toUtc = DateTime.fromISO(to, { zone: 'utc' });
  if (!fromUtc.isValid || !toUtc.isValid || toUtc <= fromUtc) return;

  const existingHabitDates = new Set(
    items
      .filter((item) => item.kind === 'habit' && item.habitId)
      .map((item) => `${item.habitId}:${DateTime.fromISO(item.start, { zone: 'utc' }).setZone(timezone).toISODate()}`),
  );
  const instancesByHabitDate = new Map(
    db.select().from(habitInstances).all().map((instance) => [`${instance.habitId}:${instance.date}`, instance.status]),
  );
  const today = DateTime.now().setZone(timezone).toISODate()!;
  const firstDay = fromUtc.setZone(timezone).startOf('day');
  const lastDay = toUtc.setZone(timezone).minus({ milliseconds: 1 }).startOf('day');

  for (const habit of db.select().from(habits).all()) {
    if (!habit.active) continue;
    for (let day = firstDay; day <= lastDay; day = day.plus({ days: 1 })) {
      const date = day.toISODate()!;
      if (!rruleMatchesDate(habit.rrule, date, timezone)) continue;
      const key = `${habit.id}:${date}`;
      if (existingHabitDates.has(key)) continue;

      const start = DateTime.fromISO(`${date}T${habit.preferredStart ?? habit.windowStart}`, { zone: timezone });
      const end = start.plus({ minutes: habit.durationMin });
      if (!start.isValid || end <= fromUtc || start >= toUtc) continue;

      const instanceStatus = instancesByHabitDate.get(key);
      const status: NonNullable<ScheduleItemDTO['status']> =
        instanceStatus === 'done'
          ? 'done'
          : instanceStatus === 'missed' || (habit.kind !== 'negative' && date < today && instanceStatus !== 'skipped')
            ? 'missed'
            : instanceStatus === 'skipped'
              ? 'cancelled'
              : instanceStatus === 'lapsed'
                ? 'lapsed'
                : 'scheduled';

      items.push({
        id: `habit:${habit.id}:${date}`,
        kind: 'habit',
        title: habit.name,
        start: start.toUTC().toISO()!,
        end: end.toUTC().toISO()!,
        status,
        habitId: habit.id,
        habitDate: date,
        habitKind: habit.kind as NonNullable<ScheduleItemDTO['habitKind']>,
        isHabitOccurrence: true,
        editable: false,
      });
    }
  }
}

/** The canonical local schedule interpretation shared by the API and email builders. */
export function readLocalSchedule(db: DB, from: string, to: string, timezone: string): ScheduleItemDTO[] {
  const rows = db
    .select()
    .from(blocks)
    .all()
    .filter((block) => VISIBLE_SCHEDULE_STATUSES.has(block.status) && block.startUtc < to && block.endUtc > from);
  const items = rows.map((block) => blockToItem(db, block));
  addUnblockedHabitOccurrences(db, items, from, to, timezone);

  for (const event of db.select().from(events).all()) {
    if (event.startUtc < to && event.endUtc > from) items.push(eventToItem(event));
  }
  return items.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}
