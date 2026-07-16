import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { effectiveDeadlineMs } from './score.js';
import type { PlanTaskInput } from './types.js';

const TZ = 'America/New_York';

function task(over: Partial<PlanTaskInput> = {}): PlanTaskInput {
  return {
    id: 't',
    priority: 1,
    dueDate: null,
    dueDatetimeUtc: null,
    plannedForDate: null,
    durationMin: 30,
    createdAtUtc: null,
    labels: [],
    projectId: null,
    currentChunks: [],
    ...over,
  };
}

const endOfDay = (d: string) => DateTime.fromISO(d, { zone: TZ }).endOf('day').toMillis();

describe('effectiveDeadlineMs', () => {
  it('is null with no due date and no pick', () => {
    expect(effectiveDeadlineMs(task(), TZ)).toBeNull();
  });

  it('uses the real due date when there is no pick', () => {
    expect(effectiveDeadlineMs(task({ dueDate: '2026-07-10' }), TZ)).toBe(endOfDay('2026-07-10'));
  });

  it('uses dueDatetimeUtc verbatim when set', () => {
    expect(effectiveDeadlineMs(task({ dueDatetimeUtc: '2026-07-10T15:30:00Z' }), TZ)).toBe(Date.parse('2026-07-10T15:30:00Z'));
  });

  it('uses the planned pick as a soft deadline when there is no real due date', () => {
    expect(effectiveDeadlineMs(task({ plannedForDate: '2026-07-06' }), TZ)).toBe(endOfDay('2026-07-06'));
  });

  it('picks the earlier of a real due date and a planned pick', () => {
    // Due next week, but picked for today — today should win (it's earlier).
    expect(effectiveDeadlineMs(task({ dueDate: '2026-07-13', plannedForDate: '2026-07-06' }), TZ)).toBe(endOfDay('2026-07-06'));
  });

  it('never lets a pick push an already-earlier real deadline later', () => {
    // Due today, picked for next week — the real, earlier deadline must still win.
    expect(effectiveDeadlineMs(task({ dueDate: '2026-07-06', plannedForDate: '2026-07-13' }), TZ)).toBe(endOfDay('2026-07-06'));
  });
});
