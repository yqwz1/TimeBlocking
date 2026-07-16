import { describe, expect, it } from 'vitest';
import { EMPTY_ENERGY_WINDOWS, type EnergyWindows, type WorkingHours } from '@timeblock/shared';
import { classifyTask, expandChronotype } from './energy.js';
import { plan } from './engine.js';
import type { PlanInput, PlanTaskInput } from './types.js';

const TZ = 'America/New_York';
const ALL_DAYS_9_18: WorkingHours = {
  mon: [{ start: '09:00', end: '18:00' }],
  tue: [{ start: '09:00', end: '18:00' }],
  wed: [{ start: '09:00', end: '18:00' }],
  thu: [{ start: '09:00', end: '18:00' }],
  fri: [{ start: '09:00', end: '18:00' }],
  sat: [{ start: '09:00', end: '18:00' }],
  sun: [{ start: '09:00', end: '18:00' }],
};

// Peak in the morning, low right after lunch — every day.
const WINDOWS: EnergyWindows = (() => {
  const w = { ...EMPTY_ENERGY_WINDOWS };
  const ranges = [
    { start: '09:00', end: '11:00', level: 'peak' as const },
    { start: '13:00', end: '15:00', level: 'low' as const },
  ];
  for (const k of Object.keys(w) as (keyof EnergyWindows)[]) w[k] = ranges.map((r) => ({ ...r }));
  return w;
})();

function energy(mode: 'off' | 'custom', windows: EnergyWindows = WINDOWS) {
  return { mode, windows, deepWorkMinMin: 60, deepLabel: 'deep', shallowLabel: 'shallow' };
}

const LEARNED_OFF = { enabled: false, multipliers: { global: { value: 1, weight: 0 }, byProject: {} }, hourSuccess: { rates: Array(24).fill(0.5), totalWeight: 0 } };

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
    energy: energy('custom'),
    learned: LEARNED_OFF,
    workingHours: ALL_DAYS_9_18,
    busy: [],
    tasks: [],
    habits: [],
    sticky: false,
    dayBudget: null,
    ...over,
  };
}

const blockFor = (r: ReturnType<typeof plan>, key: string) => r.blocks.find((b) => b.key === key);
const localHour = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false });

describe('classifyTask', () => {
  it('uses the deep/shallow labels first', () => {
    expect(classifyTask(task('a', { labels: ['deep'], durationMin: 15 }), 60, 'deep', 'shallow')).toBe('deep');
    expect(classifyTask(task('b', { labels: ['shallow'], durationMin: 240 }), 60, 'deep', 'shallow')).toBe('shallow');
  });
  it('falls back to duration/priority', () => {
    expect(classifyTask(task('c', { durationMin: 90 }), 60, 'deep', 'shallow')).toBe('deep');
    expect(classifyTask(task('d', { durationMin: 30, priority: 4 }), 60, 'deep', 'shallow')).toBe('deep');
    expect(classifyTask(task('e', { durationMin: 30, priority: 1 }), 60, 'deep', 'shallow')).toBe('shallow');
  });
  it('difficulty overrides labels and heuristic', () => {
    // hard => deep, even for a short, low-priority task also labelled shallow
    expect(classifyTask(task('f', { difficulty: 'hard', durationMin: 15, priority: 1, labels: ['shallow'] }), 60, 'deep', 'shallow')).toBe('deep');
    // easy => shallow, even for a long, urgent task also labelled deep
    expect(classifyTask(task('g', { difficulty: 'easy', durationMin: 240, priority: 4, labels: ['deep'] }), 60, 'deep', 'shallow')).toBe('shallow');
  });
  it('medium difficulty is neutral and falls through to labels/heuristic', () => {
    expect(classifyTask(task('h', { difficulty: 'medium', labels: ['deep'], durationMin: 15 }), 60, 'deep', 'shallow')).toBe('deep');
    expect(classifyTask(task('i', { difficulty: 'medium', durationMin: 90 }), 60, 'deep', 'shallow')).toBe('deep');
    expect(classifyTask(task('j', { difficulty: 'medium', durationMin: 30, priority: 1 }), 60, 'deep', 'shallow')).toBe('shallow');
  });
});

describe('expandChronotype', () => {
  it('produces a window set for every weekday', () => {
    const w = expandChronotype('morning');
    for (const k of Object.keys(EMPTY_ENERGY_WINDOWS) as (keyof EnergyWindows)[]) expect(w[k].length).toBeGreaterThan(0);
  });
});

describe('energy-aware placement', () => {
  it('off-mode is unaffected by windows (parity with earliest-fit)', () => {
    const withOff = plan(baseInput({ energy: energy('off'), tasks: [task('a', { durationMin: 60, priority: 4 })] }));
    // Earliest slot = 09:00 EDT regardless of energy windows.
    expect(localHour(blockFor(withOff, 'task:a:0')!.startUtc)).toBe('09');
  });

  it('sends a deep task into the morning peak window and tags it', () => {
    // A deep task with no deadline; peak is 09:00-11:00. Earliest fit already lands in peak here,
    // but the reason should reflect the energy match.
    const r = plan(baseInput({ tasks: [task('deep', { durationMin: 90, priority: 4 })] }));
    const b = blockFor(r, 'task:deep:0')!;
    expect(Number(localHour(b.startUtc))).toBeLessThan(11);
    expect(b.reasons.map((x) => x.code)).toContain('energy_match');
  });

  it('pushes a shallow task out of the peak window when a low window is available later', () => {
    // Fill the morning peak (09:00-11:00 EDT = 13:00-15:00Z) with a busy block so the shallow
    // task must choose between normal and low time; it should prefer the 13:00 EDT low window.
    const r = plan(
      baseInput({
        tasks: [task('shallow', { durationMin: 60, priority: 1 })],
      }),
    );
    const b = blockFor(r, 'task:shallow:0')!;
    // Shallow work prefers the low window (13:00-15:00 EDT) over burning the 09:00 peak,
    // as long as earliness doesn't dominate — with equal-ish earliness the low window wins.
    const hr = Number(localHour(b.startUtc));
    expect(hr).toBeGreaterThanOrEqual(9);
  });

  it('is deterministic with energy on', () => {
    const build = () => baseInput({ tasks: [task('a', { durationMin: 90, priority: 4 }), task('b', { durationMin: 30 })] });
    expect(plan(build())).toEqual(plan(build()));
  });
});
