import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpDown, BarChart3, CalendarClock, CircleDot, Flag, List, Columns3, Search, X } from 'lucide-react';
import type { TaskStatus } from '@timeblock/shared';
import type { SortBy, TaskFilterState, TasksView } from './types.js';
import FilterDropdown, { type FilterOption } from './FilterDropdown.js';
import { PRIORITY_COLOR, PRIORITY_LABEL, STATUS_DOT, STATUS_LABEL } from './taskDisplay.js';

const VIEW_TABS: { key: TasksView; label: string; icon: typeof List }[] = [
  { key: 'list', label: 'List', icon: List },
  { key: 'kanban', label: 'Kanban', icon: Columns3 },
  { key: 'gantt', label: 'Gantt', icon: CalendarClock },
  { key: 'upcoming', label: 'Upcoming', icon: CalendarClock },
  { key: 'dashboard', label: 'Dashboard', icon: BarChart3 },
];

const STATUS_OPTIONS: FilterOption<TaskStatus>[] = (['backlog', 'todo', 'in_progress', 'done', 'cancelled'] as TaskStatus[]).map((s) => ({
  value: s,
  label: STATUS_LABEL[s],
  dotClassName: STATUS_DOT[s],
}));

const PRIORITY_OPTIONS: FilterOption<number>[] = [4, 3, 2, 1].map((p) => ({
  value: p,
  label: PRIORITY_LABEL[p],
  badgeClassName: PRIORITY_COLOR[p],
}));

const DUE_OPTIONS: FilterOption<TaskFilterState['dueRange']>[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'Due this week' },
  { value: 'none', label: 'No due date' },
];

const SORT_OPTIONS: FilterOption<Exclude<SortBy, 'manual'>>[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'dueDate', label: 'Deadline (soonest first)' },
  { value: 'difficulty', label: 'Difficulty (hardest first)' },
];

export default function FilterBar({
  view,
  onViewChange,
  filters,
  onFiltersChange,
}: {
  view: TasksView;
  onViewChange: (v: TasksView) => void;
  filters: TaskFilterState;
  onFiltersChange: (f: TaskFilterState) => void;
}) {
  const [q, setQ] = useState(filters.q);
  useEffect(() => setQ(filters.q), [filters.q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== filters.q) onFiltersChange({ ...filters, q });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const activeCount = [
    filters.label,
    filters.status,
    filters.priority,
    filters.dueRange !== 'any' ? filters.dueRange : null,
    filters.sortBy !== 'manual' ? filters.sortBy : null,
  ].filter(Boolean).length;

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tasks…"
            className="w-full rounded-full border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-teal-500/40 dark:focus:ring-teal-500/10"
          />
        </div>
        <FilterDropdown
          label="Any status"
          icon={<CircleDot size={13} />}
          value={filters.status as TaskStatus | null}
          options={STATUS_OPTIONS}
          onChange={(v) => onFiltersChange({ ...filters, status: v })}
        />
        <FilterDropdown
          label="Any priority"
          icon={<Flag size={13} />}
          value={filters.priority}
          options={PRIORITY_OPTIONS}
          onChange={(v) => onFiltersChange({ ...filters, priority: v })}
        />
        <FilterDropdown
          label="Any date"
          icon={<CalendarClock size={13} />}
          value={filters.dueRange === 'any' ? null : filters.dueRange}
          options={DUE_OPTIONS}
          onChange={(v) => onFiltersChange({ ...filters, dueRange: v ?? 'any' })}
        />
        <FilterDropdown
          label="Sort: manual"
          icon={<ArrowUpDown size={13} />}
          value={filters.sortBy === 'manual' ? null : filters.sortBy}
          options={SORT_OPTIONS}
          onChange={(v) => onFiltersChange({ ...filters, sortBy: v ?? 'manual' })}
        />
        {activeCount > 0 && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => onFiltersChange({ ...filters, label: null, status: null, priority: null, dueRange: 'any', sortBy: 'manual' })}
            className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5"
          >
            <X size={12} /> Clear filters
          </motion.button>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {VIEW_TABS.map((t) => {
          const Icon = t.icon;
          const active = view === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onViewChange(t.key)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                active ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'
              }`}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
