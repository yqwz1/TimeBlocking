import type { WorkingHours } from '@timeblock/shared';
import { WEEKDAY_KEYS } from '@timeblock/shared';

const LABELS: Record<(typeof WEEKDAY_KEYS)[number], string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

export default function WorkingHoursEditor({ value, onChange }: { value: WorkingHours; onChange: (next: WorkingHours) => void }) {
  return (
    <div className="space-y-2">
      {WEEKDAY_KEYS.map((key) => {
        const range = value[key][0];
        const enabled = !!range;
        return (
          <div key={key} className="flex items-center gap-3 text-sm">
            <label className="flex w-24 items-center gap-2">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) =>
                  onChange({
                    ...value,
                    [key]: e.target.checked ? [{ start: '09:00', end: '17:00' }] : [],
                  })
                }
              />
              {LABELS[key]}
            </label>
            <input
              type="time"
              disabled={!enabled}
              value={range?.start ?? '09:00'}
              onChange={(e) => onChange({ ...value, [key]: [{ start: e.target.value, end: range?.end ?? '17:00' }] })}
              className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
            <span className="text-slate-400 dark:text-neutral-500">to</span>
            <input
              type="time"
              disabled={!enabled}
              value={range?.end ?? '17:00'}
              onChange={(e) => onChange({ ...value, [key]: [{ start: range?.start ?? '09:00', end: e.target.value }] })}
              className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
          </div>
        );
      })}
    </div>
  );
}
