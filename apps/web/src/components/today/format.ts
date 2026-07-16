import type { ScheduleItemDTO } from '@timeblock/shared';

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function fmtDur(min: number) {
  if (min <= 0) return '0m';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function greeting(d: Date) {
  const h = d.getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function blockMinutes(item: ScheduleItemDTO) {
  return Math.round((Date.parse(item.end) - Date.parse(item.start)) / 60000);
}
