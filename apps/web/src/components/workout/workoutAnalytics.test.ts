import { describe, expect, it } from 'vitest';
import type { WorkoutExerciseDTO, WorkoutExerciseHistoryDTO, WorkoutSummaryDTO } from '@timeblock/shared';
import { deltaPercent, epochPerformanceSeries, filterAndSortExercises, normalizedLiftSeries, periodMetrics, rangeBounds, toggleLiftComparison, weeklyTimeline } from './workoutAnalytics.js';

const summary = {
  window: { latest_session: '2026-07-28', first_session: '2026-01-01', weeks_covered: 30 },
  calendar: [
    { date: '2026-07-01', sets: 8, volume: 1000, n_exercises: 2, muscles: ['chest'] },
    { date: '2026-07-08', sets: 10, volume: 1400, n_exercises: 3, muscles: ['back'] },
    { date: '2026-07-22', sets: 12, volume: 1800, n_exercises: 3, muscles: ['legs'] },
  ],
  bodyweight: [{ date: '2026-07-22', weight: 81.2, unit: 'kg' }],
} as unknown as WorkoutSummaryDTO;

function exercise(name: string, status: string, sessions: number, trend: number | null, series: Array<[string, number]>): WorkoutExerciseDTO {
  return { name, muscle: name === 'Bench' ? 'chest' : 'legs', epoch: 0, n_sessions: sessions, last_trained: '2026-07-22', best_e1rm: series.at(-1)?.[1] ?? null, best_e1rm_set: null, heaviest: null, e1rm_trend_per_week: trend, trend_confidence: 'medium', status, recent_pr: null, next_target: null, forecast: null, individualization: { grace_state: 'learning', confidence: 50, n_fresh: 4 }, plateau: { verdict: status, onset: null }, series } as WorkoutExerciseDTO;
}

describe('workout analytics', () => {
  it('builds exact and prior date ranges and aggregates weekly values', () => {
    expect(rangeBounds(summary, '4w')).toMatchObject({ from: '2026-07-01', to: '2026-07-28', previousFrom: '2026-06-03', previousTo: '2026-06-30', span: 28 });
    expect(periodMetrics(summary, '2026-07-01', '2026-07-28')).toEqual({ sessions: 3, workingSets: 30, volume: 4200 });
    expect(weeklyTimeline(summary, '2026-07-01', '2026-07-28').at(-1)).toMatchObject({ week: '2026-07-20', sessions: 1, workingSets: 12, volume: 1800, bodyweight: 81.2 });
    expect(deltaPercent(12, 10)).toBe(20);
    expect(deltaPercent(12, 0)).toBeNull();
  });

  it('normalizes unlike lifts from their first visible observation', () => {
    const lifts = [exercise('Bench', 'progressing', 8, 1, [['2026-07-01', 100], ['2026-07-08', 105]]), exercise('Squat', 'building', 4, 0.5, [['2026-07-01', 200], ['2026-07-08', 210]])];
    expect(normalizedLiftSeries(lifts, ['Bench', 'Squat'], '2026-07-01')).toEqual([
      { date: '2026-07-01', Bench: 100, Squat: 100 },
      { date: '2026-07-08', Bench: 105, Squat: 105 },
    ]);
  });

  it('filters and prioritizes declining and plateaued lifts', () => {
    const lifts = [exercise('Bench', 'progressing', 8, 1, []), exercise('Squat', 'plateau', 5, 0, []), exercise('Deadlift', 'declining', 3, -1, [])];
    expect(filterAndSortExercises(lifts, { search: '', status: 'all', muscle: 'all', sort: 'attention' }).map((item) => item.name)).toEqual(['Deadlift', 'Squat', 'Bench']);
    expect(filterAndSortExercises(lifts, { search: 'bench', status: 'progressing', muscle: 'chest', sort: 'name' })).toHaveLength(1);
  });

  it('keeps performance values separated by unit epoch', () => {
    const history = { schema_version: 1, exercise: 'Bench', muscle: 'chest', epochs: [], sessions: [
      { date: '2026-07-08', title: 'Upper', duration_min: 50, total_volume: 1100, working_sets: 1, top_weight: 110, top_reps: 5, top_e1rm: 128, sets: [{ index: 0, type: 'normal', weight: 110, reps: 5, rpe: 8, rir: 2, rest_seconds: 180, e1rm: 128, volume: 550, epoch: 1, is_working: true, quality_flag: null }] },
      { date: '2026-07-01', title: 'Upper', duration_min: 50, total_volume: 1000, working_sets: 1, top_weight: 100, top_reps: 5, top_e1rm: 117, sets: [{ index: 0, type: 'normal', weight: 100, reps: 5, rpe: 8, rir: 2, rest_seconds: 180, e1rm: 117, volume: 500, epoch: 0, is_working: true, quality_flag: null }] },
    ] } as WorkoutExerciseHistoryDTO;
    expect(epochPerformanceSeries(history, 'topWeight')).toEqual({ epochs: [0, 1], rows: [
      { date: '2026-07-01', epoch0: 100, epoch1: null },
      { date: '2026-07-08', epoch0: null, epoch1: 110 },
    ] });
  });

  it('caps lift comparison at four while keeping one lift selected', () => {
    expect(toggleLiftComparison(['A', 'B', 'C', 'D'], 'E')).toEqual(['A', 'B', 'C', 'D']);
    expect(toggleLiftComparison(['A'], 'A')).toEqual(['A']);
    expect(toggleLiftComparison(['A', 'B'], 'A')).toEqual(['B']);
  });
});
