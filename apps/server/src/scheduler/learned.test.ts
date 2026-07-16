import { describe, expect, it } from 'vitest';
import { EMPTY_ENERGY_WINDOWS, type WorkingHours } from '@timeblock/shared';
import { plan } from './engine.js';
import type { PlanInput, PlanLearned, PlanTaskInput } from './types.js';

const TZ = 'America/New_York';
const ALL_DAYS: WorkingHours = {
  mon: [{ start: '09:00', end: '18:00' }],
  tue: [{ start: '09:00', end: '18:00' }],
  wed: [{ start: '09:00', end: '18:00' }],
  thu: [{ start: '09:00', end: '18:00' }],
  fri: [{ start: '09:00', end: '18:00' }],
  sat: [{ start: '09:00', end: '18:00' }],
  sun: [{ start: '09:00', end: '18:00' }],
};
const ENERGY_OFF = { mode: 'off' as const, windows: EMPTY_ENERGY_WINDOWS, deepWorkMinMin: 60, deepLabel: 'deep', shallowLabel: 'shallow' };
const NEUTRAL: PlanLearned = { enabled: true, multipliers: { global: { value: 1, weight: 0 }, byProject: {} }, hourSuccess: { rates: Array(24).fill(0.5), totalWeight: 0 } };

function task(id: string, over: Partial<PlanTaskInput> = {}): PlanTaskInput {
  return { id, priority: 1, dueDate: null, dueDatetimeUtc: null, plannedForDate: null, durationMin: 60, createdAtUtc: null, labels: [], projectId: null, currentChunks: [], ...over };
}

function baseInput(learned: PlanLearned, over: Partial<PlanInput> = {}): PlanInput {
  return {
    nowUtc: '2026-07-06T12:00:00Z',
    timezone: TZ,
    horizonDays: 14,
    granularityMin: 15,
    bufferMin: 0,
    splitEnabled: false,
    maxChunkMin: 90,
    minChunkMin: 30,
    chunkGapPolicy: 'same_day',
    energy: ENERGY_OFF,
    learned,
    workingHours: ALL_DAYS,
    busy: [],
    tasks: [],
    habits: [],
    sticky: false,
    dayBudget: null,
    ...over,
  };
}

const blockFor = (r: ReturnType<typeof plan>, key: string) => r.blocks.find((b) => b.key === key);
const durMin = (b: { startUtc: string; endUtc: string }) => (Date.parse(b.endUtc) - Date.parse(b.startUtc)) / 60_000;
const localHour = (iso: string) => Number(new Date(iso).toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }));

describe('learned duration calibration', () => {
  it('neutral learned data leaves durations unchanged', () => {
    const r = plan(baseInput(NEUTRAL, { tasks: [task('a', { durationMin: 60 })] }));
    expect(durMin(blockFor(r, 'task:a:0')!)).toBe(60);
  });

  it('applies a confident global multiplier and tags the block', () => {
    const learned: PlanLearned = { ...NEUTRAL, multipliers: { global: { value: 1.5, weight: 20 }, byProject: {} } };
    const r = plan(baseInput(learned, { tasks: [task('a', { durationMin: 60 })] }));
    expect(durMin(blockFor(r, 'task:a:0')!)).toBe(90); // 60 * 1.5
    expect(blockFor(r, 'task:a:0')!.reasons.map((x) => x.code)).toContain('learned_duration');
  });

  it('ignores a low-confidence multiplier', () => {
    const learned: PlanLearned = { ...NEUTRAL, multipliers: { global: { value: 1.5, weight: 3 }, byProject: {} } };
    const r = plan(baseInput(learned, { tasks: [task('a', { durationMin: 60 })] }));
    expect(durMin(blockFor(r, 'task:a:0')!)).toBe(60); // weight < 10 → no change
  });

  it('prefers a confident per-project multiplier over the global one', () => {
    const learned: PlanLearned = {
      ...NEUTRAL,
      multipliers: { global: { value: 1.5, weight: 20 }, byProject: { p1: { value: 2.0, weight: 8 } } },
    };
    const r = plan(baseInput(learned, { tasks: [task('a', { durationMin: 60, projectId: 'p1' })] }));
    expect(durMin(blockFor(r, 'task:a:0')!)).toBe(120); // 60 * 2.0
  });
});

describe('learned hour-of-day', () => {
  it('pulls a no-deadline task toward a high-success hour', () => {
    // Boost 4pm (16:00 local) success strongly; earliest fit would otherwise be 09:00.
    const rates = Array(24).fill(0.5);
    rates[16] = 1.0;
    const learned: PlanLearned = { ...NEUTRAL, hourSuccess: { rates, totalWeight: 40 } };
    const r = plan(baseInput(learned, { tasks: [task('a', { durationMin: 60 })] }));
    // With strong hour signal and no earliness pressure, the block should shift toward 16:00.
    expect(localHour(blockFor(r, 'task:a:0')!.startUtc)).toBeGreaterThanOrEqual(15);
  });

  it('is deterministic with learned data on', () => {
    const rates = Array(24).fill(0.5);
    rates[10] = 0.9;
    const learned: PlanLearned = { ...NEUTRAL, hourSuccess: { rates, totalWeight: 30 } };
    const build = () => baseInput(learned, { tasks: [task('a'), task('b')] });
    expect(plan(build())).toEqual(plan(build()));
  });
});
