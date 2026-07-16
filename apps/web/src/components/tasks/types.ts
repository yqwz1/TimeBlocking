export type TasksView =
  | 'list'
  | 'kanban'
  | 'gantt'
  | 'upcoming'
  | 'dashboard'
  | 'focus'
  | 'calendar'
  | 'habits'
  | 'today'
  | 'objectives'
  | 'goals'
  | 'review'
  | 'analytics'
  | 'settings';

export type DueRange = 'any' | 'overdue' | 'today' | 'week' | 'none';

/** 'manual' keeps drag-and-drop order (sortOrder). The rest override it for display. */
export type SortBy = 'manual' | 'priority' | 'dueDate' | 'difficulty';

export interface TaskFilterState {
  q: string;
  label: string | null;
  status: string | null;
  priority: number | null;
  dueRange: DueRange;
  sortBy: SortBy;
}

export const EMPTY_FILTERS: TaskFilterState = { q: '', label: null, status: null, priority: null, dueRange: 'any', sortBy: 'manual' };
