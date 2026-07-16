import { describe, expect, it } from 'vitest';
import { durationRatio, ewmaStep } from './stats.js';

describe('ewmaStep', () => {
  it('starts from the prior when there is no weight yet', () => {
    const next = ewmaStep({ value: 1, weight: 0 }, 2, 0.2, 1);
    // base = prior(1); value = 0.8*1 + 0.2*2 = 1.2
    expect(next.value).toBeCloseTo(1.2, 5);
    expect(next.weight).toBeCloseTo(1, 5);
  });

  it('converges toward a steady sample', () => {
    let s = { value: 1, weight: 0 };
    for (let i = 0; i < 100; i++) s = ewmaStep(s, 1.5, 0.2, 1);
    expect(s.value).toBeCloseTo(1.5, 2);
  });

  it('decays weight toward a steady-state of 1/alpha', () => {
    let s = { value: 0.5, weight: 0 };
    for (let i = 0; i < 500; i++) s = ewmaStep(s, 1, 0.2, 0.5);
    expect(s.weight).toBeCloseTo(5, 1); // 1/0.2
  });
});

describe('durationRatio', () => {
  it('clamps to [0.33, 3.0]', () => {
    expect(durationRatio(60, 600, 0)).toBe(3.0);
    expect(durationRatio(60, 5, 0)).toBeCloseTo(0.33, 2);
  });
  it('reflects overrun', () => {
    expect(durationRatio(60, 60, 30)).toBeCloseTo(1.5, 5); // took 90 vs estimated 60
  });
  it('returns 1 for a zero estimate', () => {
    expect(durationRatio(0, 60, 0)).toBe(1);
  });
});
