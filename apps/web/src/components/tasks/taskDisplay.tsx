import { DateTime } from 'luxon';
import { motion } from 'motion/react';
import { Gauge, Lock, Paperclip, Bell, Link2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TaskDifficulty, TaskDTO, TaskStatus } from '@timeblock/shared';
import type { SortBy } from './types.js';

/**
 * Task title that draws an animated strike-through line as the task completes,
 * instead of the instant CSS `line-through`. Pair with a `transition-colors`
 * className so the text also fades to muted. Best for single-line titles.
 */
export function TaskTitle({ done, children, className = '' }: { done: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={`relative ${className}`}>
      {children}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 h-[1.5px] origin-left -translate-y-1/2 rounded-full bg-current"
        initial={false}
        animate={{ scaleX: done ? 1 : 0, opacity: done ? 0.65 : 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      />
    </span>
  );
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const STATUS_BADGE: Record<TaskStatus, string> = {
  backlog: 'bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400',
  todo: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
  in_progress: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
  done: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
  cancelled: 'bg-slate-100 text-slate-400 line-through dark:bg-neutral-800 dark:text-neutral-500',
};

/** Solid dot/accent color per status, keyed to STATUS_BADGE's hues — used for column headers, dots, and top-border accents. */
export const STATUS_DOT: Record<TaskStatus, string> = {
  backlog: 'bg-slate-400 dark:bg-neutral-500',
  todo: 'bg-sky-500 dark:bg-sky-400',
  in_progress: 'bg-amber-500 dark:bg-amber-400',
  done: 'bg-emerald-500 dark:bg-emerald-400',
  cancelled: 'bg-slate-400 dark:bg-neutral-500',
};

export const PRIORITY_LABEL: Record<number, string> = { 4: 'Urgent', 3: 'High', 2: 'Medium', 1: 'Low' };
export const PRIORITY_COLOR: Record<number, string> = {
  4: 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
  3: 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  2: 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
  1: 'bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400',
};

export function PriorityBadge({ priority }: { priority: number }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${PRIORITY_COLOR[priority] ?? PRIORITY_COLOR[1]}`}>{PRIORITY_LABEL[priority] ?? 'Low'}</span>;
}

export const DIFFICULTY_LABEL: Record<TaskDifficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
export const DIFFICULTY_COLOR: Record<TaskDifficulty, string> = {
  easy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  hard: 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
};

export function DifficultyBadge({ difficulty }: { difficulty: TaskDifficulty | null }) {
  if (!difficulty) return null;
  return (
    <span className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${DIFFICULTY_COLOR[difficulty]}`}>
      <Gauge size={10} /> {DIFFICULTY_LABEL[difficulty]}
    </span>
  );
}

/** Shown on a task waiting on an incomplete dependency — the scheduler is deliberately skipping it. */
export function BlockedBadge() {
  return (
    <span
      title="Waiting on another task — won't be scheduled until it's done"
      className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
    >
      <Lock size={10} /> Blocked
    </span>
  );
}

export function formatDuration(min: number | null): string {
  if (!min) return '';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${m}m` : `${h}h`;
}

export function MetaChip({ icon: Icon, children }: { icon: typeof Paperclip; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-neutral-500">
      <Icon size={10} /> {children}
    </span>
  );
}

export { Paperclip, Bell, Link2 };

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_BADGE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function isOverdue(dueDate: string | null, status: TaskStatus): boolean {
  if (!dueDate || status === 'done' || status === 'cancelled') return false;
  return dueDate < DateTime.now().toISODate()!;
}

const DIFFICULTY_RANK: Record<TaskDifficulty, number> = { hard: 3, medium: 2, easy: 1 };

/** Comparator for the "Sort by" control. 'manual' preserves drag-and-drop order (sortOrder). */
export function compareTasksBy(sortBy: SortBy): (a: TaskDTO, b: TaskDTO) => number {
  const byManual = (a: TaskDTO, b: TaskDTO) =>
    a.sortOrder - b.sortOrder || b.priority - a.priority || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
  switch (sortBy) {
    case 'priority':
      return (a, b) => b.priority - a.priority || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || byManual(a, b);
    case 'dueDate':
      return (a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || b.priority - a.priority || byManual(a, b);
    case 'difficulty':
      return (a, b) =>
        (DIFFICULTY_RANK[b.difficulty ?? 'easy'] ?? 0) - (DIFFICULTY_RANK[a.difficulty ?? 'easy'] ?? 0) ||
        b.priority - a.priority ||
        byManual(a, b);
    case 'manual':
    default:
      return byManual;
  }
}

function nextWeekday(targetWeekday: number): DateTime {
  const now = DateTime.now().startOf('day');
  const diff = ((targetWeekday - now.weekday + 7) % 7) || 7;
  return now.plus({ days: diff });
}

/** Quick-pick due dates for the date pickers: today, tomorrow, next Monday, next Saturday. */
export function quickDateOptions(): { label: string; date: string }[] {
  const now = DateTime.now().startOf('day');
  return [
    { label: 'Today', date: now.toISODate()! },
    { label: 'Tomorrow', date: now.plus({ days: 1 }).toISODate()! },
    { label: 'Next week', date: nextWeekday(1).toISODate()! },
    { label: 'Next weekend', date: nextWeekday(6).toISODate()! },
  ];
}

export function formatDue(dueDate: string | null): string {
  if (!dueDate) return '';
  const d = DateTime.fromISO(dueDate);
  const today = DateTime.now().startOf('day');
  const diff = Math.round(d.startOf('day').diff(today, 'days').days);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff < 0) return `${d.toFormat('MMM d')} (${-diff}d late)`;
  if (diff < 7) return d.toFormat('cccc');
  return d.toFormat('MMM d');
}

export function LabelChip({ name, color }: { name: string; color?: string | null }) {
  return (
    <span
      className="flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-neutral-800 dark:text-neutral-400"
      style={color ? { backgroundColor: `${color}22`, color } : undefined}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color ?? '#94a3b8' }} />
      {name}
    </span>
  );
}

export function DueChip({ dueDate, status }: { dueDate: string | null; status: TaskStatus }) {
  if (!dueDate) return null;
  const overdue = isOverdue(dueDate, status);
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${overdue ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400'}`}>
    {formatDue(dueDate)}
    </span>
  );
}
