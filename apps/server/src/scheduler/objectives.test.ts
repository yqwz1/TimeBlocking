import { describe, expect, it } from 'vitest';
import { EMPTY_ENERGY_WINDOWS, type WorkingHours } from '@timeblock/shared';
import { plan } from './engine.js';
import type { PlanInput, PlanTaskInput } from './types.js';

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
const LEARNED_OFF = { enabled: false, multipliers: { global: { value: 1, weight: 0 }, byProject: {} }, hourSuccess: { rates: Array(24).fill(0.5), totalWeight: 0 } };

function task(id: string, over: Partial<PlanTaskInput> = {}): PlanTaskInput {
  return { id, priority: 1, dueDate: null, dueDatetimeUtc: null, plannedForDate: null, durationMin: 30, createdAtUtc: null, labels: [], projectId: null, currentChunks: [], ...over };
}

function baseInput(over: Partial<PlanInput> = {}): PlanInput {
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
    learned: LEARNED_OFF,
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

describe('objective boost', () => {
  it('schedules a behind-pace objective task before an otherwise-equal one', () => {
    const r = plan(
      baseInput({
        tasks: [task('plain', { durationMin: 30 }), task('boosted', { durationMin: 30, objectiveBoost: 0.8 })],
      }),
    );
    // Boosted task takes the earliest slot (09:00 EDT = 13:00Z).
    expect(blockFor(r, 'task:boosted:0')!.startUtc).toBe('2026-07-06T13:00:00Z');
    expect(Date.parse(blockFor(r, 'task:plain:0')!.startUtc)).toBeGreaterThan(Date.parse('2026-07-06T13:00:00Z'));
    expect(blockFor(r, 'task:boosted:0')!.reasons.map((x) => x.code)).toContain('objective_boost');
  });

  it('is a no-op when no objective is behind pace', () => {
    const a = plan(baseInput({ tasks: [task('x'), task('y')] }));
    const b = plan(baseInput({ tasks: [task('x', { objectiveBoost: 0 }), task('y', { objectiveBoost: 0 })] }));
    expect(a).toEqual(b);
  });

  it('does not emit the reason below the threshold', () => {
    const r = plan(baseInput({ tasks: [task('a', { objectiveBoost: 0.1 })] }));
    expect(blockFor(r, 'task:a:0')!.reasons.map((x) => x.code)).not.toContain('objective_boost');
  });
});
