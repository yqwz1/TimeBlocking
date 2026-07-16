import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarClock, CheckSquare, Clock } from 'lucide-react';
import type { TaskDTO } from '@timeblock/shared';
import { useLabelColorMap } from '../../hooks.js';
import {
  Bell,
  BlockedBadge,
  DifficultyBadge,
  DueChip,
  formatDuration,
  LabelChip,
  Link2,
  Paperclip,
  PriorityBadge,
  StatusBadge,
} from './taskDisplay.js';

const HOVER_DELAY_MS = 600;
const CARD_WIDTH = 288;
const CARD_MAX_HEIGHT = 320;

function relative(iso: string | null): string | null {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso);
  return dt.isValid ? dt.toRelative() : null;
}

function TaskHoverCard({ task, top, left }: { task: TaskDTO; top: number; left: number }) {
  const labelColors = useLabelColorMap();
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.12 }}
      style={{ position: 'fixed', top, left, width: CARD_WIDTH, maxHeight: CARD_MAX_HEIGHT }}
      className="pointer-events-none z-[1000] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 text-left shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
    >
      <p className="mb-1 break-words text-sm font-semibold text-slate-800 dark:text-neutral-100">{task.content}</p>
      {task.description && (
        <p className="mb-2 whitespace-pre-wrap break-words text-xs text-slate-500 dark:text-neutral-400">{task.description}</p>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <StatusBadge status={task.status} />
        <PriorityBadge priority={task.priority} />
        <DifficultyBadge difficulty={task.difficulty} />
        <DueChip dueDate={task.dueDate} status={task.status} />
        {task.isBlocked && <BlockedBadge />}
        {task.durationMin != null && task.durationMin > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-neutral-500">
            <Clock size={10} /> {formatDuration(task.durationMin)}
          </span>
        )}
      </div>
      {task.projectName && (
        <p className="mb-1.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-neutral-400">
          {task.projectColor && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: task.projectColor }} />}
          {task.projectName}
        </p>
      )}
      {task.labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {task.labels.map((l) => (
            <LabelChip key={l} name={l} color={labelColors.get(l)} />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2.5 text-[10px] text-slate-400 dark:text-neutral-500">
        {task.subtaskCount > 0 && (
          <span className="flex items-center gap-1">
            <CheckSquare size={10} /> {task.subtaskDoneCount}/{task.subtaskCount} subtasks
          </span>
        )}
        {task.attachmentCount > 0 && (
          <span className="flex items-center gap-1">
            <Paperclip size={10} /> {task.attachmentCount}
          </span>
        )}
        {task.links.length > 0 && (
          <span className="flex items-center gap-1">
            <Link2 size={10} /> {task.links.length}
          </span>
        )}
        {task.reminderCount > 0 && (
          <span className="flex items-center gap-1">
            <Bell size={10} /> {task.reminderCount}
          </span>
        )}
      </div>
      {(task.createdAt || task.updatedAt) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5 border-t border-slate-100 pt-1.5 text-[10px] text-slate-400 dark:border-neutral-800 dark:text-neutral-500">
          {task.createdAt && (
            <span className="flex items-center gap-1">
              <CalendarClock size={10} /> Created {relative(task.createdAt)}
            </span>
          )}
          {task.updatedAt && task.updatedAt !== task.createdAt && <span>Updated {relative(task.updatedAt)}</span>}
        </div>
      )}
    </motion.div>
  );
}

/**
 * Shows a small info card after the user hovers a task for HOVER_DELAY_MS.
 * Spread the returned handlers/ref onto the existing task element (no wrapper div,
 * so it doesn't affect list/kanban/grid layout); render `portal` once alongside it.
 */
export function useTaskHoverPreview<T extends HTMLElement = HTMLDivElement>(task: TaskDTO) {
  const ref = useRef<T>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const clear = () => {
    window.clearTimeout(timerRef.current);
  };

  const onMouseEnter = () => {
    clear();
    timerRef.current = window.setTimeout(() => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      let left = rect.left;
      if (left + CARD_WIDTH + 8 > window.innerWidth) left = Math.max(8, window.innerWidth - CARD_WIDTH - 8);
      let top = rect.bottom + 8;
      if (top + CARD_MAX_HEIGHT + 8 > window.innerHeight) top = Math.max(8, rect.top - CARD_MAX_HEIGHT - 8);
      setCoords({ top, left });
    }, HOVER_DELAY_MS);
  };

  const onMouseLeave = () => {
    clear();
    setCoords(null);
  };

  useEffect(() => clear, []);

  const portal =
    typeof document !== 'undefined'
      ? createPortal(
          <AnimatePresence>{coords && <TaskHoverCard key={task.id} task={task} top={coords.top} left={coords.left} />}</AnimatePresence>,
          document.body,
        )
      : null;

  return { ref, onMouseEnter, onMouseLeave, portal };
}
