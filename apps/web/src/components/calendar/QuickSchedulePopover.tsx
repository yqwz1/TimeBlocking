import { useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { CalendarPlus } from 'lucide-react';
import { useScheduleTaskAt, useTasks } from '../../hooks.js';
import { popoverVariants } from '../../lib/motion.js';

const PRIORITY_LABEL: Record<number, string> = { 4: 'Urgent', 3: 'High', 2: 'Medium', 1: 'Low' };
const PRIORITY_COLOR: Record<number, string> = {
  4: 'text-rose-600 bg-rose-100 dark:text-rose-300 dark:bg-rose-500/15',
  3: 'text-amber-600 bg-amber-100 dark:text-amber-300 dark:bg-amber-500/15',
  2: 'text-sky-600 bg-sky-100 dark:text-sky-300 dark:bg-sky-500/15',
  1: 'text-slate-500 bg-slate-100 dark:text-neutral-400 dark:bg-neutral-800',
};

export default function QuickSchedulePopover({
  date,
  anchor,
  onClose,
  onScheduled,
}: {
  date: Date;
  anchor: { x: number; y: number };
  onClose: () => void;
  onScheduled?: (taskId: string) => void;
}) {
  const { data: tasks } = useTasks('unscheduled');
  const scheduleAt = useScheduleTaskAt();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const top5 = useMemo(
    () => (tasks ?? []).slice().sort((a, b) => b.priority - a.priority).slice(0, 5),
    [tasks],
  );

  const width = 260;
  const left = Math.min(Math.max(12, anchor.x - width / 2), window.innerWidth - width - 12);
  const top = Math.min(anchor.y + 8, window.innerHeight - 260);
  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <>
      <motion.div
        className="fixed inset-0 z-40"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.div
        variants={popoverVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        style={{ left, top, transformOrigin: 'top center' }}
        className="fixed z-50 w-[260px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-3 py-2 dark:border-neutral-800">
          <p className="text-xs font-semibold text-slate-600 dark:text-neutral-300">Schedule at {timeStr}</p>
        </div>
        {top5.length === 0 ? (
          <p className="px-3 py-4 text-xs text-slate-400 dark:text-neutral-500">No unscheduled tasks</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto py-1">
            {top5.map((t) => (
              <li key={t.id}>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    const start = date;
                    const end = new Date(start.getTime() + t.durationMin * 60_000);
                    scheduleAt.mutate({ id: t.id, startUtc: start.toISOString(), endUtc: end.toISOString() });
                    onScheduled?.(t.id);
                    onClose();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 dark:text-neutral-300 dark:hover:bg-white/5"
                >
                  <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold ${PRIORITY_COLOR[t.priority] ?? PRIORITY_COLOR[1]}`}>
                    {PRIORITY_LABEL[t.priority] ?? 'Low'}
                  </span>
                  <span className="truncate flex-1">{t.content}</span>
                  <CalendarPlus size={12} className="shrink-0 text-slate-300 dark:text-neutral-600" />
                </motion.button>
              </li>
            ))}
          </ul>
        )}
      </motion.div>
    </>
  );
}
