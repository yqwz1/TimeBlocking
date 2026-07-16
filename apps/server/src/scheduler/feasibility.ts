import { DateTime } from 'luxon';
import type { PlanWarningKind } from '@timeblock/shared';
import { subtractIntervals } from './slots.js';
import type { Interval } from './types.js';

const DAY_MS = 86_400_000;

export interface TaskRisk {
  taskId: string;
  kind: PlanWarningKind;
  deadlineUtc?: string;
  shortfallMin?: number;
  date?: string;
}

export interface DayLoad {
  date: string; // local YYYY-MM-DD
  capacityMin: number;
  committedMin: number;
}

/** A deadlined task as seen by the capacity forecast. */
export interface ForecastTask {
  id: string;
  deadlineMs: number;
  loadMs: number; // duration + buffer
  score: number;
}

/** Sum of free capacity (ms) inside [from, to). */
function freeCapacity(free: Interval[], from: number, to: number): number {
  let sum = 0;
  for (const iv of free) {
    const lo = Math.max(iv.start, from);
    const hi = Math.min(iv.end, to);
    if (hi > lo) sum += hi - lo;
  }
  return sum;
}

/**
 * Look ahead deadline-by-deadline and flag the tasks that cannot all fit before
 * their deadlines even though each might place individually. For each deadline D
 * where cumulative demand exceeds the free supply in [now, D], the lowest-score
 * tasks due by D are flagged until the rest fit — deterministic (score asc, id).
 */
export function forecastCapacity(tasks: ForecastTask[], free: Interval[], nowCeil: number, tz: string): TaskRisk[] {
  if (!tasks.length) return [];
  const risks: TaskRisk[] = [];
  const flagged = new Set<string>();
  const deadlines = [...new Set(tasks.map((t) => t.deadlineMs))].sort((a, b) => a - b);

  for (const D of deadlines) {
    const relevant = tasks.filter((t) => t.deadlineMs <= D);
    let demand = relevant.filter((t) => !flagged.has(t.id)).reduce((s, t) => s + t.loadMs, 0);
    const supply = freeCapacity(free, nowCeil, Math.max(nowCeil, D));
    if (demand <= supply) continue;

    const shortfallMin = Math.round((demand - supply) / 60_000);
    const localDate = DateTime.fromMillis(D, { zone: tz }).toISODate() ?? undefined;
    const candidates = relevant
      .filter((t) => !flagged.has(t.id))
      .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
    for (const t of candidates) {
      if (demand <= supply) break;
      flagged.add(t.id);
      demand -= t.loadMs;
      risks.push({
        taskId: t.id,
        kind: 'capacity_shortfall',
        deadlineUtc: DateTime.fromMillis(D, { zone: 'utc' }).toISO({ suppressMilliseconds: true }) ?? undefined,
        shortfallMin,
        date: localDate,
      });
    }
  }
  return risks;
}

/** Per-local-day capacity vs. committed minutes, using the final busy map after placement. */
export function computeDayLoads(windows: Interval[], busy: Interval[], tz: string): DayLoad[] {
  const byDate = new Map<string, Interval[]>();
  for (const w of windows) {
    const date = DateTime.fromMillis(w.start, { zone: tz }).toISODate()!;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(w);
  }
  const out: DayLoad[] = [];
  for (const [date, dayWindows] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const capacityMs = dayWindows.reduce((s, w) => s + (w.end - w.start), 0);
    const freeMs = subtractIntervals(dayWindows, busy).reduce((s, iv) => s + (iv.end - iv.start), 0);
    out.push({
      date,
      capacityMin: Math.round(capacityMs / 60_000),
      committedMin: Math.round((capacityMs - freeMs) / 60_000),
    });
  }
  return out;
}

/** Convert a task's deadline + duration into a pressure factor in (0,1]; higher = tighter. */
export function deadlinePressure(deadlineMs: number | null, nowCeil: number, durMs: number): number {
  if (deadlineMs == null) return 0;
  const slackDays = (deadlineMs - nowCeil - durMs) / DAY_MS;
  return 1 / (1 + Math.max(0, slackDays));
}
