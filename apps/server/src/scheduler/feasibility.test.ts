import { describe, expect, it } from 'vitest';
import { EMPTY_ENERGY_WINDOWS, type WorkingHours } from '@timeblock/shared';
import { plan } from './engine.js';
import type { PlanInput, PlanTaskInput } from './types.js';

const ENERGY_OFF = { mode: 'off' as const, windows: EMPTY_ENERGY_WINDOWS, deepWorkMinMin: 60, deepLabel: 'deep', shallowLabel: 'shallow' };
const LEARNED_OFF = { enabled: false, multipliers: { global: { value: 1, weight: 0 }, byProject: {} }, hourSuccess: { rates: Array(24).fill(0.5), totalWeight: 0 } };

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

function task(id: string, over: Partial<PlanTaskInput> = {}): PlanTaskInput {
  return { id, priority: 1, dueDate: null, dueDatetimeUtc: null, plannedForDate: null, durationMin: 30, createdAtUtc: null, labels: [], projectId: null, currentChunks: [], ...over };
}

function baseInput(over: Partial<PlanInput> = {}): PlanInput {
  return {
    nowUtc: '2026-07-06T12:00:00Z', // Mon 08:00 EDT
    timezone: TZ,
    horizonDays: 14,
    granularityMin: 15,
    bufferMin: 0,
    splitEnabled: false,
    maxChunkMin: 90,
    minChunkMin: 30,
    chunkGapPolicy: 'same_day',
    energy: ENERGY_OFF,
    learned: LEARNED_OFF,
    workingHours: ALL_DAYS_9_17,
    busy: [],
    tasks: [],
    habits: [],
    sticky: false,
    dayBudget: null,
    ...over,
  };
}

const blockFor = (r: ReturnType<typeof plan>, key: string) => r.blocks.find((b) => b.key === key);

describe('EDF ordering', () => {
  it('places a tight-deadline task before a high-priority long task that would starve it', () => {
    // Today only. A p4 6h task (no deadline pressure vs a task due today at 12:00 EDT).
    // Greedy-by-score would place the p4 long task first (score high) and push the
    // deadlined task past its deadline. EDF places the deadlined one first.
    const r = plan(
      baseInput({
        horizonDays: 0,
        tasks: [
          task('longP4', { priority: 4, durationMin: 360 }), // 6h, no due date
          task('dueNoon', { priority: 1, durationMin: 120, dueDatetimeUtc: '2026-07-06T16:00:00Z' }), // due 12:00 EDT
        ],
      }),
    );
    // Deadlined task gets the earliest slot (09:00 EDT = 13:00Z) and finishes before its deadline.
    expect(blockFor(r, 'task:dueNoon:0')!.startUtc).toBe('2026-07-06T13:00:00Z');
    expect(Date.parse(blockFor(r, 'task:dueNoon:0')!.endUtc)).toBeLessThanOrEqual(Date.parse('2026-07-06T16:00:00Z'));
    expect(r.atRisk).not.toContain('dueNoon');
  });
});

describe('capacity forecast', () => {
  it('flags a capacity shortfall when deadlined demand exceeds supply before the deadline', () => {
    // One 8h working day (09:00-17:00). Two 6h tasks both due end of that day = 12h demand > 8h supply.
    const r = plan(
      baseInput({
        horizonDays: 0,
        tasks: [
          task('a', { durationMin: 360, priority: 2, dueDate: '2026-07-06' }),
          task('b', { durationMin: 360, priority: 1, dueDate: '2026-07-06' }),
        ],
      }),
    );
    const shortfalls = r.risks.filter((x) => x.kind === 'capacity_shortfall');
    expect(shortfalls.length).toBeGreaterThan(0);
    // Lowest-score task (b, priority 1) is flagged, not the higher-priority a.
    expect(shortfalls.map((x) => x.taskId)).toContain('b');
  });

  it('reports no shortfall when demand fits', () => {
    const r = plan(
      baseInput({ horizonDays: 0, tasks: [task('a', { durationMin: 120, dueDate: '2026-07-06' })] }),
    );
    expect(r.risks.filter((x) => x.kind === 'capacity_shortfall')).toEqual([]);
  });
});

describe('deadline pressure reason', () => {
  it('marks a tight task with a deadline_pressure reason', () => {
    const r = plan(
      baseInput({ tasks: [task('soon', { durationMin: 60, dueDatetimeUtc: '2026-07-06T18:00:00Z' })] }),
    );
    expect(blockFor(r, 'task:soon:0')!.reasons.map((x) => x.code)).toContain('deadline_pressure');
  });

  it('does not mark a far-off task with deadline_pressure', () => {
    const r = plan(
      baseInput({ tasks: [task('later', { durationMin: 60, dueDate: '2026-07-20' })] }),
    );
    expect(blockFor(r, 'task:later:0')!.reasons.map((x) => x.code)).not.toContain('deadline_pressure');
  });
});

describe('day loads', () => {
  it('reports committed vs capacity per working day', () => {
    const r = plan(
      baseInput({ horizonDays: 0, tasks: [task('a', { durationMin: 120, dueDate: '2026-07-06' })] }),
    );
    const load = r.dayLoads.find((d) => d.date === '2026-07-06');
    expect(load).toBeDefined();
    expect(load!.capacityMin).toBe(480); // 09:00-17:00
    expect(load!.committedMin).toBe(120);
  });
});
