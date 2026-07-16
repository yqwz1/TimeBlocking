import { DateTime } from 'luxon';
import type { WeekdayKey } from '@timeblock/shared';
import { WEEKDAY_KEYS } from '@timeblock/shared';

const RRULE_TOKENS: Record<string, WeekdayKey> = {
  MO: 'mon',
  TU: 'tue',
  WE: 'wed',
  TH: 'thu',
  FR: 'fri',
  SA: 'sat',
  SU: 'sun',
};
const TOKEN_BY_KEY = Object.fromEntries(Object.entries(RRULE_TOKENS).map(([t, k]) => [k, t])) as Record<
  WeekdayKey,
  string
>;

export function daysToRrule(days: WeekdayKey[]): string {
  const unique = [...new Set(days)];
  if (unique.length === 7) return 'FREQ=DAILY';
  const ordered = WEEKDAY_KEYS.filter((k) => unique.includes(k));
  return `FREQ=WEEKLY;BYDAY=${ordered.map((k) => TOKEN_BY_KEY[k]).join(',')}`;
}

export function rruleToDays(rrule: string): WeekdayKey[] {
  if (/FREQ=DAILY/i.test(rrule)) return [...WEEKDAY_KEYS];
  const m = /BYDAY=([A-Z,]+)/i.exec(rrule);
  if (!m) return [];
  return m[1]
    .toUpperCase()
    .split(',')
    .map((t) => RRULE_TOKENS[t])
    .filter(Boolean);
}

/** Does the habit recur on this local date? */
export function rruleMatchesDate(rrule: string, dateIso: string, tz: string): boolean {
  const days = rruleToDays(rrule);
  const weekday = DateTime.fromISO(dateIso, { zone: tz }).weekday; // 1 = Monday
  return days.includes(WEEKDAY_KEYS[weekday - 1]);
}

/** Local Monday of the week containing dateIso. */
export function weekStartOf(dateIso: string, tz: string): string {
  return DateTime.fromISO(dateIso, { zone: tz }).startOf('week').toISODate()!;
}
