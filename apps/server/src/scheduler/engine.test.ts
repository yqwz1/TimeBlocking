import { describe, expect, it } from 'vitest';
import { EMPTY_ENERGY_WINDOWS, type WorkingHours } from '@timeblock/shared';
import { plan } from './engine.js';
import type { PlanHabitInput, PlanInput, PlanTaskInput } from './types.js';

const ENERGY_OFF = { mode: 'off' as const, windows: EMPTY_ENERGY_WINDOWS, deepWorkMinMin: 60, deepLabel: 'deep', shallowLabel: 'shallow' };
const LEARNED_OFF = { enabled: false, multipliers: { global: { value: 1, weight: 0 }, byProject: {} }, hourSuccess: { rates: Array(24).fill(0.5), totalWeight: 0 } };

// America/New_York: July = EDT (UTC-4), January = EST (UTC-5).
const TZ = 'America/New_York';

const ALL_DAYS_9_17: WorkingHours = {
  mon: [{ start: '09:00', end: '17:00' }],
  tue: [{ start: '09:00', end: '17:00' }],
  wed: [{ start: '09:00', end: '17:00' }],
  thu: [{ start: '09:00', end: '17:00' }],
  fri: [{ start: '09:00', end: '17:00' }],
  sat: [{ start: '09:00', end: '17:00' }],
  sun: [{ start: '09:00', end: '17:00' }],
};

const WEEKDAYS_ONLY: WorkingHours = { ...ALL_DAYS_9_17, sat: [], sun: [] };

function task(id: string, over: Partial<PlanTaskInput> = {}): PlanTaskInput {
  return {
    id,
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

function habit(id: string, over: Partial<PlanHabitInput> = {}): PlanHabitInput {
  return {
    id,
    name: id,
    durationMin: 60,
    rrule: 'FREQ=DAILY',
    preferredStart: null,
    windowStart: '06:00',
    windowEnd: '22:00',
    priority: 2,
    kind: 'habit',
    weeklyTargetMin: null,
    excludedDates: [],
    creditMin: {},
    ...over,
  };
}

// Monday 2026-07-06, 08:00 EDT (before working hours).
function baseInput(over: Partial<PlanInput> = {}): PlanInput {
  return {
    nowUtc: '2026-07-06T12:00:00Z',
    timezone: TZ,
    horizonDays: 14,
    granularityMin: 15,
    bufferMin: 10,
    splitEnabled: false,
    maxChunkMin: 90,
    minChunkMin: 30,
    chunkGapPolicy: 'same_day',
    energy: ENERGY_OFF,
    learned: LEARNED_OFF,
    workingHours: WEEKDAYS_ONLY,
    busy: [],
    tasks: [],
    habits: [],
    sticky: true,
    dayBudget: null,
    ...over,
  };
}

const blockFor = (r: ReturnType<typeof plan>, key: string) => r.blocks.find((b) => b.key === key);

describe('task packing', () => {
  it('orders by score (urgency > priority > age) and packs with buffers on the grid', () => {
    const r = plan(
      baseInput({
        tasks: [
          task('noDue', { priority: 1, durationMin: 30 }),
          task('dueToday', { priority: 4, dueDate: '2026-07-06', durationMin: 45 }),
          task('nextWeek', { priority: 2, dueDate: '2026-07-13', durationMin: 60 }),
        ],
      }),
    );
    // 09:00 EDT = 13:00Z
    expect(blockFor(r, 'task:dueToday:0')).toMatchObject({
      startUtc: '2026-07-06T13:00:00Z',
      endUtc: '2026-07-06T13:45:00Z',
    });
    // 13:45 + 10min buffer -> 13:55 -> ceil to 15-min grid -> 14:00
    expect(blockFor(r, 'task:nextWeek:0')).toMatchObject({
      startUtc: '2026-07-06T14:00:00Z',
      endUtc: '2026-07-06T15:00:00Z',
    });
    expect(blockFor(r, 'task:noDue:0')).toMatchObject({ startUtc: '2026-07-06T15:15:00Z' });
    expect(r.atRisk).toEqual([]);
    expect(r.unplaceable).toEqual([]);
  });

  it('places a plannedForDate ("picked for today") task ahead of an undated task via its same-day soft deadline', () => {
    const r = plan(
      baseInput({
        tasks: [
          task('backlog', { priority: 4, durationMin: 30 }), // no deadline at all, despite high priority
          task('pickedToday', { plannedForDate: '2026-07-06', durationMin: 30 }),
        ],
      }),
    );
    // 09:00 EDT = 13:00Z — the picked task lands first because it has a deadline
    // (end of today) and deadlined work is placed ahead of undated backlog.
    expect(blockFor(r, 'task:pickedToday:0')).toMatchObject({ startUtc: '2026-07-06T13:00:00Z' });
    expect(blockFor(r, 'task:pickedToday:0')!.reasons.some((x) => x.code === 'picked_today')).toBe(true);
    expect(blockFor(r, 'task:backlog:0')!.startUtc.localeCompare('2026-07-06T13:00:00Z')).toBeGreaterThan(0);
  });

  it('never overlaps existing busy events', () => {
    const r = plan(
      baseInput({
        busy: [{ startUtc: '2026-07-06T13:00:00Z', endUtc: '2026-07-06T14:00:00Z' }],
        tasks: [task('a', { durationMin: 30 })],
      }),
    );
    expect(blockFor(r, 'task:a:0')!.startUtc).toBe('2026-07-06T14:00:00Z');
  });

  it('flags at-risk when nothing fits before the deadline, but still places the task', () => {
    const r = plan(
      baseInput({
        busy: [{ startUtc: '2026-07-06T13:00:00Z', endUtc: '2026-07-06T16:00:00Z' }],
        tasks: [task('tight', { dueDatetimeUtc: '2026-07-06T15:00:00Z', durationMin: 30 })],
      }),
    );
    expect(r.atRisk).toContain('tight');
    expect(blockFor(r, 'task:tight:0')!.startUtc).toBe('2026-07-06T16:00:00Z');
  });

  it('flags overdue tasks as at-risk and schedules them first', () => {
    const r = plan(
      baseInput({
        tasks: [task('fresh', { priority: 4 }), task('overdue', { priority: 1, dueDate: '2026-07-01' })],
      }),
    );
    expect(r.atRisk).toContain('overdue');
    expect(blockFor(r, 'task:overdue:0')!.startUtc).toBe('2026-07-06T13:00:00Z');
  });

  it('reports unplaceable when the horizon is full', () => {
    const r = plan(
      baseInput({
        horizonDays: 0,
        busy: [{ startUtc: '2026-07-06T13:00:00Z', endUtc: '2026-07-06T21:00:00Z' }],
        tasks: [task('nofit')],
      }),
    );
    expect(r.unplaceable).toEqual(['nofit']);
    expect(r.blocks).toHaveLength(0);
  });

  it('starts on the next working day when today has no working hours', () => {
    // Saturday 2026-07-04, weekdays-only hours -> Monday 09:00 EDT.
    const r = plan(
      baseInput({ nowUtc: '2026-07-04T12:00:00Z', tasks: [task('a')] }),
    );
    expect(blockFor(r, 'task:a:0')!.startUtc).toBe('2026-07-06T13:00:00Z');
  });
});

describe('day-fullness budget', () => {
  it('caps a day at the budget fraction and spills the rest to the next day', () => {
    const r = plan(
      baseInput({
        dayBudget: { maxTaskFraction: 0.5 }, // light: 50% of the 8h working window = 4h
        tasks: [task('a', { durationMin: 120 }), task('b', { durationMin: 120 }), task('c', { durationMin: 120 })],
      }),
    );
    expect(blockFor(r, 'task:a:0')!.startUtc.startsWith('2026-07-06')).toBe(true);
    expect(blockFor(r, 'task:b:0')!.startUtc.startsWith('2026-07-06')).toBe(true);
    expect(blockFor(r, 'task:c:0')!.startUtc.startsWith('2026-07-06')).toBe(false); // spilled past today's task-budget

    const day1Min = ['a', 'b']
      .map((id) => blockFor(r, `task:${id}:0`)!)
      .reduce((s, b) => s + (Date.parse(b.endUtc) - Date.parse(b.startUtc)) / 60_000, 0);
    expect(day1Min).toBeLessThanOrEqual(240);
  });

  it('overflows the budget for a task with a genuine same-day deadline, tagging it over_budget', () => {
    const r = plan(
      baseInput({
        dayBudget: { maxTaskFraction: 0.5 },
        tasks: [
          task('fillerA', { priority: 4, dueDate: '2026-07-06', durationMin: 120 }),
          task('fillerB', { priority: 4, dueDate: '2026-07-06', durationMin: 120 }),
          task('urgent', { priority: 1, dueDate: '2026-07-06', durationMin: 60 }),
        ],
      }),
    );
    // The two higher-priority fillers (same deadline) fill today's 4h budget first...
    expect(blockFor(r, 'task:fillerA:0')!.startUtc.startsWith('2026-07-06')).toBe(true);
    expect(blockFor(r, 'task:fillerB:0')!.startUtc.startsWith('2026-07-06')).toBe(true);
    // ...but 'urgent' is due today too, so it still lands today — over budget — instead of slipping to tomorrow.
    const urgent = blockFor(r, 'task:urgent:0')!;
    expect(urgent.startUtc.startsWith('2026-07-06')).toBe(true);
    expect(urgent.reasons.some((x) => x.code === 'over_budget')).toBe(true);
    expect(r.atRisk).not.toContain('urgent'); // it still hit its deadline — it just went over the day's fullness budget
  });

  it('does not apply the day budget to habits', () => {
    const r = plan(
      baseInput({
        dayBudget: { maxTaskFraction: 0.5 },
        tasks: [task('a', { durationMin: 120 }), task('b', { durationMin: 120 })], // exhausts today's 4h task budget
        habits: [habit('morning', { durationMin: 60, windowStart: '06:00', windowEnd: '22:00' })],
      }),
    );
    expect(blockFor(r, 'task:a:0')!.startUtc.startsWith('2026-07-06')).toBe(true);
    expect(blockFor(r, 'task:b:0')!.startUtc.startsWith('2026-07-06')).toBe(true);
    expect(blockFor(r, 'habit:morning:2026-07-06')).toBeDefined();
  });
});

describe('stickiness', () => {
  const cur = { startUtc: '2026-07-06T18:00:00Z', endUtc: '2026-07-06T18:30:00Z' }; // 14:00 EDT
  const currentChunks = [{ chunkIndex: 0, ...cur }];

  it('keeps a still-valid placement instead of reshuffling', () => {
    const r = plan(baseInput({ tasks: [task('keep', { currentChunks })] }));
    expect(blockFor(r, 'task:keep:0')).toMatchObject(cur);
  });

  it('moves the block when a new meeting lands on it', () => {
    const r = plan(
      baseInput({
        busy: [{ startUtc: '2026-07-06T18:00:00Z', endUtc: '2026-07-06T19:00:00Z' }],
        tasks: [task('bumped', { currentChunks })],
      }),
    );
    expect(blockFor(r, 'task:bumped:0')!.startUtc).toBe('2026-07-06T13:00:00Z');
  });

  it('recalculate (sticky=false) repacks from now', () => {
    const r = plan(baseInput({ sticky: false, tasks: [task('repack', { currentChunks })] }));
    expect(blockFor(r, 'task:repack:0')!.startUtc).toBe('2026-07-06T13:00:00Z');
  });

  it('drops a kept placement that now violates the deadline', () => {
    const r = plan(
      baseInput({
        tasks: [task('late', { currentChunks, dueDatetimeUtc: '2026-07-06T15:00:00Z' })],
      }),
    );
    expect(blockFor(r, 'task:late:0')!.startUtc).toBe('2026-07-06T13:00:00Z');
  });
});

describe('habits', () => {
  it('anchors habits before tasks; tasks pack around them', () => {
    const r = plan(
      baseInput({
        habits: [habit('gym', { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', preferredStart: '07:30' })],
        tasks: [task('work', { priority: 4 })],
      }),
    );
    // Today (Mon): 07:30 EDT is already past (now = 08:00) -> earliest slot in window = 08:00 EDT.
    expect(blockFor(r, 'habit:gym:2026-07-06')).toMatchObject({ startUtc: '2026-07-06T12:00:00Z' });
    // Wednesday gets the preferred start: 07:30 EDT = 11:30Z.
    expect(blockFor(r, 'habit:gym:2026-07-08')).toMatchObject({ startUtc: '2026-07-08T11:30:00Z' });
    // Friday too.
    expect(blockFor(r, 'habit:gym:2026-07-10')).toBeDefined();
    // No Tuesday instance.
    expect(blockFor(r, 'habit:gym:2026-07-07')).toBeUndefined();
    // Task avoids the habit (ends 13:00Z + 10 buffer -> 13:15Z).
    expect(blockFor(r, 'task:work:0')!.startUtc).toBe('2026-07-06T13:15:00Z');
  });

  it('skipped dates get no instance and free the slot', () => {
    const r = plan(
      baseInput({
        habits: [
          habit('gym', {
            rrule: 'FREQ=WEEKLY;BYDAY=MO',
            preferredStart: '10:00',
            excludedDates: ['2026-07-06'],
          }),
        ],
        tasks: [task('work')],
      }),
    );
    expect(blockFor(r, 'habit:gym:2026-07-06')).toBeUndefined();
    expect(blockFor(r, 'task:work:0')!.startUtc).toBe('2026-07-06T13:00:00Z');
  });

  it('learning habits top up the week to the target minutes', () => {
    const r = plan(
      baseInput({
        horizonDays: 6, // Mon..Sun
        habits: [
          habit('spanish', {
            kind: 'learning',
            durationMin: 30,
            rrule: 'FREQ=WEEKLY;BYDAY=MO',
            weeklyTargetMin: 150,
          }),
        ],
      }),
    );
    const instances = r.blocks.filter((b) => b.habitId === 'spanish');
    expect(instances).toHaveLength(5); // 150 / 30
    const dates = new Set(instances.map((b) => b.date));
    expect(dates.size).toBe(5); // one per day, not stacked
  });

  it('credits already-done minutes against the weekly target', () => {
    const r = plan(
      baseInput({
        horizonDays: 6,
        habits: [
          habit('spanish', {
            kind: 'learning',
            durationMin: 30,
            rrule: 'FREQ=WEEKLY;BYDAY=MO',
            weeklyTargetMin: 150,
            excludedDates: ['2026-07-06'], // Monday already done
            creditMin: { '2026-07-06': 60 },
          }),
        ],
      }),
    );
    const instances = r.blocks.filter((b) => b.habitId === 'spanish');
    expect(instances).toHaveLength(3); // 150 - 60 credit = 90 -> 3 sessions
  });
});

describe('reasons + determinism', () => {
  it('emits a reason on every placed block', () => {
    const r = plan(
      baseInput({
        habits: [habit('gym', { preferredStart: '10:00' })],
        tasks: [task('a', { dueDate: '2026-07-06' }), task('b')],
      }),
    );
    expect(r.blocks.length).toBeGreaterThan(0);
    for (const b of r.blocks) expect(b.reasons.length).toBeGreaterThan(0);
  });

  it('tags a kept placement as sticky and a fresh one as earliest_fit', () => {
    const currentChunks = [{ chunkIndex: 0, startUtc: '2026-07-06T18:00:00Z', endUtc: '2026-07-06T18:30:00Z' }];
    const r = plan(baseInput({ tasks: [task('keep', { currentChunks }), task('fresh')] }));
    expect(blockFor(r, 'task:keep:0')!.reasons.map((x) => x.code)).toContain('sticky');
    expect(blockFor(r, 'task:fresh:0')!.reasons.map((x) => x.code)).toContain('earliest_fit');
  });

  it('flags deadline_missed when placed past the deadline', () => {
    const r = plan(
      baseInput({
        busy: [{ startUtc: '2026-07-06T13:00:00Z', endUtc: '2026-07-06T16:00:00Z' }],
        tasks: [task('tight', { dueDatetimeUtc: '2026-07-06T15:00:00Z', durationMin: 30 })],
      }),
    );
    expect(blockFor(r, 'task:tight:0')!.reasons.map((x) => x.code)).toContain('deadline_missed');
  });

  it('is deterministic: identical input yields deep-equal output', () => {
    const build = () =>
      baseInput({
        habits: [habit('gym', { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', preferredStart: '07:30' })],
        tasks: [task('a', { priority: 4, dueDate: '2026-07-08' }), task('b'), task('c', { dueDate: '2026-07-10' })],
      });
    expect(plan(build())).toEqual(plan(build()));
  });
});

describe('DST transitions', () => {
  it('keeps local working hours across spring-forward (2026-03-08)', () => {
    // Saturday 2026-03-07, 08:00 EST. Two 8h tasks fill Sat and Sun 09:00-17:00.
    const r = plan(
      baseInput({
        nowUtc: '2026-03-07T13:00:00Z',
        workingHours: ALL_DAYS_9_17,
        bufferMin: 0,
        tasks: [
          task('sat', { durationMin: 480, priority: 4 }),
          task('sun', { durationMin: 480, priority: 1 }),
        ],
        sticky: false,
      }),
    );
    // Sat 09:00 EST = 14:00Z
    expect(blockFor(r, 'task:sat:0')).toMatchObject({ startUtc: '2026-03-07T14:00:00Z' });
    // Sun 09:00 EDT = 13:00Z (offset changed overnight)
    expect(blockFor(r, 'task:sun:0')).toMatchObject({ startUtc: '2026-03-08T13:00:00Z' });
  });

  it('keeps local working hours across fall-back (2026-11-01)', () => {
    const r = plan(
      baseInput({
        nowUtc: '2026-10-31T12:00:00Z', // Sat 08:00 EDT
        workingHours: ALL_DAYS_9_17,
        bufferMin: 0,
        tasks: [
          task('sat', { durationMin: 480, priority: 4 }),
          task('sun', { durationMin: 480, priority: 1 }),
        ],
        sticky: false,
      }),
    );
    expect(blockFor(r, 'task:sat:0')).toMatchObject({ startUtc: '2026-10-31T13:00:00Z' }); // EDT
    expect(blockFor(r, 'task:sun:0')).toMatchObject({ startUtc: '2026-11-01T14:00:00Z' }); // EST
  });
});
