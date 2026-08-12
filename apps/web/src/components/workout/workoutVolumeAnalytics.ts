import type { WorkoutVolumeAnalyticsDTO } from '@timeblock/shared';

export type VolumeChartMetric = 'sets' | 'load' | 'recovery';
export type VolumeSort = 'attention' | 'volume' | 'load' | 'name';

const ATTENTION: Record<string, number> = { deload: 0, reduce: 1, raise_to_MEV: 2, raise_gently: 3, add: 4, add_cautious: 5, hold: 6 };

export function chartSeries(data: WorkoutVolumeAnalyticsDTO, metric: VolumeChartMetric) {
  const previous = data.previous_weekly;
  return data.weekly.map((point, index) => ({
    week: point.week,
    current: metric === 'sets' ? point.credited_sets : metric === 'load' ? point.load_index : point.recovery_score,
    previous: previous[index] ? (metric === 'sets' ? previous[index].credited_sets : metric === 'load' ? previous[index].load_index : previous[index].recovery_score) : null,
  }));
}

export function formatVolumeState(recovery: string) {
  return recovery.replaceAll('_', ' ');
}

export function periodDelta(current: number | null, previous: number | null) {
  if (current == null || previous == null) return null;
  return Math.round((current - previous) * 10) / 10;
}

export function filterAndSortVolumeMuscles(data: WorkoutVolumeAnalyticsDTO, region: string, sort: VolumeSort) {
  return [...data.muscles]
    .filter((muscle) => region === 'all' || muscle.region === region)
    .sort((left, right) => {
      if (sort === 'volume') return right.credited_sets - left.credited_sets;
      if (sort === 'load') return (right.load_index ?? -Infinity) - (left.load_index ?? -Infinity);
      if (sort === 'name') return left.muscle.localeCompare(right.muscle);
      return (ATTENTION[left.recommendation?.action ?? 'hold'] ?? 9) - (ATTENTION[right.recommendation?.action ?? 'hold'] ?? 9)
        || right.credited_sets - left.credited_sets;
    });
}
