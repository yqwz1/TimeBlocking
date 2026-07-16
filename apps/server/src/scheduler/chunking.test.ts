import { describe, expect, it } from 'vitest';
import { EMPTY_ENERGY_WINDOWS, type WorkingHours } from '@timeblock/shared';
import { decompose } from './chunking.js';
import { plan } from './engine.js';
import type { PlanInput, PlanTaskInput } from './types.js';

const ENERGY_OFF = { mode: 'off' as const, windows: EMPTY_ENERGY_WINDOWS, deepWorkMinMin: 60, deepLabel: 'deep', shallowLabel: 'shallow' };
const LEARNED_OFF = { enabled: false, multipliers: { global: { value: 1, weight: 0 }, byProject: {} }, hourSuccess: { rates: Array(24).fill(0.5), totalWeight: 0 } };

describe('decompose', () => {
  it('keeps a short task whole (exact duration)', () => {
    expect(decompose(60, 15, 90, 30, true)).toEqual([{ index: 0, durMin: 60 }]);
  });

  it('keeps everything whole when splitting is disabled', () => {
    expect(decompose(240, 15, 90, 30, false)).toEqual([{ index: 0, durMin: 240 }]);
  });

  it('splits a 4h task into 3 chunks within [min,max], larger chunk first', () => {
    const chunks = decompose(240, 15, 90, 30, true);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.durMin)).toEqual([90, 75, 75]);
    for (const c of chunks) {
      expect(c.durMin).toBeGreaterThanOrEqual(30);
      expect(c.durMin).toBeLessThanOrEqual(90);
    }
    expect(chunks.reduce((s, c) => s + c.durMin, 0)).toBe(240);
  });

  it('splits an exactly-2x task into 2 equal chunks', () => {
    expect(decompose(180, 15, 90, 30, true)).toEqual([
      { index: 0, durMin: 90 },
      { index: 1, durMin: 90 },
    ]);
  });
});

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
    nowUtc: '2026-07-06T12:00:00Z',
    timezone: TZ,
    horizonDays: 14,
    granularityMin: 15,
    bufferMin: 0,
    splitEnabled: true,
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

const chunksOf = (r: ReturnType<typeof plan>, id: string) =>
  r.blocks.filter((b) => b.taskId === id).sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));

describe('chunk placement', () => {
  it('places a 4h task as 3 same-day contiguous chunks', () => {
    const r = plan(baseInput({ tasks: [task('big', { durationMin: 240 })] }));
    const cs = chunksOf(r, 'big');
    expect(cs).toHaveLength(3);
    // Contiguous, back-to-back from 09:00 EDT (13:00Z): 90 + 75 + 75.
    expect(cs[0].startUtc).toBe('2026-07-06T13:00:00Z');
    expect(cs[0].endUtc).toBe('2026-07-06T14:30:00Z');
    expect(cs[1].startUtc).toBe('2026-07-06T14:30:00Z');
    expect(cs[2].startUtc).toBe('2026-07-06T15:45:00Z');
    // Keys are per-chunk; each carries a chunk marker.
    expect(cs.map((c) => c.key)).toEqual(['task:big:0', 'task:big:1', 'task:big:2']);
    for (const c of cs) expect(c.chunk).toBeDefined();
  });

  it('spreads chunks across days under the spread policy', () => {
    const r = plan(baseInput({ chunkGapPolicy: 'spread', tasks: [task('big', { durationMin: 180 })] }));
    const cs = chunksOf(r, 'big');
    expect(cs).toHaveLength(2);
    const d0 = cs[0].startUtc.slice(0, 10);
    const d1 = cs[1].startUtc.slice(0, 10);
    expect(d1).not.toBe(d0); // different calendar days
  });

  it('keeps all chunks sticky when unchanged (zero churn)', () => {
    const first = plan(baseInput({ tasks: [task('big', { durationMin: 240 })] }));
    const cs = chunksOf(first, 'big');
    const currentChunks = cs.map((c, i) => ({ chunkIndex: i, startUtc: c.startUtc, endUtc: c.endUtc }));
    const second = plan(baseInput({ sticky: true, tasks: [task('big', { durationMin: 240, currentChunks })] }));
    const cs2 = chunksOf(second, 'big');
    expect(cs2.map((c) => ({ s: c.startUtc, e: c.endUtc }))).toEqual(cs.map((c) => ({ s: c.startUtc, e: c.endUtc })));
    for (const c of cs2) expect(c.reasons.map((x) => x.code)).toContain('sticky');
  });

  it('never leaves a task half-placed: unplaceable rolls back all chunks', () => {
    // horizon 0 (one 8h day), a 12h task can't fit even chunked → fully unplaceable.
    const r = plan(baseInput({ horizonDays: 0, tasks: [task('huge', { durationMin: 720 })] }));
    expect(r.unplaceable).toContain('huge');
    expect(chunksOf(r, 'huge')).toHaveLength(0);
  });
});
