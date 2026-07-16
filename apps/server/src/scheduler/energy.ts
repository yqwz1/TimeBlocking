import { DateTime } from 'luxon';
import { WEEKDAY_KEYS, type EnergyRange, type EnergyWindows } from '@timeblock/shared';
import type { Interval, PlanTaskInput } from './types.js';

export type EnergyLevel = 'peak' | 'normal' | 'low';
export type TaskClass = 'deep' | 'shallow';

/** Precomputed peak/low bands over the horizon, in epoch ms. */
export interface EnergyIntervals {
  peak: Interval[];
  low: Interval[];
}

const CHRONOTYPE_PRESETS: Record<string, EnergyRange[]> = {
  morning: [
    { start: '08:00', end: '12:00', level: 'peak' },
    { start: '14:00', end: '16:00', level: 'low' },
  ],
  balanced: [
    { start: '09:00', end: '11:30', level: 'peak' },
    { start: '13:00', end: '14:30', level: 'low' },
    { start: '16:00', end: '18:00', level: 'peak' },
  ],
  evening: [
    { start: '08:00', end: '11:00', level: 'low' },
    { start: '16:00', end: '21:00', level: 'peak' },
  ],
};

/** Expand a chronotype preset into the same per-weekday shape as custom windows. */
export function expandChronotype(chronotype: string): EnergyWindows {
  const ranges = CHRONOTYPE_PRESETS[chronotype] ?? CHRONOTYPE_PRESETS.balanced;
  const out = {} as EnergyWindows;
  for (const key of WEEKDAY_KEYS) out[key] = ranges.map((r) => ({ ...r }));
  return out;
}

function hhmmParts(hhmm: string): { hour: number; minute: number } {
  const [h, m] = hhmm.split(':').map(Number);
  return { hour: h, minute: m };
}

/** Expand per-weekday energy windows across the horizon into epoch-ms peak/low intervals (DST-safe). */
export function buildEnergyIntervals(nowMs: number, tz: string, horizonDays: number, windows: EnergyWindows): EnergyIntervals {
  const today = DateTime.fromMillis(nowMs, { zone: tz }).startOf('day');
  const peak: Interval[] = [];
  const low: Interval[] = [];
  for (let d = 0; d <= horizonDays; d++) {
    const day = today.plus({ days: d });
    const key = WEEKDAY_KEYS[day.weekday - 1];
    for (const range of windows[key]) {
      const start = day.set(hhmmParts(range.start)).toMillis();
      const end = day.set(hhmmParts(range.end)).toMillis();
      if (end > start) (range.level === 'peak' ? peak : low).push({ start, end });
    }
  }
  return { peak, low };
}

/**
 * Classify a task as deep or shallow work. Explicit difficulty wins (hard => deep,
 * easy => shallow), then an explicit label, else the duration/priority heuristic.
 * Medium difficulty is intentionally neutral and falls through to labels/heuristic.
 */
export function classifyTask(t: PlanTaskInput, deepWorkMinMin: number, deepLabel: string, shallowLabel: string): TaskClass {
  if (t.difficulty === 'hard') return 'deep';
  if (t.difficulty === 'easy') return 'shallow';
  if (t.labels.includes(deepLabel)) return 'deep';
  if (t.labels.includes(shallowLabel)) return 'shallow';
  return t.durationMin >= deepWorkMinMin || t.priority >= 3 ? 'deep' : 'shallow';
}

/** Total overlap (ms) between an interval and a set of (disjoint) intervals. */
function overlap(iv: Interval, set: Interval[]): number {
  let sum = 0;
  for (const s of set) {
    const lo = Math.max(iv.start, s.start);
    const hi = Math.min(iv.end, s.end);
    if (hi > lo) sum += hi - lo;
  }
  return sum;
}

/**
 * Time-weighted energy match in [0,1] for placing a task of `cls` at `cand`.
 * Deep work prefers peak and avoids low; shallow work prefers low and mildly
 * avoids peak (so it doesn't burn prime focus time).
 */
export function energyMatch(cand: Interval, cls: TaskClass, energy: EnergyIntervals): number {
  const span = cand.end - cand.start;
  if (span <= 0) return 0.5;
  const peakMs = overlap(cand, energy.peak);
  const lowMs = overlap(cand, energy.low);
  const normalMs = Math.max(0, span - peakMs - lowMs);
  const w = cls === 'deep' ? { peak: 1.0, normal: 0.5, low: 0.0 } : { peak: 0.25, normal: 0.75, low: 1.0 };
  return (peakMs * w.peak + normalMs * w.normal + lowMs * w.low) / span;
}
