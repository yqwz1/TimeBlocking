import { describe, expect, it } from 'vitest';
import { dotsCoefficient, plateBreakdown, powerliftingScore, projectedLift, repMaxRows, roundLoad, wilksCoefficient } from './powerliftingAnalytics.js';

describe('powerlifting analytics', () => {
  it('calculates bounded DOTS and Wilks scores only when total and bodyweight are available', () => {
    expect(dotsCoefficient(90, 'male')).toBeGreaterThan(0);
    expect(wilksCoefficient(90, 'female')).toBeGreaterThan(0);
    expect(powerliftingScore(600, 90, 'male', 'dots')).toBeGreaterThan(0);
    expect(powerliftingScore(null, 90, 'male', 'dots')).toBeNull();
    expect(powerliftingScore(600, null, 'male', 'wilks')).toBeNull();
  });

  it('rounds only to loadable barbell weights and returns the actual plates per side', () => {
    expect(roundLoad(101, 20, [25, 20, 2.5, 1.25])).toBe(100);
    const exact = plateBreakdown(102.5, 20, [25, 20, 2.5, 1.25]);
    expect(exact).toMatchObject({ requested: 102.5, loaded: 102.5 });
    expect(exact.perSide.reduce((sum, plate) => sum + plate, 0)).toBe(41.25);
    expect(plateBreakdown(10, 20, [25, 20, 2.5, 1.25])).toMatchObject({ loaded: 20, perSide: [] });
  });

  it('builds plate-aware rep-max planning rows', () => {
    const rows = repMaxRows(150, 20, [25, 20, 15, 10, 5, 2.5, 1.25]);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ reps: 1, loaded: 150, percent: 100 });
    expect(rows.at(-1)?.loaded).toBeLessThan(150);
  });

  it('projects only non-negative trends and respects a known ceiling', () => {
    const lift = {
      current: 200,
      exercise: { forecast: { horizon_weeks: 8, e1rm_in_horizon: 216 }, plateau: { ceiling: { ceiling: 210 } } },
    } as never;
    expect(projectedLift(lift, 4)).toBe(208);
    expect(projectedLift(lift, 12)).toBe(210);
  });
});
