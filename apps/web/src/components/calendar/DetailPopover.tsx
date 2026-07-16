import { useEffect } from 'react';
import { motion } from 'motion/react';
import type { ScheduleItemDTO } from '@timeblock/shared';
import { Check, ExternalLink, Lock, MapPin, Pencil, Trash2, Unlock, Video, X } from 'lucide-react';
import { useCompleteTask, useDeleteEvent, useDeleteTask, useLockBlock, useUnlockBlock, useUnscheduleTask } from '../../hooks.js';
import { popoverVariants } from '../../lib/motion.js';
import { STYLES, priorityColor, styleKey } from './EventCard.js';

const PRIORITY_LABEL: Record<number, string> = { 4: 'Urgent', 3: 'High', 2: 'Medium', 1: 'Low' };

export default function DetailPopover({
  item,
  anchor,
  onClose,
  onEdit,
}: {
  item: ScheduleItemDTO;
  anchor: { x: number; y: number };
  onClose: () => void;
  onEdit?: (taskId: string) => void;
}) {
  const complete = useCompleteTask();
  const unschedule = useUnscheduleTask();
  const lock = useLockBlock();
  const unlock = useUnlockBlock();
  const deleteTask = useDeleteTask();
  const deleteEvent = useDeleteEvent();
  const isEvent = item.kind === 'event';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const width = 280;
  const left = Math.min(Math.max(12, anchor.x - width / 2), window.innerWidth - width - 12);
  const top = Math.min(anchor.y + 12, window.innerHeight - 240);
  const s = STYLES[styleKey(item)];
  const dot = priorityColor(item.priority);

  const start = new Date(item.start);
  const end = new Date(item.end);
  const dateStr = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = `${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  const mins = Math.round((end.getTime() - start.getTime()) / 60000);

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
        className="fixed z-50 w-[280px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2 px-4 pt-3" style={{ borderLeft: `4px solid ${s.accent}` }}>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-800 dark:text-neutral-100">
              {item.locked && <Lock size={13} className="shrink-0 text-slate-400 dark:text-neutral-500" />}
              <span className="truncate">{item.title}</span>
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">
              {dateStr} · {timeStr}
            </p>
          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-0.5 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-neutral-500 dark:hover:bg-white/5 dark:hover:text-neutral-300"
          >
            <X size={14} />
          </motion.button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 text-xs text-slate-400 dark:text-neutral-500">
          {dot && item.priority && (
            <span className="flex items-center gap-1 font-semibold" style={{ color: dot }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
              {PRIORITY_LABEL[item.priority] ?? 'Low'}
            </span>
          )}
          {item.projectName && <span>{item.projectName}</span>}
          <span>{mins} min</span>
          {item.dueDate && <span>due {item.dueDate}</span>}
          {item.chunk && (
            <span>
              part {item.chunk.index + 1} of {item.chunk.count}
            </span>
          )}
          {item.kind === 'external' && <span>external calendar</span>}
          {isEvent && <span className="font-medium text-purple-500 dark:text-purple-300">Event</span>}
        </div>
        {isEvent && (item.location || item.meetingUrl || item.description) && (
          <div className="mt-2 space-y-1.5 px-4 text-xs text-slate-600 dark:text-neutral-300">
            {item.location && (
              <p className="flex items-center gap-1.5">
                <MapPin size={12} className="shrink-0 text-slate-400 dark:text-neutral-500" />
                <span className="truncate">{item.location}</span>
              </p>
            )}
            {item.meetingUrl && (
              <a
                href={item.meetingUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 font-medium text-teal-600 hover:underline dark:text-teal-400"
              >
                <Video size={12} className="shrink-0" />
                <span className="truncate">Join meeting</span>
              </a>
            )}
            {item.description && <p className="whitespace-pre-wrap text-slate-500 dark:text-neutral-400">{item.description}</p>}
          </div>
        )}
        {item.reasons && item.reasons.length > 0 && (
          <div className="mt-2.5 px-4">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Why here</p>
            <ul className="space-y-1">
              {item.reasons.map((r, i) => (
                <li key={i} className="flex gap-1.5 text-xs text-slate-600 dark:text-neutral-400">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-teal-400 dark:bg-teal-500" />
                  <span>
                    {r.label}
                    {r.detail ? <span className="text-slate-400 dark:text-neutral-500"> · {r.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {item.kind !== 'external' && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-800/40">
            {item.kind === 'task' && item.taskId && onEdit && (
              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={() => onEdit(item.taskId!)}
                className="flex items-center gap-1 rounded-md bg-slate-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 dark:bg-neutral-700 dark:hover:bg-neutral-600"
              >
                <Pencil size={12} /> Edit
              </motion.button>
            )}
            {item.kind === 'task' && item.taskId && item.status !== 'done' && (
              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  complete.mutate(item.taskId!);
                  onClose();
                }}
                className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Check size={12} /> Complete
              </motion.button>
            )}
            {item.kind === 'task' &&
              (item.locked ? (
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  onClick={() => {
                    unlock.mutate(item.id);
                    onClose();
                  }}
                  className="flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-white dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  <Unlock size={12} /> Unlock
                </motion.button>
              ) : (
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  onClick={() => {
                    lock.mutate(item.id);
                    onClose();
                  }}
                  className="flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-white dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  <Lock size={12} /> Lock
                </motion.button>
              ))}
            {isEvent && item.eventId && (
              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  deleteEvent.mutate(item.eventId!);
                  onClose();
                }}
                className="flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <Trash2 size={12} /> Delete
              </motion.button>
            )}
            {item.kind === 'task' && item.taskId && (
              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  unschedule.mutate(item.taskId!);
                  onClose();
                }}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-500 hover:bg-white dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                Unschedule
              </motion.button>
            )}
            {item.kind === 'task' && item.taskId && (
              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={() => {
                  deleteTask.mutate(item.taskId!);
                  onClose();
                }}
                className="flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <Trash2 size={12} /> Delete
              </motion.button>
            )}
            {item.links?.[0] && (
              <a
                href={item.links[0].url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-500 hover:bg-white dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                {item.links[0].title || 'Link'} <ExternalLink size={11} />
              </a>
            )}
          </div>
        )}
      </motion.div>
    </>
  );
}
