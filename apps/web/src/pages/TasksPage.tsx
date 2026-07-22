import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DueRange, TaskFilterState, TasksView } from '../components/tasks/types.js';
import { EMPTY_FILTERS } from '../components/tasks/types.js';
import { useTaskList } from '../hooks.js';
import ProjectSidebar from '../components/tasks/ProjectSidebar.js';
import FilterBar from '../components/tasks/FilterBar.js';
import TaskListView from '../components/tasks/TaskListView.js';
import TaskEditorPanel from '../components/tasks/TaskEditorPanel.js';
import KanbanView from '../components/tasks/KanbanView.js';
import UpcomingView from '../components/tasks/UpcomingView.js';
import GanttView from '../components/tasks/GanttView.js';
import TasksDashboard from '../components/tasks/TasksDashboard.js';
import FocusView from '../components/tasks/FocusView.js';
import CalendarPage from './CalendarPage.js';
import HabitsPage from './HabitsPage.js';
import TodayPage from './TodayPage.js';
import ObjectivesPage from './ObjectivesPage.js';
import GoalsPage from './GoalsPage.js';
import WeeklyReviewPage from './WeeklyReviewPage.js';
import AnalyticsPage from './AnalyticsPage.js';
import SettingsPage from './SettingsPage.js';
import { isOverdue } from '../components/tasks/taskDisplay.js';

const EMBEDDED_VIEWS = new Set<TasksView>(['focus', 'calendar', 'habits', 'today', 'objectives', 'goals', 'review', 'analytics', 'settings']);

function isThisWeek(dueDate: string): boolean {
  const d = new Date(dueDate);
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + (7 - now.getDay()));
  return d >= new Date(now.toDateString()) && d <= end;
}

function applyDueRange<T extends { dueDate: string | null; status: string }>(tasks: T[], range: DueRange): T[] {
  if (range === 'any') return tasks;
  const today = new Date().toISOString().slice(0, 10);
  return tasks.filter((t) => {
    if (range === 'none') return !t.dueDate;
    if (!t.dueDate) return false;
    if (range === 'overdue') return isOverdue(t.dueDate, t.status as never);
    if (range === 'today') return t.dueDate === today;
    if (range === 'week') return isThisWeek(t.dueDate);
    return true;
  });
}

export default function TasksPage() {
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as TasksView) || 'list';
  const activeProject = params.get('project');
  const openTaskId = params.get('task');
  const [filters, setFilters] = useState<TaskFilterState>(EMPTY_FILTERS);
  const [hiddenProjects, setHiddenProjects] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('tb.sidebar.hiddenProjects') ?? '[]'));
    } catch {
      return new Set();
    }
  });

  const toggleProjectVisibility = (id: string) =>
    setHiddenProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem('tb.sidebar.hiddenProjects', JSON.stringify([...next]));
      return next;
    });

  const setView = (v: TasksView) => setParams((p) => { const n = new URLSearchParams(p); n.set('view', v); return n; });
  const setActiveProject = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set('project', id);
      else n.delete('project');
      return n;
    });
  const selectProjectAndLeaveFocus = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      const v = n.get('view') as TasksView | null;
      if (v && EMBEDDED_VIEWS.has(v)) n.set('view', 'list');
      if (id) n.set('project', id);
      else n.delete('project');
      return n;
    });
  const openToday = () => setView('today');
  const todayActive = view === 'today';

  const openTask = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set('task', id);
      else n.delete('task');
      return n;
    });

  const { data: allTasks, isLoading } = useTaskList({
    q: filters.q || undefined,
    label: filters.label ?? undefined,
    status: filters.status ?? undefined,
    priority: filters.priority ?? undefined,
    projectId: activeProject ?? undefined,
    includeClosed: filters.status === 'cancelled' || filters.status === 'done' ? true : undefined,
  });

  const filtered = useMemo(() => {
    const byDueRange = applyDueRange(allTasks ?? [], filters.dueRange);
    if (hiddenProjects.size === 0) return byDueRange;
    return byDueRange.filter((t) => activeProject === t.projectId || !hiddenProjects.has(t.projectId ?? ''));
  }, [allTasks, filters.dueRange, hiddenProjects, activeProject]);

  const quickAddDefaults = activeProject && activeProject !== 'inbox' ? { projectId: activeProject } : undefined;

  return (
    <div className="flex min-h-full gap-5">
      <ProjectSidebar
        activeProject={activeProject}
        onSelectProject={selectProjectAndLeaveFocus}
        activeLabel={filters.label}
        onSelectLabel={(label) => setFilters((f) => ({ ...f, label }))}
        onOpenTask={openTask}
        hiddenProjects={hiddenProjects}
        onToggleProjectVisibility={toggleProjectVisibility}
        focusActive={view === 'focus'}
        onOpenFocus={() => setView('focus')}
        todayActive={todayActive}
        onOpenToday={openToday}
        calendarActive={view === 'calendar'}
        onOpenCalendar={() => setView('calendar')}
        habitsActive={view === 'habits'}
        onOpenHabits={() => setView('habits')}
        objectivesActive={view === 'objectives'}
        onOpenObjectives={() => setView('objectives')}
        goalsActive={view === 'goals'}
        onOpenGoals={() => setView('goals')}
        reviewActive={view === 'review'}
        onOpenReview={() => setView('review')}
        analyticsActive={view === 'analytics'}
        onOpenAnalytics={() => setView('analytics')}
        settingsActive={view === 'settings'}
        onOpenSettings={() => setView('settings')}
      />
      <div className="min-w-0 flex-1 px-4 pt-4">
        {!EMBEDDED_VIEWS.has(view) && <FilterBar view={view} onViewChange={setView} filters={filters} onFiltersChange={setFilters} />}

        {view === 'calendar' ? (
          <CalendarPage onOpenTask={openTask} />
        ) : view === 'habits' ? (
          <HabitsPage />
        ) : view === 'focus' ? (
          <FocusView onOpenTask={openTask} />
        ) : view === 'today' ? (
          <TodayPage onOpenTask={openTask} />
        ) : view === 'objectives' ? (
          <ObjectivesPage />
        ) : view === 'goals' ? (
          <GoalsPage />
        ) : view === 'review' ? (
          <WeeklyReviewPage />
        ) : view === 'analytics' ? (
          <AnalyticsPage />
        ) : view === 'settings' ? (
          <SettingsPage />
        ) : isLoading ? (
          <p className="text-sm text-slate-400 dark:text-neutral-500">Loading…</p>
        ) : view === 'list' ? (
          <TaskListView
            tasks={filtered}
            onOpenTask={openTask}
            quickAddDefaults={quickAddDefaults}
            showCompleted={filters.status === 'done' || filters.status === 'cancelled'}
            sortBy={filters.sortBy}
          />
        ) : view === 'kanban' ? (
          <KanbanView tasks={filtered} onOpenTask={openTask} quickAddDefaults={quickAddDefaults} sortBy={filters.sortBy} />
        ) : view === 'gantt' ? (
          <GanttView tasks={filtered} onOpenTask={openTask} />
        ) : view === 'upcoming' ? (
          <UpcomingView onOpenTask={openTask} />
        ) : (
          <TasksDashboard tasks={allTasks ?? []} onOpenTask={openTask} />
        )}
      </div>

      {openTaskId && <TaskEditorPanel taskId={openTaskId} onClose={() => openTask(null)} onOpen={openTask} />}
    </div>
  );
}
