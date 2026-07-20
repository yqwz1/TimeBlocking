import { motion } from 'motion/react';
import { CheckSquare, Clock, CornerDownRight, Pin } from 'lucide-react';
import type { TaskDTO } from '@timeblock/shared';
import { useLabelColorMap, useUpdateTask } from '../../hooks.js';
import { listItem, springs } from '../../lib/motion.js';
import { Bell, BlockedBadge, DifficultyBadge, DueChip, formatDuration, LabelChip, Link2, MetaChip, Paperclip, PriorityBadge } from './taskDisplay.js';
import { useTaskHoverPreview } from './TaskHoverPreview.js';

export default function TaskCard({
  task,
  onOpen,
  isDragging = false,
  parentContent,
}: {
  task: TaskDTO;
  onOpen: (id: string) => void;
  isDragging?: boolean;
  parentContent?: string | null;
}) {
  const labelColors = useLabelColorMap();
  const update = useUpdateTask();
  const isDone = task.status === 'done';
  const hover = useTaskHoverPreview<HTMLParagraphElement>(task);
  return (
    <>
    <motion.div
      layout
      variants={listItem}
      initial="initial"
      animate={isDragging ? { opacity: 0.5, scale: 0.97 } : 'animate'}
      exit="exit"
      whileHover={isDragging ? undefined : { y: -2 }}
      transition={springs.snappy}
      onClick={() => onOpen(task.id)}
      className={`group relative cursor-pointer rounded-lg border bg-white p-3 shadow-sm transition-[border-color,box-shadow] hover:border-teal-300 hover:shadow-md dark:bg-neutral-900 dark:hover:border-teal-500/50 ${
        isDragging ? 'border-teal-300 ring-2 ring-teal-300/50 dark:border-teal-500/50 dark:ring-teal-500/40' : 'border-slate-200 dark:border-neutral-800'
      }`}
      style={task.color ? { borderLeftColor: task.color, borderLeftWidth: 3 } : undefined}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          update.mutate({ id: task.id, patch: { pinned: !task.pinned } });
        }}
        aria-label={task.pinned ? 'Unpin task' : 'Pin task'}
        title={task.pinned ? 'Unpin task' : 'Pin task'}
        className={`absolute right-2 top-2 rounded p-0.5 transition-opacity ${
          task.pinned ? 'text-amber-500 opacity-100' : 'text-slate-300 opacity-0 hover:text-amber-500 group-hover:opacity-100 dark:text-neutral-600'
        }`}
      >
        <Pin size={13} fill={task.pinned ? 'currentColor' : 'none'} />
      </button>
      {parentContent && (
        <p className="mb-1 flex items-center gap-1 truncate text-[10px] font-medium uppercase tracking-wide text-teal-500/80 dark:text-teal-400/70">
          <CornerDownRight size={10} className="shrink-0" />
          <span className="truncate">{parentContent}</span>
        </p>
      )}
      <p
        ref={hover.ref}
        onMouseEnter={hover.onMouseEnter}
        onMouseLeave={hover.onMouseLeave}
        className={`mb-1.5 inline-block break-words text-sm font-medium ${isDone ? 'text-slate-400 line-through dark:text-neutral-500' : 'text-slate-800 dark:text-neutral-100'}`}
      >
        {task.content}
      </p>
      {task.description && (
        <p className="mb-1.5 line-clamp-2 break-words text-xs text-slate-500 dark:text-neutral-400">{task.description}</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {task.projectName && (
          <span className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-neutral-500">
            {task.projectColor && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: task.projectColor }} />}
            {task.projectName}
          </span>
        )}
        <DueChip dueDate={task.dueDate} status={task.status} />
        <PriorityBadge priority={task.priority} />
        <DifficultyBadge difficulty={task.difficulty} />
        {task.isBlocked && <BlockedBadge />}
        {task.durationMin != null && task.durationMin > 0 && <MetaChip icon={Clock}>{formatDuration(task.durationMin)}</MetaChip>}
        {task.labels.slice(0, 3).map((l) => (
          <LabelChip key={l} name={l} color={labelColors.get(l)} />
        ))}
        {task.labels.length > 3 && <span className="text-[10px] text-slate-400 dark:text-neutral-500">+{task.labels.length - 3}</span>}
        {task.subtaskCount > 0 && (
          <MetaChip icon={CheckSquare}>
            {task.subtaskDoneCount}/{task.subtaskCount}
          </MetaChip>
        )}
        {task.attachmentCount > 0 && <MetaChip icon={Paperclip}>{task.attachmentCount}</MetaChip>}
        {task.links.length > 0 && <MetaChip icon={Link2}>{task.links.length}</MetaChip>}
        {task.reminderCount > 0 && <MetaChip icon={Bell}>{task.reminderCount}</MetaChip>}
      </div>
    </motion.div>
    {hover.portal}
    </>
  );
}
