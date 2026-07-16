import { useMemo } from 'react';
import { DateTime } from 'luxon';
import { AlertTriangle, CheckCircle2, Circle, ListTodo } from 'lucide-react';
import type { TaskDTO } from '@timeblock/shared';
import { isOverdue } from './taskDisplay.js';
import TaskCard from './TaskCard.js';

function StatTile({ icon: Icon, label, value, tone }: { icon: typeof Circle; label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className={`mb-2 inline-flex rounded-md p-1.5 ${tone}`}>
        <Icon size={16} />
      </div>
      <p className="text-2xl font-bold text-slate-900 dark:text-neutral-100">{value}</p>
      <p className="text-xs text-slate-400 dark:text-neutral-500">{label}</p>
    </div>
  );
}

export default function TasksDashboard({ tasks, onOpenTask }: { tasks: TaskDTO[]; onOpenTask: (id: string) => void }) {
  const stats = useMemo(() => {
    const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
    const overdue = open.filter((t) => isOverdue(t.dueDate, t.status));
    const weekAgo = DateTime.now().minus({ days: 7 }).toISO();
    const doneThisWeek = tasks.filter((t) => t.status === 'done' && t.completedAt && t.completedAt >= weekAgo!);
    const inProgress = open.filter((t) => t.status === 'in_progress');
    return { open: open.length, overdue, doneThisWeek, inProgress };
  }, [tasks]);

  const byProject = useMemo(() => {
    const m = new Map<string, { name: string; color: string | null; total: number; done: number }>();
    for (const t of tasks) {
      const key = t.projectId ?? 'inbox';
      if (!m.has(key)) m.set(key, { name: t.projectName ?? 'Inbox', color: t.projectColor, total: 0, done: 0 });
      const g = m.get(key)!;
      g.total++;
      if (t.status === 'done') g.done++;
    }
    return [...m.values()].filter((g) => g.total > 0).sort((a, b) => b.total - a.total);
  }, [tasks]);

  const upcoming3d = useMemo(() => {
    const today = DateTime.now().startOf('day');
    const end = today.plus({ days: 3 }).toISODate()!;
    return tasks
      .filter((t) => t.dueDate && t.status !== 'done' && t.status !== 'cancelled' && t.dueDate >= today.toISODate()! && t.dueDate <= end)
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  }, [tasks]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={ListTodo} label="Open tasks" value={stats.open} tone="bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300" />
        <StatTile icon={AlertTriangle} label="Overdue" value={stats.overdue.length} tone="bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300" />
        <StatTile icon={Circle} label="In progress" value={stats.inProgress.length} tone="bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300" />
        <StatTile icon={CheckCircle2} label="Done this week" value={stats.doneThisWeek.length} tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300" />
      </div>

      {byProject.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-neutral-200">Progress by project</h3>
          <div className="space-y-2.5">
            {byProject.map((g) => {
              const pct = g.total > 0 ? Math.round((g.done / g.total) * 100) : 0;
              return (
                <div key={g.name}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-slate-600 dark:text-neutral-300">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: g.color ?? '#94a3b8' }} />
                      {g.name}
                    </span>
                    <span className="text-slate-400 dark:text-neutral-500">
                      {g.done}/{g.total}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
                    <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {stats.overdue.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-rose-600 dark:text-rose-400">
            <AlertTriangle size={14} /> Overdue
          </h3>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {stats.overdue.slice(0, 9).map((t) => (
              <TaskCard key={t.id} task={t} onOpen={onOpenTask} />
            ))}
          </div>
        </div>
      )}

      {upcoming3d.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-neutral-200">Next 3 days</h3>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming3d.map((t) => (
              <TaskCard key={t.id} task={t} onOpen={onOpenTask} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
