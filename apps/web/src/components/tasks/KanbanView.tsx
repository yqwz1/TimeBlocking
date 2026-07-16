import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { GripVertical, Maximize2, Minimize2 } from 'lucide-react';
import type { TaskDTO, TaskInput, TaskStatus } from '@timeblock/shared';
import { useReorderTasks, useUpdateTask } from '../../hooks.js';
import { useKanbanColumns } from '../../hooks/useKanbanColumns.js';
import TaskCard from './TaskCard.js';
import QuickAddTask from './QuickAddTask.js';
import { STATUS_LABEL, STATUS_DOT, compareTasksBy } from './taskDisplay.js';
import type { SortBy } from './types.js';

const COLUMNS: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'done'];

export default function KanbanView({
  tasks,
  onOpenTask,
  quickAddDefaults,
  sortBy = 'manual',
}: {
  tasks: TaskDTO[];
  onOpenTask: (id: string) => void;
  quickAddDefaults?: Partial<TaskInput>;
  sortBy?: SortBy;
}) {
  const update = useUpdateTask();
  const reorder = useReorderTasks();
  const [showCancelled, setShowCancelled] = useState(false);
  const [dragOverCol, setDragOverCol] = useState<TaskStatus | null>(null);
  const [dragOverColHeader, setDragOverColHeader] = useState<TaskStatus | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  const visibleColumns = useMemo(() => (showCancelled ? [...COLUMNS, 'cancelled' as TaskStatus] : COLUMNS), [showCancelled]);
  const { order, widthOf, isCollapsed, toggleCollapsed, startResize, resizing, moveColumn, syncColumns } = useKanbanColumns(
    'kanban.columns',
    COLUMNS,
  );

  useEffect(() => syncColumns(visibleColumns), [visibleColumns, syncColumns]);
  const columns = order.filter((s) => visibleColumns.includes(s));

  const byStatus = useMemo(() => {
    const m = new Map<TaskStatus, TaskDTO[]>();
    for (const t of tasks) {
      if (!m.has(t.status)) m.set(t.status, []);
      m.get(t.status)!.push(t);
    }
    const compare = compareTasksBy(sortBy);
    for (const list of m.values()) list.sort(compare);
    return m;
  }, [tasks, sortBy]);

  const contentById = useMemo(() => new Map(tasks.map((t) => [t.id, t.content])), [tasks]);

  const dropOnColumn = (status: TaskStatus, targetTaskId: string | null) => {
    const draggedId = draggedTaskId;
    if (!draggedId) return;
    const items = (byStatus.get(status) ?? []).filter((t) => t.id !== draggedId);
    const insertIdx = targetTaskId ? items.findIndex((t) => t.id === targetTaskId) : items.length;
    const newIds = items.map((t) => t.id);
    newIds.splice(insertIdx < 0 ? items.length : insertIdx, 0, draggedId);
    const draggedTask = tasks.find((t) => t.id === draggedId);
    if (draggedTask && draggedTask.status !== status) {
      update.mutate({ id: draggedId, patch: { status } });
    }
    reorder.mutate(newIds);
    setDragOverCol(null);
    setDraggedTaskId(null);
  };

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={() => setShowCancelled((v) => !v)} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-neutral-300">
          {showCancelled ? 'Hide' : 'Show'} cancelled column
        </button>
      </div>
      <div className="flex items-start gap-3 overflow-x-auto pb-2">
        {columns.map((status) => {
          const items = byStatus.get(status) ?? [];
          const collapsed = isCollapsed(status);
          const width = widthOf(status);

          if (collapsed) {
            return (
              <button
                key={status}
                type="button"
                onClick={() => toggleCollapsed(status)}
                title={`Expand ${STATUS_LABEL[status]}`}
                style={{ width }}
                className="flex shrink-0 flex-col items-center gap-2 self-stretch rounded-xl border border-slate-200 bg-slate-50/60 py-3 text-slate-500 transition-colors hover:border-teal-300 hover:bg-teal-50/50 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-400 dark:hover:border-teal-500/50"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
                <span className="text-xs font-semibold tabular-nums">{items.length}</span>
                <span className="flex-1 [writing-mode:vertical-rl] text-xs font-semibold uppercase tracking-wide">{STATUS_LABEL[status]}</span>
                <Maximize2 size={13} />
              </button>
            );
          }

          return (
            <div
              key={status}
              style={{ width }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('text/task-id')) return;
                e.preventDefault();
                setDragOverCol(status);
              }}
              onDragLeave={() => setDragOverCol((s) => (s === status ? null : s))}
              onDrop={(e) => {
                if (!e.dataTransfer.types.includes('text/task-id')) return;
                e.preventDefault();
                dropOnColumn(status, null);
              }}
              className={`relative shrink-0 overflow-hidden rounded-xl border p-2 pt-3 transition-colors ${
                dragOverCol === status ? 'border-teal-300 bg-teal-50/50 dark:border-teal-500/50 dark:bg-teal-500/5' : 'border-slate-200 bg-slate-50/60 dark:border-neutral-800 dark:bg-neutral-900/40'
              }`}
            >
              <div className={`absolute inset-x-0 top-0 h-1 ${STATUS_DOT[status]}`} />
              <div
                draggable
                onDragStart={(e) => {
                  if (!(e.target as HTMLElement).closest('[data-col-drag-handle]')) {
                    e.preventDefault();
                    return;
                  }
                  e.dataTransfer.setData('text/column-status', status);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes('text/column-status')) return;
                  e.preventDefault();
                  setDragOverColHeader(status);
                }}
                onDragLeave={() => setDragOverColHeader((s) => (s === status ? null : s))}
                onDrop={(e) => {
                  if (!e.dataTransfer.types.includes('text/column-status')) return;
                  e.preventDefault();
                  const from = e.dataTransfer.getData('text/column-status') as TaskStatus;
                  if (from) moveColumn(from, status);
                  setDragOverColHeader(null);
                }}
                className={`mb-2 flex items-center justify-between gap-1 rounded-md px-1 py-0.5 ${
                  dragOverColHeader === status ? 'bg-teal-100/70 dark:bg-teal-500/10' : ''
                }`}
              >
                <div className="flex min-w-0 items-center gap-1">
                  <span data-col-drag-handle className="shrink-0 cursor-grab text-slate-300 opacity-60 hover:opacity-100 active:cursor-grabbing dark:text-neutral-600">
                    <GripVertical size={13} />
                  </span>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
                  <span className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">{STATUS_LABEL[status]}</span>
                  <span className="shrink-0 text-xs text-slate-400 dark:text-neutral-500">{items.length}</span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleCollapsed(status)}
                  title="Collapse column"
                  className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-300"
                >
                  <Minimize2 size={12} />
                </button>
              </div>
              <div className="mb-2 space-y-2">
                <AnimatePresence initial={false}>
                  {items.map((t) => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/task-id', t.id);
                        e.dataTransfer.effectAllowed = 'move';
                        setDraggedTaskId(t.id);
                      }}
                      onDragEnd={() => setDraggedTaskId(null)}
                      onDragOver={(e) => {
                        if (!e.dataTransfer.types.includes('text/task-id')) return;
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOverCol(status);
                      }}
                      onDrop={(e) => {
                        if (!e.dataTransfer.types.includes('text/task-id')) return;
                        e.preventDefault();
                        e.stopPropagation();
                        dropOnColumn(status, t.id);
                      }}
                    >
                      <TaskCard
                        task={t}
                        onOpen={onOpenTask}
                        isDragging={draggedTaskId === t.id}
                        parentContent={t.parentId ? contentById.get(t.parentId) : null}
                      />
                    </div>
                  ))}
                </AnimatePresence>
              </div>
              {status !== 'done' && status !== 'cancelled' && (
                <QuickAddTask placeholder="Add…" defaults={{ ...quickAddDefaults, status }} className="rounded-md border border-dashed border-teal-300 bg-teal-50/60 px-2 py-1 focus-within:border-teal-400 focus-within:bg-teal-50 dark:border-teal-500/40 dark:bg-teal-500/10 dark:focus-within:border-teal-400/70 dark:focus-within:bg-teal-500/15" />
              )}
              <div
                onMouseDown={(e) => startResize(status, e)}
                title="Drag to resize"
                className={`absolute right-0 top-0 h-full w-1.5 cursor-col-resize rounded-r-xl hover:bg-teal-300/50 dark:hover:bg-teal-500/30 ${
                  resizing === status ? 'bg-teal-300/60 dark:bg-teal-500/40' : ''
                }`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
