import { describe, expect, it } from 'vitest';
import type { WorkoutVolumeAnalyticsDTO } from '@timeblock/shared';
import { chartSeries, filterAndSortVolumeMuscles, formatVolumeState, periodDelta } from './workoutVolumeAnalytics.js';

const data = {
  schema_version: 1, range: '4w', selected: { from: '2026-07-01', to: '2026-07-28', weeks: 4 }, previous: null,
  comparison_available: true, comparison_reason: null,
  overview: { credited_sets: 10, target_gap: 1, muscles_requiring_action: 1, recovery_confidence: 'low', recovery_confidence_basis: 'history', push_pull: 1, push_pull_target: 1, upper_lower: 1, upper_lower_target: 1 },
  comparison_overview: null,
  weekly: [{ week: '2026-07-21', credited_sets: 10, load_index: 30, sessions: 2, recovery_score: -0.2, recovery_state: 'under_recovering' }], previous_weekly: [],
  muscles: [
    { muscle: 'back', region: 'upper', landmarks: { mev: 8, mav: 12, mrv: 20 }, credited_sets: 8, recent_sets: 3, active_weeks: 2, load_index: 20, recommendation: null, weekly: [], exercise_contributions: [], comparison_delta: null },
    { muscle: 'quads', region: 'lower', landmarks: { mev: 6, mav: 10, mrv: 16 }, credited_sets: 3, recent_sets: 1, active_weeks: 1, load_index: 10, recommendation: { muscle: 'quads', current_sets: 3, target_sets: 6, final_target: 6, delta: 3, action: 'raise_to_MEV', recovery: 'borderline', recovery_score: 0, confidence: 'low', signals: [], reason: 'below MEV', status: 'under_MEV' }, weekly: [], exercise_contributions: [], comparison_delta: null },
  ],
} satisfies WorkoutVolumeAnalyticsDTO;

describe('volume analytics helpers', () => {
  it('builds a metric-specific series and formats unavailable values safely', () => {
    expect(chartSeries(data, 'recovery')[0]).toMatchObject({ current: -0.2, previous: null });
    expect(formatVolumeState('under_recovering')).toBe('under recovering');
    expect(periodDelta(null, 3)).toBeNull();
  });

  it('filters regions and prioritizes muscles needing action', () => {
    expect(filterAndSortVolumeMuscles(data, 'lower', 'attention').map((item) => item.muscle)).toEqual(['quads']);
    expect(filterAndSortVolumeMuscles(data, 'all', 'attention')[0]?.muscle).toBe('quads');
  });
});
