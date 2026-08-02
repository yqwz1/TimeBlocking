import type { WorkoutExerciseDTO, WorkoutExerciseHistoryDTO, WorkoutSummaryDTO } from '@timeblock/shared';

export type WorkoutRange = '4w' | '8w' | '12w' | 'all';
export type StrengthSort = 'attention' | 'trend' | 'recent' | 'sessions' | 'e1rm' | 'name';

const DAY = 86_400_000;

function parseDay(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftDay(value: string, days: number): string {
  return isoDay(new Date(parseDay(value).getTime() + days * DAY));
}

export function rangeBounds(summary: WorkoutSummaryDTO, range: WorkoutRange) {
  const latest = summary.window.latest_session;
  const days = range === '4w' ? 28 : range === '8w' ? 56 : range === '12w' ? 84 : null;
  const from = days == null ? (summary.window.first_session ?? latest) : shiftDay(latest, -(days - 1));
  const span = Math.max(1, Math.round((parseDay(latest).getTime() - parseDay(from).getTime()) / DAY) + 1);
  return {
    from,
    to: latest,
    previousFrom: shiftDay(from, -span),
    previousTo: shiftDay(from, -1),
    span,
  };
}

function monday(value: string): string {
  const date = parseDay(value);
  const weekday = date.getUTCDay() || 7;
  return isoDay(new Date(date.getTime() - (weekday - 1) * DAY));
}

export type WorkoutWeeklyPoint = {
  week: string;
  label: string;
  sessions: number;
  workingSets: number;
  volume: number;
  bodyweight: number | null;
};

export function weeklyTimeline(summary: WorkoutSummaryDTO, from: string, to: string): WorkoutWeeklyPoint[] {
  const buckets = new Map<string, WorkoutWeeklyPoint>();
  const ensure = (date: string) => {
    const key = monday(date);
    if (!buckets.has(key)) {
      buckets.set(key, { week: key, label: key.slice(5), sessions: 0, workingSets: 0, volume: 0, bodyweight: null });
    }
    return buckets.get(key)!;
  };
  for (const day of summary.calendar) {
    if (day.date < from || day.date > to) continue;
    const bucket = ensure(day.date);
    bucket.sessions += 1;
    bucket.workingSets += day.sets;
    bucket.volume += day.volume;
  }
  for (const item of summary.bodyweight) {
    if (item.date < from || item.date > to) continue;
    ensure(item.date).bodyweight = item.weight;
  }
  return [...buckets.values()].sort((a, b) => a.week.localeCompare(b.week)).map((item) => ({
    ...item,
    volume: Math.round(item.volume),
  }));
}

export type PeriodMetrics = { sessions: number; workingSets: number; volume: number };

export function periodMetrics(summary: WorkoutSummaryDTO, from: string, to: string): PeriodMetrics {
  return summary.calendar.reduce<PeriodMetrics>((total, day) => {
    if (day.date < from || day.date > to) return total;
    total.sessions += 1;
    total.workingSets += day.sets;
    total.volume += day.volume;
    return total;
  }, { sessions: 0, workingSets: 0, volume: 0 });
}

export function deltaPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round((current - previous) / previous * 100);
}

export function normalizedLiftSeries(exercises: WorkoutExerciseDTO[], names: string[], from: string) {
  const selected = exercises.filter((exercise) => names.includes(exercise.name));
  const dates = [...new Set(selected.flatMap((exercise) => exercise.series.filter(([date]) => date >= from).map(([date]) => date)))].sort();
  const bases = new Map(selected.map((exercise) => [exercise.name, exercise.series.find(([date]) => date >= from)?.[1] ?? null]));
  return dates.map((date) => {
    const point: Record<string, string | number | null> = { date };
    for (const exercise of selected) {
      const value = exercise.series.find(([day]) => day === date)?.[1] ?? null;
      const base = bases.get(exercise.name);
      point[exercise.name] = value != null && base ? Math.round(value / base * 10_000) / 100 : null;
    }
    return point;
  });
}

const ATTENTION: Record<string, number> = { declining: 0, plateau: 1, building: 2, insufficient: 3, progressing: 4 };

export function filterAndSortExercises(
  exercises: WorkoutExerciseDTO[],
  options: { search: string; status: string; muscle: string; sort: StrengthSort },
) {
  const query = options.search.trim().toLowerCase();
  return exercises
    .filter((exercise) => (!query || exercise.name.toLowerCase().includes(query)))
    .filter((exercise) => options.status === 'all' || exercise.status === options.status)
    .filter((exercise) => options.muscle === 'all' || exercise.muscle === options.muscle)
    .sort((a, b) => {
      switch (options.sort) {
        case 'trend': return (b.e1rm_trend_per_week ?? -Infinity) - (a.e1rm_trend_per_week ?? -Infinity);
        case 'recent': return (b.last_trained ?? '').localeCompare(a.last_trained ?? '');
        case 'sessions': return b.n_sessions - a.n_sessions;
        case 'e1rm': return (b.best_e1rm ?? -Infinity) - (a.best_e1rm ?? -Infinity);
        case 'name': return a.name.localeCompare(b.name);
        default: return (ATTENTION[a.status] ?? 9) - (ATTENTION[b.status] ?? 9) || b.n_sessions - a.n_sessions;
      }
    });
}

export function momentumCounts(exercises: WorkoutExerciseDTO[]) {
  return exercises.reduce<Record<string, number>>((counts, exercise) => {
    counts[exercise.status] = (counts[exercise.status] ?? 0) + 1;
    return counts;
  }, {});
}

export type HistoryMetric = 'topWeight' | 'topReps' | 'volume' | 'workingSets';

export function epochPerformanceSeries(history: WorkoutExerciseHistoryDTO, metric: HistoryMetric) {
  const epochs = [...new Set(history.sessions.flatMap((session) => session.sets.map((set) => set.epoch)))].sort((a, b) => a - b);
  const rows = [...history.sessions].reverse().map((session) => {
    const point: Record<string, string | number | null> = { date: session.date };
    for (const epoch of epochs) {
      const sets = session.sets.filter((set) => set.epoch === epoch);
      const working = sets.filter((set) => set.is_working);
      const candidates = working.length ? working : sets;
      let value: number | null = null;
      if (metric === 'topWeight') value = candidates.reduce<number | null>((best, set) => set.weight == null ? best : Math.max(best ?? -Infinity, set.weight), null);
      if (metric === 'topReps') {
        const top = [...candidates].sort((a, b) => (b.e1rm ?? b.weight ?? -Infinity) - (a.e1rm ?? a.weight ?? -Infinity))[0];
        value = top?.reps ?? null;
      }
      if (metric === 'volume') value = working.reduce((total, set) => total + (set.volume ?? 0), 0);
      if (metric === 'workingSets') value = working.length;
      point[`epoch${epoch}`] = value;
    }
    return point;
  });
  return { epochs, rows };
}

export function toggleLiftComparison(selected: string[], name: string, limit = 4) {
  if (selected.includes(name)) return selected.length > 1 ? selected.filter((item) => item !== name) : selected;
  return selected.length < limit ? [...selected, name] : selected;
}
