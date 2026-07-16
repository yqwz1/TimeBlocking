import { AlertTriangle } from 'lucide-react';
import { useUpcomingTasks } from '../../hooks.js';
import { formatDue } from './taskDisplay.js';
import TaskCard from './TaskCard.js';

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function UpcomingView({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const { data, isLoading } = useUpcomingTasks(14);
  if (isLoading || !data) return <p className="text-sm text-slate-400 dark:text-neutral-500">Loading…</p>;

  const dates = Object.keys(data.byDate).sort();

  if (!data.overdue.length && !dates.length) {
    return <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400 dark:border-neutral-800 dark:text-neutral-500">Nothing due in the next two weeks.</p>;
  }

  return (
    <div className="space-y-6">
      {data.overdue.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
            <AlertTriangle size={13} /> Overdue ({data.overdue.length})
          </h3>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {data.overdue.map((t) => (
              <TaskCard key={t.id} task={t} onOpen={onOpenTask} />
            ))}
          </div>
        </div>
      )}
      {dates.map((date) => (
        <div key={date}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">{cap(formatDue(date))}</h3>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {data.byDate[date].map((t) => (
              <TaskCard key={t.id} task={t} onOpen={onOpenTask} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
