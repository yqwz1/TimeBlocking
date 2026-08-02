import { describe, expect, it } from 'vitest';
import { WorkoutPlateauSchema } from '@timeblock/shared';

describe('workout summary compatibility', () => {
  it('accepts a short-history plateau verdict without an onset date', () => {
    expect(WorkoutPlateauSchema.parse({ verdict: 'insufficient_history' })).toEqual({
      verdict: 'insufficient_history',
    });
  });
});
