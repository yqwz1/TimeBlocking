import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { TaskDTO } from '@timeblock/shared';
import { useUpdateTask } from '../../hooks.js';
import { isOverdue, STATUS_DOT, formatDuration } from './taskDisplay.js';

const LABEL_W = 208;
const LABEL_PAD = 12;
const INDENT = 16;
const ROW_H = 34;
const HORIZON_OPTIONS = [
  { label: '2w', days: 14 },
  { label: '3w', days: 21 },
  { label: '5w', days: 35 },
  { label: '8w', days: 56 },
];

function dayWidthFor(horizonDays: number): number {
  if (horizonDays <= 14) return 46;
  if (horizonDays <= 21) return 36;
  if (horizonDays <= 35) return 26;
  return 18;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(20,184,166,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

type DragMode = 'move' | 'resize';
interface DragState {
  taskId: string;
  mode: DragMode;
  startClientX: number;
  originFrom: number;
  originTo: number;
  previewFrom: number;
  previewTo: number;
  moved: boolean;
}

interface BarRow {
  task: TaskDTO;
  dated: boolean;
  from: number;
  to: number;
  overdue: boolean;
  beforeRange: boolean;
  afterRange: boolean;
}

interface TreeRow extends BarRow {
  depth: number;
  isLast: boolean;
  ancestorContinues: boolean[];
}

/**
 * Depth-first flatten that keeps subtasks directly under their parent and tracks tree-line
 * geometry (which indent columns need a continuing vertical line). `sortKeyOf` resolves a
 * sortable date for a task — needed because undated subtasks/parents are pulled in for
 * hierarchy display and must still sort chronologically against their dated relatives.
 */
function buildTree(rows: BarRow[], sortKeyOf: (id: string) => string): TreeRow[] {
  const byId = new Map(rows.map((r) => [r.task.id, r]));
  const childrenOf = new Map<string, BarRow[]>();
  const roots: BarRow[] = [];
  for (const r of rows) {
    const parent = r.task.parentId;
    if (parent && byId.has(parent)) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent)!.push(r);
    } else {
      roots.push(r);
    }
  }
  const bySortKey = (a: BarRow, b: BarRow) => sortKeyOf(a.task.id).localeCompare(sortKeyOf(b.task.id));
  roots.sort(bySortKey);
  for (const list of childrenOf.values()) list.sort(bySortKey);

  const out: TreeRow[] = [];
  const visit = (level: BarRow[], depth: number, ancestorContinues: boolean[]) => {
    level.forEach((r, i) => {
      const isLast = i === level.length - 1;
      out.push({ ...r, depth, isLast, ancestorContinues });
      const kids = childrenOf.get(r.task.id);
      if (kids?.length) visit(kids, depth + 1, [...ancestorContinues, !isLast]);
    });
  };
  visit(roots, 0, []);
  return out;
}

export default function GanttView({ tasks, onOpenTask }: { tasks: TaskDTO[]; onOpenTask: (id: string) => void }) {
  const update = useUpdateTask();
  const [horizonDays, setHorizonDays] = useState(() => {
    const stored = Number(localStorage.getItem('tb.gantt.horizonDays'));
    return HORIZON_OPTIONS.some((o) => o.days === stored) ? stored : 21;
  });
  const [drag, setDrag] = useState<DragState | null>(null);

  const dayWidth = dayWidthFor(horizonDays);

  const changeHorizon = (days: number) => {
    setHorizonDays(days);
    localStorage.setItem('tb.gantt.horizonDays', String(days));
  };

  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrag(null);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.cursor = drag.mode === 'move' ? 'grabbing' : 'ew-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [drag]);

  const { days, monthGroups, rows } = useMemo(() => {
    const today = DateTime.now().startOf('day');
    const days = Array.from({ length: horizonDays }, (_, i) => today.plus({ days: i }));
    const dayIndex = new Map(days.map((d, i) => [d.toISODate()!, i]));

    const monthGroups: { label: string; span: number }[] = [];
    for (const d of days) {
      const label = d.toFormat('LLLL yyyy');
      const last = monthGroups[monthGroups.length - 1];
      if (last && last.label === label) last.span += 1;
      else monthGroups.push({ label, span: 1 });
    }

    const active = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
    const byId = new Map(active.map((t) => [t.id, t]));
    const childrenOf = new Map<string, TaskDTO[]>();
    for (const t of active) {
      if (t.parentId && byId.has(t.parentId)) {
        if (!childrenOf.has(t.parentId)) childrenOf.set(t.parentId, []);
        childrenOf.get(t.parentId)!.push(t);
      }
    }

    // A task is visible if it has its own due date, or it's an ancestor/descendant of one that
    // does — this pulls in undated subtasks (the common case) so hierarchy stays visible.
    const anchors = active.filter((t) => t.dueDate);
    const included = new Set<string>();
    for (const a of anchors) {
      let cur: TaskDTO | undefined = a;
      while (cur && !included.has(cur.id)) {
        included.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
    const stack = anchors.map((a) => a.id);
    while (stack.length) {
      const id = stack.pop()!;
      for (const kid of childrenOf.get(id) ?? []) {
        if (!included.has(kid.id)) {
          included.add(kid.id);
          stack.push(kid.id);
        }
      }
    }

    const subtreeMinDue = new Map<string, string>();
    const minDueOf = (id: string): string => {
      if (subtreeMinDue.has(id)) return subtreeMinDue.get(id)!;
      subtreeMinDue.set(id, '9999-12-31'); // cycle guard
      const t = byId.get(id);
      let min = t?.dueDate ?? undefined;
      for (const kid of childrenOf.get(id) ?? []) {
        if (!included.has(kid.id)) continue;
        const kidMin = minDueOf(kid.id);
        if (!min || kidMin < min) min = kidMin;
      }
      const resolved = min ?? '9999-12-31';
      subtreeMinDue.set(id, resolved);
      return resolved;
    };

    const barRows: BarRow[] = active
      .filter((t) => included.has(t.id))
      .map((t) => {
        if (!t.dueDate) return { task: t, dated: false, from: 0, to: 0, overdue: false, beforeRange: false, afterRange: false };

        const rawDueIdx = dayIndex.get(t.dueDate);
        const afterRange = rawDueIdx === undefined && t.dueDate >= today.toISODate()!;
        const beforeRange = rawDueIdx === undefined && t.dueDate < today.toISODate()!;
        const dueIdx = rawDueIdx ?? (afterRange ? horizonDays - 1 : 0);

        const startIso = t.blockStart ? DateTime.fromISO(t.blockStart).startOf('day').toISODate()! : today.toISODate()!;
        const rawStartIdx = dayIndex.get(startIso) ?? (startIso < today.toISODate()! ? 0 : horizonDays - 1);
        const startIdx = Math.max(0, Math.min(rawStartIdx, horizonDays - 1));

        const from = Math.min(startIdx, dueIdx);
        const to = Math.max(startIdx, dueIdx);
        return { task: t, dated: true, from, to, overdue: isOverdue(t.dueDate, t.status), beforeRange, afterRange };
      });

    return { days, monthGroups, rows: buildTree(barRows, minDueOf) };
  }, [tasks, horizonDays]);

  const commitDueDate = (taskId: string, dayIdx: number) => {
    const iso = days[dayIdx]?.toISODate();
    if (iso) update.mutate({ id: taskId, patch: { dueDate: iso } });
  };

  const onBarPointerDown = (e: React.PointerEvent, taskId: string, from: number, to: number, mode: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      // ignore — capture is best-effort; drag still works via bubbling move/up
    }
    setDrag({ taskId, mode, startClientX: e.clientX, originFrom: from, originTo: to, previewFrom: from, previewTo: to, moved: false });
  };

  const onBarPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const deltaDays = Math.round((e.clientX - drag.startClientX) / dayWidth);
    let previewFrom = drag.originFrom;
    let previewTo = drag.originTo;
    if (drag.mode === 'move') {
      const span = drag.originTo - drag.originFrom;
      previewFrom = drag.originFrom + deltaDays;
      previewTo = previewFrom + span;
      if (previewFrom < 0) {
        previewFrom = 0;
        previewTo = span;
      }
      if (previewTo > horizonDays - 1) {
        previewTo = horizonDays - 1;
        previewFrom = Math.max(0, previewTo - span);
      }
    } else {
      previewTo = Math.max(drag.originFrom, Math.min(drag.originTo + deltaDays, horizonDays - 1));
    }
    if (previewFrom === drag.previewFrom && previewTo === drag.previewTo) return;
    setDrag({ ...drag, previewFrom, previewTo, moved: drag.moved || previewFrom !== drag.originFrom || previewTo !== drag.originTo });
  };

  const onBarPointerUp = (e: React.PointerEvent, taskId: string) => {
    if (!drag || drag.taskId !== taskId) return;
    e.stopPropagation();
    if (drag.moved) commitDueDate(taskId, drag.previewTo);
    else onOpenTask(taskId);
    setDrag(null);
  };

  if (!rows.length) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400 dark:border-neutral-800 dark:text-neutral-500">
        No dated tasks to chart. Add a due date to see it here.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-end gap-3 border-b border-slate-200 px-3 py-2 dark:border-neutral-800">
        <div className="flex shrink-0 gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-neutral-800">
          {HORIZON_OPTIONS.map((o) => (
            <button
              key={o.days}
              type="button"
              onClick={() => changeHorizon(o.days)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                horizonDays === o.days
                  ? 'bg-white text-teal-600 shadow-sm dark:bg-neutral-700 dark:text-teal-400'
                  : 'text-slate-400 hover:text-slate-600 dark:text-neutral-500 dark:hover:text-neutral-300'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: LABEL_W + horizonDays * dayWidth }}>
          <div className="flex">
            <div style={{ width: LABEL_W }} className="sticky left-0 z-20 shrink-0 bg-white dark:bg-neutral-900" />
            <div className="flex flex-1">
              {monthGroups.map((g, i) => (
                <div
                  key={i}
                  style={{ width: g.span * dayWidth }}
                  className="truncate px-1.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500"
                >
                  {g.label}
                </div>
              ))}
            </div>
          </div>
          <div className="flex border-b border-slate-200 pb-1 dark:border-neutral-800">
            <div style={{ width: LABEL_W }} className="sticky left-0 z-20 shrink-0 bg-white dark:bg-neutral-900" />
            <div className="flex flex-1">
              {days.map((d, i) => (
                <div
                  key={d.toISODate()}
                  className={`text-center text-[10px] ${i === 0 ? 'rounded-t-md bg-teal-50 font-semibold text-teal-600 dark:bg-teal-500/10 dark:text-teal-400' : d.weekday >= 6 ? 'text-slate-300 dark:text-neutral-600' : 'text-slate-400 dark:text-neutral-500'}`}
                  style={{ width: dayWidth }}
                >
                  <div>{i === 0 ? 'Today' : d.toFormat('ccc')}</div>
                  <div className="font-medium">{d.toFormat('d')}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            {rows.map(({ task, dated, from, to, overdue, beforeRange, afterRange, depth, isLast, ancestorContinues }, rowIdx) => {
              const dragging = drag?.taskId === task.id;
              const dispFrom = dragging ? drag.previewFrom : from;
              const dispTo = dragging ? drag.previewTo : to;
              const barColor = overdue ? '#f43f5e' : task.projectColor ?? '#14b8a6';
              const widthPx = (dispTo - dispFrom + 1) * dayWidth;
              const showLabel = widthPx > 46;
              const stripe = rowIdx % 2 ? 'bg-slate-50/60 dark:bg-neutral-800/20' : '';

              return (
                <div key={task.id} className={`flex items-center ${stripe}`} style={{ height: ROW_H }}>
                  <button
                    type="button"
                    onClick={() => onOpenTask(task.id)}
                    style={{ width: LABEL_W }}
                    className={`sticky left-0 z-10 flex shrink-0 items-center text-left text-xs text-slate-600 hover:text-teal-600 dark:text-neutral-300 dark:hover:text-teal-400 ${stripe || 'bg-white dark:bg-neutral-900'}`}
                  >
                    <span className="relative flex h-full shrink-0 items-center self-stretch" style={{ width: LABEL_PAD + depth * INDENT }}>
                      {ancestorContinues.slice(0, depth - 1).map(
                        (continues, i) =>
                          continues && (
                            <span
                              key={i}
                              className="absolute inset-y-0 w-px bg-slate-200 dark:bg-neutral-700"
                              style={{ left: LABEL_PAD + i * INDENT + 6 }}
                            />
                          ),
                      )}
                      {depth > 0 && (
                        <>
                          <span
                            className="absolute top-0 w-px bg-slate-200 dark:bg-neutral-700"
                            style={{ left: LABEL_PAD + (depth - 1) * INDENT + 6, height: isLast ? '50%' : '100%' }}
                          />
                          <span
                            className="absolute h-px bg-slate-200 dark:bg-neutral-700"
                            style={{ left: LABEL_PAD + (depth - 1) * INDENT + 6, top: '50%', width: INDENT - 6 }}
                          />
                        </>
                      )}
                    </span>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[task.status]}`} />
                    <span className="truncate pl-1.5 pr-2">{task.content}</span>
                  </button>
                  <div className="relative flex-1" style={{ height: ROW_H }}>
                    <div className="absolute inset-0 flex">
                      {days.map((d, i) => (
                        <div
                          key={i}
                          className={`shrink-0 border-r border-slate-100 dark:border-neutral-800/60 ${i === 0 ? 'bg-teal-50/40 dark:bg-teal-500/5' : d.weekday >= 6 ? 'bg-slate-50/60 dark:bg-neutral-800/20' : ''}`}
                          style={{ width: dayWidth }}
                        />
                      ))}
                    </div>
                    {dated ? (
                      <div
                        role="button"
                        tabIndex={0}
                        title={`${task.content} — due ${task.dueDate}${overdue ? ' (overdue)' : ''}${task.durationMin ? ` · ${formatDuration(task.durationMin)}` : ''}`}
                        onPointerDown={(e) => onBarPointerDown(e, task.id, from, to, 'move')}
                        onPointerMove={onBarPointerMove}
                        onPointerUp={(e) => onBarPointerUp(e, task.id)}
                        className={`group absolute inset-y-1 flex cursor-grab items-center overflow-hidden rounded-md shadow-sm transition-shadow active:cursor-grabbing ${
                          dragging ? 'z-30 shadow-md ring-2 ring-teal-400/60' : 'hover:shadow-md'
                        }`}
                        style={{
                          left: dispFrom * dayWidth,
                          width: Math.max(dayWidth - 4, widthPx - 4),
                          backgroundColor: hexToRgba(barColor, dragging ? 1 : 0.88),
                        }}
                      >
                        {beforeRange && <ChevronsLeft size={11} className="ml-0.5 shrink-0 text-white/90" />}
                        {showLabel && (
                          <span className="truncate px-1.5 text-[10px] font-medium text-white">
                            {dragging ? `→ ${days[dispTo].toFormat('ccc, MMM d')}` : days[to].toFormat('MMM d')}
                          </span>
                        )}
                        {afterRange && <ChevronsRight size={11} className="ml-auto mr-0.5 shrink-0 text-white/90" />}
                        <div
                          onPointerDown={(e) => onBarPointerDown(e, task.id, from, to, 'resize')}
                          onPointerMove={onBarPointerMove}
                          onPointerUp={(e) => onBarPointerUp(e, task.id)}
                          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md bg-white/0 opacity-0 transition-opacity group-hover:opacity-100 group-hover:bg-white/25"
                        />
                      </div>
                    ) : (
                      <span
                        title={`${task.content} — no due date`}
                        className="absolute inset-y-0 left-1 flex items-center text-[10px] italic text-slate-300 dark:text-neutral-600"
                      >
                        no due date
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
