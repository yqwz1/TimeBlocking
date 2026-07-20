import { useMemo, useState } from 'react';
import { AnimatePresence, animate, motion, useDragControls, useMotionValue, useTransform } from 'motion/react';
import { CheckSquare, ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, ChevronUp, Clock, GripVertical, Pin, Plus, Trash2 } from 'lucide-react';
import type { TaskDTO } from '@timeblock/shared';
import { useDeleteTask, useLabelColorMap, useReorderTasks, useUpdateTask } from '../../hooks.js';
import { listItem } from '../../lib/motion.js';
import { Bell, BlockedBadge, DifficultyBadge, DueChip, compareTasksBy, formatDuration, LabelChip, Link2, MetaChip, Paperclip, PriorityBadge, TaskTitle } from './taskDisplay.js';
import type { SortBy } from './types.js';
import { useTaskHoverPreview } from './TaskHoverPreview.js';
import QuickAddTask from './QuickAddTask.js';
import TaskCheckbox from './TaskCheckbox.js';

const SWIPE_DELETE_THRESHOLD = -96;

const SCHEDULE_DOT: Record<string, string> = {
  scheduled: 'bg-emerald-500',
  at_risk: 'bg-amber-500',
  unplaceable: 'bg-rose-500',
  missed: 'bg-rose-500',
  unscheduled: 'bg-slate-300 dark:bg-neutral-600',
};

const SCHEDULE_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  at_risk: 'At risk',
  unplaceable: 'Unplaceable',
  missed: 'Missed',
  unscheduled: 'Unscheduled',
};

function TaskRow({
  task,
  depth,
  siblings,
  childrenOf,
  onOpen,
  onReorder,
  reorderable,
}: {
  task: TaskDTO;
  depth: number;
  siblings: TaskDTO[];
  childrenOf: Map<string, TaskDTO[]>;
  onOpen: (id: string) => void;
  onReorder: (ids: string[]) => void;
  reorderable: boolean;
}) {
  const update = useUpdateTask();
  const del = useDeleteTask();
  const labelColors = useLabelColorMap();
  const hover = useTaskHoverPreview<HTMLSpanElement>(task);
  const [expanded, setExpanded] = useState(depth === 0);
  const [addingSub, setAddingSub] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dragging, setDragging] = useState(false);
  const swipeX = useMotionValue(0);
  const swipeControls = useDragControls();
  const backdropOpacity = useTransform(swipeX, [-24, 0], [1, 0]);
  const kids = childrenOf.get(task.id) ?? [];
  const done = task.status === 'done';
  const siblingIdx = siblings.findIndex((t) => t.id === task.id);
  const isLastSibling = siblingIdx >= 0 && siblingIdx === siblings.length - 1;
  const canMoveUp = reorderable && siblingIdx > 0;
  const canMoveDown = reorderable && siblingIdx >= 0 && siblingIdx < siblings.length - 1;
  const move = (dir: 'up' | 'down') => {
    const swapIdx = dir === 'up' ? siblingIdx - 1 : siblingIdx + 1;
    if (siblingIdx < 0 || swapIdx < 0 || swapIdx >= siblings.length) return;
    const reordered = [...siblings];
    [reordered[siblingIdx], reordered[swapIdx]] = [reordered[swapIdx], reordered[siblingIdx]];
    onReorder(reordered.map((t) => t.id));
  };
  const moveToEdge = (edge: 'top' | 'bottom') => {
    if (siblingIdx < 0) return;
    if (edge === 'top' && siblingIdx === 0) return;
    if (edge === 'bottom' && siblingIdx === siblings.length - 1) return;
    const reordered = [...siblings];
    const [moved] = reordered.splice(siblingIdx, 1);
    reordered.splice(edge === 'top' ? 0 : reordered.length, 0, moved);
    onReorder(reordered.map((t) => t.id));
  };
  const dropOnto = (draggedId: string) => {
    if (!draggedId || draggedId === task.id || siblingIdx < 0) return;
    const fromIdx = siblings.findIndex((t) => t.id === draggedId);
    if (fromIdx < 0) return; // dragged item isn't one of this row's siblings
    const reordered = [...siblings];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(fromIdx < siblingIdx ? siblingIdx - 1 : siblingIdx, 0, moved);
    onReorder(reordered.map((t) => t.id));
  };

  return (
    <>
      <li className="group relative" style={{ marginLeft: depth * 22 }}>
        {depth > 0 && (
          <>
            {/* trunk: connects to the sibling row above/below at this depth */}
            <span
              aria-hidden
              className="absolute -left-[15px] w-px bg-slate-200 dark:bg-neutral-700"
              style={{ top: 0, height: isLastSibling ? 21 : '100%' }}
            />
            {/* elbow: branches from the trunk into this row */}
            <span aria-hidden className="absolute -left-[15px] top-[21px] h-px w-[15px] bg-slate-200 dark:bg-neutral-700" />
          </>
        )}
        <motion.div
          layout
          variants={listItem}
          initial="initial"
          animate="animate"
          exit="exit"
          className={`relative overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow hover:shadow-md dark:bg-neutral-900/40 ${
            dragOver ? 'border-teal-400 ring-2 ring-teal-300/60 dark:border-teal-500 dark:ring-teal-500/40' : 'border-slate-200 dark:border-neutral-800'
          }`}
        >
        {/* delete backdrop, revealed as the row is swiped left */}
        <motion.div
          aria-hidden
          style={{ opacity: backdropOpacity }}
          className="absolute inset-0 z-0 flex items-center justify-end bg-rose-500 pr-5 text-white"
        >
          <Trash2 size={18} />
        </motion.div>
        <motion.div
          drag="x"
          dragControls={swipeControls}
          dragListener={false}
          dragConstraints={{ left: -140, right: 0 }}
          dragElastic={{ left: 0.2, right: 0 }}
          style={{
            x: swipeX,
          }}
          onPointerDown={(e) => swipeControls.start(e)}
          onDragEnd={(_e, info) => {
            if (info.offset.x <= SWIPE_DELETE_THRESHOLD && window.confirm(`Delete "${task.content}"? This can't be undone.`)) {
              animate(swipeX, -400, { duration: 0.15, ease: 'easeIn' });
              del.mutate(task.id);
            } else {
              animate(swipeX, 0, { type: 'spring', stiffness: 500, damping: 32 });
            }
          }}
          onDragOver={(e) => {
            if (!reorderable || !e.dataTransfer.types.includes('text/task-id')) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            if (!reorderable) return;
            e.preventDefault();
            setDragOver(false);
            dropOnto(e.dataTransfer.getData('text/task-id'));
          }}
          className={`relative z-10 flex items-center gap-2.5 bg-white bg-blend-normal px-3 py-1.5 pl-4 transition-[opacity,box-shadow] hover:bg-slate-50 dark:bg-neutral-900 dark:hover:bg-neutral-800 ${
            dragging ? 'opacity-50 shadow-lg ring-2 ring-teal-300/60 dark:ring-teal-500/40' : ''
          }`}
        >
          {/* left edge: solid vertical bar in the task's own color */}
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-[3px] rounded-l-xl"
            style={{ backgroundColor: task.color ?? 'transparent' }}
          />
          <span
            data-drag-handle
            draggable={reorderable}
            onPointerDown={(e) => reorderable && e.stopPropagation()}
            onDragStart={(e) => {
              if (!reorderable) return;
              e.dataTransfer.setData('text/task-id', task.id);
              e.dataTransfer.effectAllowed = 'move';
              setDragging(true);
            }}
            onDragEnd={() => setDragging(false)}
            className={`-ml-1 inline-flex shrink-0 items-center justify-center touch-none text-slate-300 transition-opacity dark:text-neutral-600 ${
              reorderable ? 'cursor-grab opacity-40 hover:opacity-100 active:cursor-grabbing group-hover:opacity-100' : 'cursor-default opacity-0'
            }`}
            title={reorderable ? 'Drag to reorder' : 'Switch to manual sort to reorder'}
            aria-hidden
          >
            <GripVertical size={15} />
          </span>
          {kids.length > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="-mx-1 shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-300"
              aria-label={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
            >
              <ChevronRight size={15} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </button>
          ) : (
            <span className="w-[15px] shrink-0" />
          )}
          <TaskCheckbox
            checked={done}
            onChange={() => update.mutate({ id: task.id, patch: { status: done ? 'todo' : 'done' } })}
          />
          {/* LEFT: title with the project name right beside it */}
          <button type="button" onClick={() => onOpen(task.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <span ref={hover.ref} onMouseEnter={hover.onMouseEnter} onMouseLeave={hover.onMouseLeave} className="min-w-0 shrink">
              <TaskTitle
                done={done}
                className={`block truncate text-[13.5px] leading-5 transition-colors ${done ? 'text-slate-400 dark:text-neutral-500' : 'font-medium text-slate-800 dark:text-neutral-100'}`}
              >
                {task.content}
              </TaskTitle>
            </span>
            {task.projectName && (
              <span className="flex min-w-0 shrink items-center gap-1 text-[10px] text-slate-400 dark:text-neutral-500">
                {task.projectColor && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: task.projectColor }} />}
                <span className="truncate">{task.projectName}</span>
              </span>
            )}
            {!done && task.view && (
              <span
                title={SCHEDULE_LABEL[task.view] ?? 'Unscheduled'}
                className={`h-2 w-2 shrink-0 rounded-full ${SCHEDULE_DOT[task.view] ?? SCHEDULE_DOT.unscheduled}`}
              />
            )}
          </button>
          {/* RIGHT: due, priority, difficulty, labels — fixed width, never squeezes the title */}
          <div className="flex shrink-0 items-center gap-1.5">
            <DueChip dueDate={task.dueDate} status={task.status} />
            <PriorityBadge priority={task.priority} />
            <DifficultyBadge difficulty={task.difficulty} />
            {task.isBlocked && <BlockedBadge />}
            {task.durationMin != null && task.durationMin > 0 && <MetaChip icon={Clock}>{formatDuration(task.durationMin)}</MetaChip>}
            {task.labels.slice(0, 2).map((l) => (
              <LabelChip key={l} name={l} color={labelColors.get(l)} />
            ))}
            {task.labels.length > 2 && <span className="text-[10px] text-slate-400 dark:text-neutral-500">+{task.labels.length - 2}</span>}
            {kids.length > 0 && (
              <MetaChip icon={CheckSquare}>
                {task.subtaskDoneCount}/{task.subtaskCount}
              </MetaChip>
            )}
            {task.attachmentCount > 0 && <MetaChip icon={Paperclip}>{task.attachmentCount}</MetaChip>}
            {task.links.length > 0 && <MetaChip icon={Link2}>{task.links.length}</MetaChip>}
            {task.reminderCount > 0 && <MetaChip icon={Bell}>{task.reminderCount}</MetaChip>}
          </div>
          {/* action buttons, revealed on hover */}
          <div className="flex shrink-0 items-center gap-1 pl-0.5">
            <button
              type="button"
              onClick={() => update.mutate({ id: task.id, patch: { pinned: !task.pinned } })}
              aria-label={task.pinned ? 'Unpin task' : 'Pin task'}
              title={task.pinned ? 'Unpin task' : 'Pin task'}
              className={`rounded p-1 transition-opacity ${
                task.pinned
                  ? 'text-amber-500 opacity-100'
                  : 'text-slate-400 opacity-0 hover:bg-slate-200 hover:text-amber-500 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-neutral-700'
              }`}
            >
              <Pin size={14} fill={task.pinned ? 'currentColor' : 'none'} />
            </button>
            <button
              type="button"
              onClick={() => setAddingSub((v) => !v)}
              className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
              title="Add subtask"
            >
              <Plus size={14} />
            </button>
            <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <button
                type="button"
                onClick={() => moveToEdge('top')}
                disabled={!canMoveUp}
                className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                title="Move to top"
                aria-label="Move to top"
              >
                <ChevronsUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => move('up')}
                disabled={!canMoveUp}
                className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                title="Move up"
                aria-label="Move up"
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => move('down')}
                disabled={!canMoveDown}
                className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                title="Move down"
                aria-label="Move down"
              >
                <ChevronDown size={14} />
              </button>
              <button
                type="button"
                onClick={() => moveToEdge('bottom')}
                disabled={!canMoveDown}
                className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                title="Move to bottom"
                aria-label="Move to bottom"
              >
                <ChevronsDown size={14} />
              </button>
            </div>
          </div>
        </motion.div>
        {addingSub && (
          <div className="px-3 pb-3 pl-4">
            <QuickAddTask
              placeholder="Add subtask…"
              defaults={{ parentId: task.id, projectId: task.projectId ?? undefined }}
              onCreated={() => {
                setAddingSub(false);
                setExpanded(true);
              }}
            />
          </div>
        )}
        </motion.div>
      </li>
      {hover.portal}
      {kids.length > 0 && (
        <AnimatePresence initial={false}>
          {expanded &&
            kids.map((k) => (
              <TaskRow key={k.id} task={k} depth={depth + 1} siblings={kids} childrenOf={childrenOf} onOpen={onOpen} onReorder={onReorder} reorderable={reorderable} />
            ))}
        </AnimatePresence>
      )}
    </>
  );
}

export default function TaskListView({
  tasks,
  onOpenTask,
  quickAddDefaults,
  showCompleted = false,
  sortBy = 'manual',
}: {
  tasks: TaskDTO[];
  onOpenTask: (id: string) => void;
  quickAddDefaults?: { projectId?: string };
  showCompleted?: boolean;
  sortBy?: SortBy;
}) {
  const reorder = useReorderTasks();
  const reorderable = sortBy === 'manual';
  const { roots, childrenOf } = useMemo(() => {
    // Completed tasks drop out of the working list (they linger with strikethrough otherwise).
    // Select the "Done" status filter to review them.
    const visible = showCompleted ? tasks : tasks.filter((t) => t.status !== 'done');
    const ids = new Set(visible.map((t) => t.id));
    const childrenOf = new Map<string, TaskDTO[]>();
    for (const t of visible) {
      if (!t.parentId) continue;
      if (!childrenOf.has(t.parentId)) childrenOf.set(t.parentId, []);
      childrenOf.get(t.parentId)!.push(t);
    }
    const compare = compareTasksBy(sortBy);
    for (const list of childrenOf.values()) list.sort(compare);
    const roots = visible.filter((t) => !t.parentId || !ids.has(t.parentId)).sort(compare);
    return { roots, childrenOf };
  }, [tasks, showCompleted, sortBy]);

  const handleReorder = (ids: string[]) => reorder.mutate(ids);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition-colors focus-within:border-teal-300 focus-within:ring-2 focus-within:ring-teal-100 dark:border-neutral-800 dark:bg-neutral-900/40 dark:focus-within:border-teal-500/50 dark:focus-within:ring-teal-500/10">
        <QuickAddTask defaults={quickAddDefaults} />
      </div>
      {roots.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400 dark:border-neutral-800 dark:text-neutral-500">
          No tasks match these filters.
        </p>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {roots.map((t) => (
              <TaskRow key={t.id} task={t} depth={0} siblings={roots} childrenOf={childrenOf} onOpen={onOpenTask} onReorder={handleReorder} reorderable={reorderable} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
