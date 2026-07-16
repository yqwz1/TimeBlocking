import { describe, expect, it } from 'vitest';
import { findSlot, mergeIntervals, msToUtcIso, subtractIntervals } from './slots.js';

const MIN = 60_000;

describe('interval math', () => {
  it('merges overlapping and adjacent intervals', () => {
    expect(
      mergeIntervals([
        { start: 0, end: 10 },
        { start: 5, end: 20 },
        { start: 20, end: 30 },
        { start: 50, end: 60 },
      ]),
    ).toEqual([
      { start: 0, end: 30 },
      { start: 50, end: 60 },
    ]);
  });

  it('subtracts busy time from windows', () => {
    const free = subtractIntervals([{ start: 0, end: 100 }], [
      { start: 10, end: 20 },
      { start: 40, end: 50 },
    ]);
    expect(free).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 40 },
      { start: 50, end: 100 },
    ]);
  });

  it('findSlot aligns to the granularity grid and honours notAfter', () => {
    const free = [{ start: 7 * MIN, end: 120 * MIN }];
    expect(findSlot(free, 30 * MIN, 15 * MIN, null, null)).toEqual({ start: 15 * MIN, end: 45 * MIN });
    expect(findSlot(free, 30 * MIN, 15 * MIN, null, 40 * MIN)).toBeNull();
  });

  it('msToUtcIso emits canonical second-precision Z strings', () => {
    expect(msToUtcIso(Date.parse('2026-07-06T13:00:00.000Z'))).toBe('2026-07-06T13:00:00Z');
    expect(msToUtcIso(Date.parse('2026-07-06T13:00:00.750Z'))).toBe('2026-07-06T13:00:00Z');
  });
});
