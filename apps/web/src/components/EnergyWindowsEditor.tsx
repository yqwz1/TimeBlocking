import type { EnergyRange, EnergyWindows, WeekdayKey } from '@timeblock/shared';
import { WEEKDAY_KEYS } from '@timeblock/shared';

const LABELS: Record<WeekdayKey, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

export default function EnergyWindowsEditor({ value, onChange }: { value: EnergyWindows; onChange: (next: EnergyWindows) => void }) {
  const setDay = (key: WeekdayKey, ranges: EnergyRange[]) => onChange({ ...value, [key]: ranges });

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400 dark:text-neutral-500">
        Mark your <span className="font-medium text-teal-500 dark:text-teal-400">peak</span> focus hours and{' '}
        <span className="font-medium text-slate-500 dark:text-neutral-400">low</span>-energy hours. Deep work is steered into peaks; shallow work
        fills lows. Unmarked time is treated as normal.
      </p>
      {WEEKDAY_KEYS.map((key) => {
        const ranges = value[key];
        return (
          <div key={key} className="flex flex-wrap items-start gap-2 border-b border-slate-100 pb-2 text-sm dark:border-neutral-800">
            <span className="w-10 pt-1.5 font-medium text-slate-600 dark:text-neutral-400">{LABELS[key]}</span>
            <div className="flex flex-1 flex-col gap-1.5">
              {ranges.length === 0 && <span className="pt-1.5 text-xs text-slate-300 dark:text-neutral-600">no bands</span>}
              {ranges.map((r, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <select
                    value={r.level}
                    onChange={(e) => setDay(key, ranges.map((x, j) => (j === i ? { ...x, level: e.target.value as EnergyRange['level'] } : x)))}
                    className="rounded-md border border-slate-300 px-1.5 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  >
                    <option value="peak">Peak</option>
                    <option value="low">Low</option>
                  </select>
                  <input
                    type="time"
                    value={r.start}
                    onChange={(e) => setDay(key, ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                    className="rounded-md border border-slate-300 px-1.5 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                  <span className="text-slate-400 dark:text-neutral-500">–</span>
                  <input
                    type="time"
                    value={r.end}
                    onChange={(e) => setDay(key, ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                    className="rounded-md border border-slate-300 px-1.5 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                  <button
                    type="button"
                    onClick={() => setDay(key, ranges.filter((_, j) => j !== i))}
                    className="rounded px-1.5 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-red-500 dark:text-neutral-500 dark:hover:bg-white/5 dark:hover:text-red-400"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setDay(key, [...ranges, { start: '09:00', end: '11:00', level: 'peak' }])}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5"
            >
              + Band
            </button>
          </div>
        );
      })}
    </div>
  );
}
