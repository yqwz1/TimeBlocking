import { useState } from 'react';
import { DateTime } from 'luxon';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Hand-rolled 7x6 month grid for quick date navigation (toolbar popover + rail). */
export default function MiniMonth({
  value,
  onSelect,
}: {
  value: DateTime;
  onSelect: (date: DateTime) => void;
}) {
  const [cursor, setCursor] = useState(() => value.startOf('month'));
  const today = DateTime.now().startOf('day');

  const gridStart = cursor.startOf('month').startOf('week');
  const days = Array.from({ length: 42 }, (_, i) => gridStart.plus({ days: i }));

  return (
    <div className="w-64 select-none">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCursor(cursor.minus({ months: 1 }))}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-neutral-500 dark:hover:bg-white/5 dark:hover:text-neutral-300"
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-slate-700 dark:text-neutral-200">{cursor.toFormat('LLLL yyyy')}</span>
        <button
          type="button"
          onClick={() => setCursor(cursor.plus({ months: 1 }))}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-neutral-500 dark:hover:bg-white/5 dark:hover:text-neutral-300"
          aria-label="Next month"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d) => {
          const inMonth = d.month === cursor.month;
          const isToday = d.hasSame(today, 'day');
          const isSelected = d.hasSame(value, 'day');
          return (
            <button
              type="button"
              key={d.toISODate()}
              onClick={() => onSelect(d)}
              className={[
                'flex h-7 w-full items-center justify-center rounded-md text-xs transition',
                !inMonth ? 'text-slate-300 dark:text-neutral-600' : 'text-slate-700 dark:text-neutral-200',
                isSelected ? 'bg-teal-600 text-white font-semibold' : isToday ? 'bg-teal-50 text-teal-600 font-semibold dark:bg-teal-500/15 dark:text-teal-300' : 'hover:bg-slate-100 dark:hover:bg-white/5',
              ].join(' ')}
            >
              {d.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
