import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Draggable } from '@fullcalendar/interaction';
import { AnimatePresence, motion } from 'motion/react';
import type { TaskViewDTO } from '@timeblock/shared';
import { CalendarClock, EyeOff, ExternalLink, GripVertical, PartyPopper, Pencil } from 'lucide-react';
import { useCompleteTask, useRescheduleTask, useTasks, useUnscheduleTask } from '../hooks.js';
import { listItem } from '../lib/motion.js';

const TABS: { key: TaskViewDTO['view']; label: string }[] = [
  { key: 'unscheduled', label: 'Unscheduled' },
  { key: 'at_risk', label: 'At risk' },
  { key: 'unplaceable', label: "Won't fit" },
  { key: 'missed', label: 'Missed' },
];

function priorityBadge(p: number) {
  const labels: Record<number, string> = { 4: 'Urgent', 3: 'High', 2: 'Medium', 1: 'Low' };
  const colors: Record<number, string> = {
    4: 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
    3: 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    2: 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
    1: 'bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400',
  };
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${colors[p] ?? colors[1]}`}>{labels[p] ?? 'Low'}</span>;
}

function TaskRow({ task }: { task: TaskViewDTO }) {
  const complete = useCompleteTask();
  const reschedule = useRescheduleTask();
  const unschedule = useUnscheduleTask();

  return (
    <motion.li
      layout
      variants={listItem}
      initial="initial"
      animate="animate"
      exit="exit"
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ layout: { duration: 0.18 } }}
      drag={false}
      className="tb-draggable group cursor-grab rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm transition hover:border-teal-300 hover:shadow active:cursor-grabbing dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-teal-500/50"
      data-task-id={task.id}
      data-title={task.content}
      data-duration={task.durationMin}
      title="Drag onto the calendar to schedule at a specific time"
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-start gap-1.5 text-sm font-medium text-slate-800 dark:text-neutral-100">
          <GripVertical size={14} className="mt-0.5 shrink-0 text-slate-300 group-hover:text-teal-400 dark:text-neutral-600 dark:group-hover:text-teal-400" aria-hidden />
          <span className="min-w-0 break-words">{task.content}</span>
        </span>
        <span className="shrink-0">{priorityBadge(task.priority)}</span>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 pl-5 text-xs text-slate-400 dark:text-neutral-500">
        {task.projectName && <span className="text-slate-500 dark:text-neutral-400">{task.projectName}</span>}
        {task.dueDate && <span>due {task.dueDate}</span>}
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">{task.durationMin}m</span>
      </div>
      <div className="flex items-center gap-1.5 pl-5">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => complete.mutate(task.id)}
          className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-emerald-700 dark:bg-emerald-600/90 dark:hover:bg-emerald-600"
        >
          Done
        </motion.button>
        <div className="ml-auto flex items-center gap-1">
          {task.view !== 'scheduled' && (
            <motion.button
              whileTap={{ scale: 0.88 }}
              onClick={() => reschedule.mutate(task.id)}
              title="Auto-schedule"
              className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-teal-600 transition hover:border-teal-300 hover:bg-teal-50 dark:border-neutral-800 dark:text-teal-300 dark:hover:bg-teal-500/10"
            >
              <CalendarClock size={13} />
            </motion.button>
          )}
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={() => unschedule.mutate(task.id)}
            title="Skip / unschedule"
            className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5"
          >
            <EyeOff size={13} />
          </motion.button>
          <Link
            to={`/tasks?task=${task.id}`}
            title="Edit task"
            className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5"
          >
            <Pencil size={13} />
          </Link>
          {task.links[0] && (
            <a
              href={task.links[0].url}
              target="_blank"
              rel="noreferrer"
              title={task.links[0].title || 'Open link'}
              className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5"
            >
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>
    </motion.li>
  );
}

export default function TaskSidebar() {
  const [tab, setTab] = useState<TaskViewDTO['view']>('unscheduled');
  const { data: allTasks, isLoading } = useTasks('all');
  const listRef = useRef<HTMLUListElement>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of allTasks ?? []) c[t.view] = (c[t.view] ?? 0) + 1;
    return c;
  }, [allTasks]);

  const visible = useMemo(
    () =>
      (allTasks ?? [])
        .filter((t) => t.view === tab)
        .slice()
        .sort((a, b) => b.priority - a.priority || (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
    [allTasks, tab],
  );

  // Make task cards draggable onto the calendar. One Draggable per mount reads
  // the data-* attributes off whichever cards are currently rendered.
  useEffect(() => {
    if (!listRef.current) return;
    const draggable = new Draggable(listRef.current, {
      itemSelector: '.tb-draggable',
      eventData: (el) => ({
        title: el.getAttribute('data-title') ?? 'Task',
        duration: { minutes: Number(el.getAttribute('data-duration')) || 30 },
      }),
    });
    return () => draggable.destroy();
  }, [visible.length > 0]);

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => {
          const n = counts[t.key] ?? 0;
          const active = tab === t.key;
          return (
            <motion.button
              key={t.key}
              whileTap={{ scale: 0.94 }}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition ${
                active ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'
              }`}
            >
              {t.label}
              {n > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[10px] font-bold ${
                    active ? 'bg-white/25 text-white' : 'bg-white text-slate-500 dark:bg-neutral-900 dark:text-neutral-400'
                  }`}
                >
                  {n}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
      {isLoading ? (
        <p className="text-sm text-slate-400 dark:text-neutral-500">Loading…</p>
      ) : !visible.length ? (
        <motion.div
          key="empty"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400 dark:border-neutral-800 dark:text-neutral-500"
        >
          <PartyPopper size={18} className="text-slate-300 dark:text-neutral-600" />
          Nothing here
        </motion.div>
      ) : (
        <ul ref={listRef} className="space-y-2">
          <AnimatePresence initial={false}>
            {visible.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
