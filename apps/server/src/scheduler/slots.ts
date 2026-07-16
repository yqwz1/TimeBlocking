import { DateTime } from 'luxon';
import { WEEKDAY_KEYS, type WorkingHours } from '@timeblock/shared';
import type { Interval } from './types.js';

/** Canonical UTC ISO string (second precision, Z suffix) used everywhere in the app. */
export function msToUtcIso(ms: number): string {
  return DateTime.fromMillis(Math.floor(ms / 1000) * 1000)
    .toUTC()
    .toISO({ suppressMilliseconds: true })!;
}

export function ceilTo(ms: number, granMs: number): number {
  return Math.ceil(ms / granMs) * granMs;
}

export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list
    .filter((iv) => iv.end > iv.start)
    .slice()
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}

/** windows − busy (both need not be pre-merged). Result is sorted and disjoint. */
export function subtractIntervals(windows: Interval[], busy: Interval[]): Interval[] {
  const mergedBusy = mergeIntervals(busy);
  const out: Interval[] = [];
  for (const w of mergeIntervals(windows)) {
    let cursor = w.start;
    for (const b of mergedBusy) {
      if (b.end <= cursor) continue;
      if (b.start >= w.end) break;
      if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, w.end) });
      cursor = Math.max(cursor, b.end);
      if (cursor >= w.end) break;
    }
    if (cursor < w.end) out.push({ start: cursor, end: w.end });
  }
  return out;
}

export function isFree(free: Interval[], iv: Interval): boolean {
  return free.some((f) => f.start <= iv.start && iv.end <= f.end);
}

function hhmmParts(hhmm: string): { hour: number; minute: number } {
  const [h, m] = hhmm.split(':').map(Number);
  return { hour: h, minute: m };
}

/** Epoch ms of a local HH:mm on a local date in tz (DST-safe: Luxon shifts invalid times forward). */
export function localTimeToMs(dateIso: string, tz: string, hhmm: string): number {
  return DateTime.fromISO(dateIso, { zone: tz }).set(hhmmParts(hhmm)).toMillis();
}

/**
 * Expand working-hours windows over the horizon into UTC ms intervals,
 * clamped so nothing starts before ceil(now, granularity).
 */
export function buildDayWindows(
  nowMs: number,
  tz: string,
  horizonDays: number,
  workingHours: WorkingHours,
  granMs: number,
): Interval[] {
  const nowCeil = ceilTo(nowMs, granMs);
  const today = DateTime.fromMillis(nowMs, { zone: tz }).startOf('day');
  const out: Interval[] = [];
  for (let d = 0; d <= horizonDays; d++) {
    const day = today.plus({ days: d });
    const key = WEEKDAY_KEYS[day.weekday - 1]; // luxon: 1 = Monday
    for (const range of workingHours[key]) {
      const start = day.set(hhmmParts(range.start)).toMillis();
      const end = day.set(hhmmParts(range.end)).toMillis();
      const clampedStart = Math.max(start, nowCeil);
      if (end > clampedStart) out.push({ start: clampedStart, end });
    }
  }
  return mergeIntervals(out);
}

/** A single local-day window (used for habit windows), or null when empty. */
export function dayWindow(dateIso: string, tz: string, startHHMM: string, endHHMM: string): Interval | null {
  const start = localTimeToMs(dateIso, tz, startHHMM);
  const end = localTimeToMs(dateIso, tz, endHHMM);
  return end > start ? { start, end } : null;
}

/**
 * Earliest granularity-aligned slot of durMs inside `free` (sorted), optionally
 * bounded. Returns null if the bound cannot be met anywhere.
 */
export function findSlot(
  free: Interval[],
  durMs: number,
  granMs: number,
  notBefore: number | null,
  notAfter: number | null,
): Interval | null {
  for (const iv of free) {
    const s = ceilTo(Math.max(iv.start, notBefore ?? iv.start), granMs);
    if (s + durMs > iv.end) continue;
    if (notAfter != null && s + durMs > notAfter) return null; // free is sorted: later is worse
    return { start: s, end: s + durMs };
  }
  return null;
}
