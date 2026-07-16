import { DateTime } from 'luxon';
import type { DayResultDTO } from '@timeblock/shared';
import { useStreakCalendar } from '../../hooks.js';
import { SectionCard } from './SectionCard.js';

const WEEKS = 12;

function cellColor(day: DayResultDTO | undefined): string {
  if (!day) return 'var(--g-surface-2)';
  if (day.result === 'met') {
    const ratio = day.plannedCount > 0 ? day.doneCount / day.plannedCount : 1;
    const alpha = 0.35 + 0.65 * Math.min(1, ratio);
    return `rgba(52, 211, 153, ${alpha})`;
  }
  if (day.result === 'freeze') return 'rgba(34, 211, 238, 0.75)';
  if (day.result === 'missed') return 'rgba(251, 113, 133, 0.7)';
  return 'var(--g-surface-2)'; // rest
}

function cellTitle(date: string, day: DayResultDTO | undefined): string {
  const label = DateTime.fromISO(date).toFormat('ccc LLL d');
  if (!day) return `${label} — no data`;
  const resultLabel = { met: 'met', freeze: 'protected by freeze', missed: 'missed', rest: 'rest day' }[day.result];
  return `${label} — ${resultLabel} · ${day.doneCount}/${day.plannedCount} done · streak ${day.streakAfter}`;
}

export default function StreakHeatmap() {
  const { data } = useStreakCalendar(WEEKS);
  const byDate = new Map((data ?? []).map((d) => [d.date, d]));

  const today = DateTime.local().startOf('day');
  const thisMonday = today.set({ weekday: 1 });
  const firstMonday = thisMonday.minus({ weeks: WEEKS - 1 });
  const columns = Array.from({ length: WEEKS }, (_, w) => firstMonday.plus({ weeks: w }));

  return (
    <SectionCard title="Streak calendar">
      <div className="flex gap-[3px] overflow-x-auto pb-1">
        {columns.map((monday, w) => (
          <div key={w} className="flex flex-col gap-[3px]">
            {Array.from({ length: 7 }, (_, d) => {
              const dt = monday.plus({ days: d });
              const date = dt.toISODate()!;
              const isFuture = dt > today;
              const day = byDate.get(date);
              return (
                <div
                  key={d}
                  title={isFuture ? undefined : cellTitle(date, day)}
                  className="h-3 w-3 rounded-[3px]"
                  style={{ background: isFuture ? 'transparent' : cellColor(day) }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3 text-[10px] text-[var(--g-text-faint)]">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: 'rgba(52, 211, 153, 0.9)' }} /> met
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: 'rgba(34, 211, 238, 0.75)' }} /> freeze
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: 'rgba(251, 113, 133, 0.7)' }} /> missed
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: 'var(--g-surface-2)' }} /> rest
        </span>
      </div>
    </SectionCard>
  );
}
