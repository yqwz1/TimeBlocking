import { describe, expect, it } from 'vitest';
import { findBestSlot, type SlotContext } from './slotScore.js';
import { findSlot } from './slots.js';
import type { Interval, PlanTaskInput } from './types.js';

const HOUR = 3_600_000;
const GRAN = 15 * 60_000;

function ctxFor(free: Interval[]): SlotContext {
  const nowCeil = free.length ? free[0].start : 0;
  const horizonEnd = free.length ? free[free.length - 1].end : nowCeil;
  return { nowCeil, horizonEnd, granMs: GRAN, bufMs: 0 };
}

const task: PlanTaskInput = {
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
};

describe('findBestSlot (Phase-1 parity with earliest-fit)', () => {
  const cases: { name: string; free: Interval[]; dur: number; notBefore: number | null; notAfter: number | null }[] = [
    { name: 'single interval', free: [{ start: 0, end: 4 * HOUR }], dur: HOUR, notBefore: null, notAfter: null },
    {
      name: 'two intervals, first too small',
      free: [
        { start: 0, end: 20 * 60_000 },
        { start: HOUR, end: 4 * HOUR },
      ],
      dur: HOUR,
      notBefore: null,
      notAfter: null,
    },
    { name: 'notBefore skips early space', free: [{ start: 0, end: 4 * HOUR }], dur: HOUR, notBefore: 2 * HOUR, notAfter: null },
    { name: 'notAfter satisfiable', free: [{ start: 0, end: 4 * HOUR }], dur: HOUR, notBefore: null, notAfter: 2 * HOUR },
    { name: 'notAfter unsatisfiable', free: [{ start: 3 * HOUR, end: 4 * HOUR }], dur: HOUR, notBefore: null, notAfter: 2 * HOUR },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const best = findBestSlot(c.free, c.dur, GRAN, c.notBefore, c.notAfter, task, ctxFor(c.free));
      const legacy = findSlot(c.free, c.dur, GRAN, c.notBefore, c.notAfter);
      expect(best?.slot ?? null).toEqual(legacy);
    });
  }

  it('returns the earliest slot (max-score tie-break) and an earliest_fit part', () => {
    const free = [{ start: 0, end: 4 * HOUR }];
    const best = findBestSlot(free, HOUR, GRAN, null, null, task, ctxFor(free));
    expect(best!.slot.start).toBe(0);
    expect(best!.parts.some((p) => p.code === 'earliest_fit')).toBe(true);
  });
});
