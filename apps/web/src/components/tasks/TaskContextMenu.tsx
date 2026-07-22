import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Armchair,
  Ban,
  CalendarArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  ChevronUp,
  ClipboardCopy,
  Copy,
  Flag,
  FolderInput,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Sun,
  Sunrise,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TaskDTO } from '@timeblock/shared';
import { taskToInput, useCreateTask, useDeleteTask, useProjects, useUpdateTask } from '../../hooks.js';
import { PRIORITY_LABEL, quickDateOptions } from './taskDisplay.js';

/** Everything the menu needs to render for one task. */
interface MenuState {
  task: TaskDTO;
  x: number;
  y: number;
  /** Opens the full editor panel for this task (wired per-view). */
  onOpen?: (id: string) => void;
  onAddSubtask?: () => void;
  orderActions?: {
    canMoveUp: boolean;
    canMoveDown: boolean;
    moveUp: () => void;
    moveDown: () => void;
    moveToTop: () => void;
    moveToBottom: () => void;
  };
}

type OpenMenuFn = (
  e: ReactMouseEvent,
  task: TaskDTO,
  opts?: Pick<MenuState, 'onOpen' | 'onAddSubtask' | 'orderActions'>,
) => void;

const TaskContextMenuContext = createContext<OpenMenuFn | null>(null);

/**
 * Right-click helper for a task (Todoist-style). Call from any component that
 * renders a task: `const openTaskMenu = useTaskContextMenu()`, then
 * `onContextMenu={(e) => openTaskMenu(e, task, { onOpen })}`.
 * No-ops (falls back to the browser menu) if the provider isn't mounted.
 */
export function useTaskContextMenu(): OpenMenuFn {
  const open = useContext(TaskContextMenuContext);
  return useCallback<OpenMenuFn>(
    (e, task, opts) => {
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      open(e, task, opts);
    },
    [open],
  );
}

/** Mount once near the app root; renders the (single) open menu in a portal. */
export function TaskContextMenuProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MenuState | null>(null);
  const open = useCallback<OpenMenuFn>((e, task, opts) => {
    setState({ task, x: e.clientX, y: e.clientY, ...opts });
  }, []);
  return (
    <TaskContextMenuContext.Provider value={open}>
      {children}
      {createPortal(
        <AnimatePresence>{state && <MenuPanel key={`${state.task.id}-${state.x}-${state.y}`} state={state} onClose={() => setState(null)} />}</AnimatePresence>,
        document.body,
      )}
    </TaskContextMenuContext.Provider>
  );
}

const PRIORITY_FLAG: Record<number, string> = {
  4: 'text-rose-500',
  3: 'text-amber-500',
  2: 'text-sky-500',
  1: 'text-slate-400 dark:text-neutral-500',
};

const DATE_ICONS: LucideIcon[] = [Sun, Sunrise, CalendarArrowUp, Armchair];

function MenuPanel({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const { task, onOpen, onAddSubtask, orderActions } = state;
  const update = useUpdateTask();
  const del = useDeleteTask();
  const create = useCreateTask();
  const { data: projects } = useProjects();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });
  const [showProjects, setShowProjects] = useState(false);
  const done = task.status === 'done';

  // Clamp to the viewport once the menu has a measurable size (and again when
  // the project submenu expands it).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      x: Math.min(state.x, window.innerWidth - width - pad),
      y: Math.min(state.y, window.innerHeight - height - pad),
    });
  }, [state.x, state.y, showProjects]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Capture-phase so a scroll or click anywhere (even inside stopPropagation zones) closes it.
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onClose, { capture: true, passive: true });
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onClose, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const patch = (p: Parameters<typeof update.mutate>[0]['patch']) => {
    update.mutate({ id: task.id, patch: p });
    onClose();
  };

  const duplicate = () => {
    const input = taskToInput(task);
    create.mutate({ ...input, content: `${input.content} (copy)`, status: input.status === 'done' ? 'todo' : input.status });
    onClose();
  };

  const copyText = () => {
    void navigator.clipboard?.writeText(task.content);
    onClose();
  };

  const quickDates = quickDateOptions();

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[1100] w-60 origin-top-left select-none rounded-xl border border-slate-200 bg-white py-1.5 text-sm text-slate-700 shadow-xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
      onContextMenu={(e) => e.preventDefault()}
    >
      {onOpen && (
        <>
          <MenuItem
            icon={Pencil}
            label="Edit"
            onClick={() => {
              onOpen(task.id);
              onClose();
            }}
          />
          <Divider />
        </>
      )}

      <SectionLabel>Due date</SectionLabel>
      <div className="flex items-center gap-1 px-3 pb-1.5 pt-0.5">
        {quickDates.map((opt, i) => {
          const Icon = DATE_ICONS[i] ?? Sun;
          const active = task.dueDate === opt.date;
          return (
            <button
              key={opt.label}
              type="button"
              title={opt.label}
              onClick={() => patch({ dueDate: opt.date, dueDatetimeUtc: null })}
              className={`rounded-md p-1.5 transition-colors hover:bg-slate-100 dark:hover:bg-neutral-800 ${
                active ? 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-500 dark:text-neutral-400'
              }`}
            >
              <Icon size={16} />
            </button>
          );
        })}
        <button
          type="button"
          title="Remove due date"
          onClick={() => patch({ dueDate: null, dueDatetimeUtc: null })}
          disabled={!task.dueDate}
          className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <Ban size={16} />
        </button>
      </div>

      <SectionLabel>Priority</SectionLabel>
      <div className="flex items-center gap-1 px-3 pb-1.5 pt-0.5">
        {[4, 3, 2, 1].map((p) => (
          <button
            key={p}
            type="button"
            title={PRIORITY_LABEL[p]}
            onClick={() => patch({ priority: p })}
            className={`rounded-md p-1.5 transition-colors hover:bg-slate-100 dark:hover:bg-neutral-800 ${
              task.priority === p ? 'bg-slate-100 ring-1 ring-slate-300 dark:bg-neutral-800 dark:ring-neutral-600' : ''
            }`}
          >
            <Flag size={16} className={PRIORITY_FLAG[p]} fill={p > 1 ? 'currentColor' : 'none'} />
          </button>
        ))}
      </div>

      <Divider />
      <MenuItem
        icon={done ? RotateCcw : CheckCircle2}
        label={done ? 'Reopen' : 'Complete'}
        onClick={() => patch({ status: done ? 'todo' : 'done' })}
      />
      <MenuItem icon={Pin} label={task.pinned ? 'Unpin' : 'Pin'} onClick={() => patch({ pinned: !task.pinned })} />
      {onAddSubtask && (
        <MenuItem
          icon={Plus}
          label="Add subtask"
          onClick={() => {
            onAddSubtask();
            onClose();
          }}
        />
      )}
      {orderActions && (
        <>
          <SectionLabel>Order</SectionLabel>
          <div className="grid grid-cols-4 gap-1 px-3 pb-1.5 pt-0.5">
            <OrderButton icon={ChevronsUp} label="Move to top" disabled={!orderActions.canMoveUp} onClick={orderActions.moveToTop} onClose={onClose} />
            <OrderButton icon={ChevronUp} label="Move up" disabled={!orderActions.canMoveUp} onClick={orderActions.moveUp} onClose={onClose} />
            <OrderButton icon={ChevronDown} label="Move down" disabled={!orderActions.canMoveDown} onClick={orderActions.moveDown} onClose={onClose} />
            <OrderButton icon={ChevronsDown} label="Move to bottom" disabled={!orderActions.canMoveDown} onClick={orderActions.moveToBottom} onClose={onClose} />
          </div>
        </>
      )}
      <MenuItem icon={Copy} label="Duplicate" onClick={duplicate} />
      <MenuItem
        icon={FolderInput}
        label="Move to…"
        trailing={<ChevronRight size={14} className={`transition-transform ${showProjects ? 'rotate-90' : ''}`} />}
        onClick={() => setShowProjects((v) => !v)}
      />
      {showProjects && (
        <div className="max-h-44 overflow-y-auto py-0.5 pl-4">
          <button
            type="button"
            onClick={() => patch({ projectId: null })}
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-slate-100 dark:hover:bg-neutral-800"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300 dark:bg-neutral-600" />
            <span className={task.projectId === null ? 'font-semibold' : ''}>No project</span>
          </button>
          {(projects ?? []).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => patch({ projectId: p.id })}
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-slate-100 dark:hover:bg-neutral-800"
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color ?? '#94a3b8' }} />
              <span className={`truncate ${task.projectId === p.id ? 'font-semibold' : ''}`}>{p.name}</span>
            </button>
          ))}
        </div>
      )}
      <MenuItem icon={ClipboardCopy} label="Copy task text" onClick={copyText} />

      <Divider />
      <MenuItem
        icon={Trash2}
        label="Delete"
        danger
        onClick={() => {
          del.mutate(task.id);
          onClose();
        }}
      />
    </motion.div>
  );
}

function OrderButton({
  icon: Icon,
  label,
  disabled,
  onClick,
  onClose,
}: {
  icon: LucideIcon;
  label: string;
  disabled: boolean;
  onClick: () => void;
  onClose: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        onClick();
        onClose();
      }}
      className="flex items-center justify-center rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-25 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
    >
      <Icon size={16} />
    </button>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger = false,
  trailing,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
        danger
          ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10'
          : 'hover:bg-slate-100 dark:hover:bg-neutral-800'
      }`}
    >
      <Icon size={15} className={danger ? '' : 'text-slate-400 dark:text-neutral-500'} />
      <span className="flex-1">{label}</span>
      {trailing}
    </button>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-slate-100 dark:bg-neutral-800" />;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="px-3 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">{children}</p>;
}
