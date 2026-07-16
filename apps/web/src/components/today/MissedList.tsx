import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import type { TaskViewDTO } from '@timeblock/shared';
import { useRescheduleTask, useUnscheduleTask } from '../../hooks.js';
import { fmtDur } from './format.js';
import { listItem } from '../../lib/motion.js';

function MissedRow({ task, label }: { task: TaskViewDTO; label: string }) {
  const reschedule = useRescheduleTask();
  const drop = useUnscheduleTask();
  const busy = reschedule.isPending || drop.isPending;
  return (
    <motion.li
      layout
      variants={listItem}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/25 bg-amber-500/[0.06] px-3.5 py-2.5"
    >
      <div className="min-w-0">
        <Link to={`/tasks?task=${task.id}`} className="truncate block text-sm font-medium text-[var(--g-text)] hover:underline">
          {task.content}
        </Link>
        <p className="text-xs text-amber-300/80">
          {label}
          {task.projectName ? ` · ${task.projectName}` : ''} · {fmtDur(task.durationMin)}
        </p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={() => reschedule.mutate(task.id)}
          disabled={busy}
          className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-900 hover:bg-white disabled:opacity-50"
        >
          Reschedule
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={() => drop.mutate(task.id)}
          disabled={busy}
          className="rounded-lg border border-[var(--g-border)] bg-transparent px-2.5 py-1 text-xs font-medium text-[var(--g-text-faint)] hover:text-[var(--g-text)] disabled:opacity-50"
        >
          Drop
        </motion.button>
      </div>
    </motion.li>
  );
}

export default function MissedList({ items }: { items: { t: TaskViewDTO; label: string }[] }) {
  return (
    <ul className="space-y-2">
      <AnimatePresence initial={false}>
        {items.map(({ t, label }) => (
          <MissedRow key={t.id} task={t} label={label} />
        ))}
      </AnimatePresence>
    </ul>
  );
}
