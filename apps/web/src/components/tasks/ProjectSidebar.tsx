import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BarChart3,
  Briefcase,
  Trophy,
  Camera,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  Code,
  Coffee,
  DollarSign,
  Dumbbell,
  Eye,
  EyeOff,
  Folder,
  GraduationCap,
  Heart,
  Home,
  Inbox,
  type LucideIcon,
  Music,
  Palette,
  Pin,
  Plane,
  Plus,
  Repeat,
  Rocket,
  Settings as SettingsIcon,
  ShoppingCart,
  Sparkles,
  Star,
  Target,
  Timer,
  Trash2,
  Users,
  Zap,
} from 'lucide-react';
import {
  useCreateLabel,
  useCreateProject,
  useDeleteLabel,
  useDeleteProject,
  useLabels,
  usePinnedTasks,
  useProjects,
  useUpdateLabel,
  useUpdateProject,
  useUpdateTask,
} from '../../hooks.js';
import { springs } from '../../lib/motion.js';
import { useResizableSidebar } from '../../hooks/useResizableSidebar.js';

const SWATCHES = ['#f43f5e', '#f59e0b', '#10b981', '#0ea5e9', '#6366f1', '#0d9488', '#ec4899', '#64748b'];

const ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  briefcase: Briefcase,
  rocket: Rocket,
  home: Home,
  heart: Heart,
  star: Star,
  target: Target,
  zap: Zap,
  code: Code,
  'dollar-sign': DollarSign,
  dumbbell: Dumbbell,
  plane: Plane,
  'shopping-cart': ShoppingCart,
  music: Music,
  camera: Camera,
  coffee: Coffee,
  palette: Palette,
  'graduation-cap': GraduationCap,
  users: Users,
  sparkles: Sparkles,
};

function ProjectIcon({ icon, color, size = 14 }: { icon: string | null; color: string | null; size?: number }) {
  const Icon = icon ? ICONS[icon] : null;
  if (!Icon) return <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color ?? '#94a3b8' }} />;
  return <Icon size={size} className="shrink-0" style={{ color: color ?? '#64748b' }} />;
}

function ColorPicker({ value, onChange }: { value: string | null; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={c}
          className={`h-5 w-5 rounded-full ring-offset-1 dark:ring-offset-neutral-900 ${value === c ? 'ring-2 ring-slate-900 dark:ring-white' : ''}`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

function IconPicker({ value, onChange }: { value: string | null; onChange: (icon: string | null) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-label="No icon"
        className={`flex h-6 w-6 items-center justify-center rounded-md border border-dashed text-[10px] text-slate-400 ${
          !value ? 'border-slate-900 text-slate-600 dark:border-white dark:text-neutral-200' : 'border-slate-300 dark:border-neutral-700'
        }`}
      >
        &times;
      </button>
      {Object.entries(ICONS).map(([name, Icon]) => (
        <button
          key={name}
          type="button"
          onClick={() => onChange(name)}
          aria-label={name}
          className={`flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/10 ${
            value === name ? 'bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-white' : ''
          }`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

export default function ProjectSidebar({
  activeProject,
  onSelectProject,
  activeLabel,
  onSelectLabel,
  onOpenTask,
  hiddenProjects,
  onToggleProjectVisibility,
  focusActive,
  onOpenFocus,
  todayActive,
  onOpenToday,
  calendarActive,
  onOpenCalendar,
  habitsActive,
  onOpenHabits,
  objectivesActive,
  onOpenObjectives,
  goalsActive,
  onOpenGoals,
  reviewActive,
  onOpenReview,
  analyticsActive,
  onOpenAnalytics,
  settingsActive,
  onOpenSettings,
}: {
  activeProject: string | null; // null = All, 'inbox' = Inbox
  onSelectProject: (id: string | null) => void;
  activeLabel: string | null;
  onSelectLabel: (name: string | null) => void;
  onOpenTask: (id: string) => void;
  hiddenProjects: Set<string>;
  onToggleProjectVisibility: (id: string) => void;
  focusActive: boolean;
  onOpenFocus: () => void;
  todayActive: boolean;
  onOpenToday: () => void;
  calendarActive: boolean;
  onOpenCalendar: () => void;
  habitsActive: boolean;
  onOpenHabits: () => void;
  objectivesActive: boolean;
  onOpenObjectives: () => void;
  goalsActive: boolean;
  onOpenGoals: () => void;
  reviewActive: boolean;
  onOpenReview: () => void;
  analyticsActive: boolean;
  onOpenAnalytics: () => void;
  settingsActive: boolean;
  onOpenSettings: () => void;
}) {
  const { data: projects } = useProjects();
  const { data: labels } = useLabels();
  const { data: pinnedTasks } = usePinnedTasks();
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const updateTask = useUpdateTask();
  const createLabel = useCreateLabel();
  const updateLabel = useUpdateLabel();
  const deleteLabel = useDeleteLabel();
  const deleteProject = useDeleteProject();
  const [addingProject, setAddingProject] = useState(false);
  const [favoritesCollapsed, setFavoritesCollapsed] = useState(() => localStorage.getItem('tb.sidebar.favoritesCollapsed') === '1');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>(SWATCHES[4]);
  const [newIcon, setNewIcon] = useState<string | null>(null);
  const [addingLabel, setAddingLabel] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newLabelColor, setNewLabelColor] = useState<string>(SWATCHES[4]);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectsCollapsed, setProjectsCollapsed] = useState(() => localStorage.getItem('tb.sidebar.projectsCollapsed') === '1');
  const [labelsCollapsed, setLabelsCollapsed] = useState(() => localStorage.getItem('tb.sidebar.labelsCollapsed') === '1');
  const [expandedProgress, setExpandedProgress] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('tb.sidebar.expandedProgress') ?? '[]'));
    } catch {
      return new Set();
    }
  });

  const toggleProgressExpanded = (id: string) =>
    setExpandedProgress((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem('tb.sidebar.expandedProgress', JSON.stringify([...next]));
      return next;
    });

  const toggleProjectsCollapsed = () =>
    setProjectsCollapsed((v) => {
      localStorage.setItem('tb.sidebar.projectsCollapsed', v ? '0' : '1');
      return !v;
    });
  const toggleLabelsCollapsed = () =>
    setLabelsCollapsed((v) => {
      localStorage.setItem('tb.sidebar.labelsCollapsed', v ? '0' : '1');
      return !v;
    });
  const toggleFavoritesCollapsed = () =>
    setFavoritesCollapsed((v) => {
      localStorage.setItem('tb.sidebar.favoritesCollapsed', v ? '0' : '1');
      return !v;
    });

  const active = projects?.filter((p) => !p.archived) ?? [];
  const pinnedProjects = active.filter((p) => p.pinned);
  const openPinnedTasks = (pinnedTasks ?? []).filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const { width, collapsed, dragging, toggleCollapsed, startDrag } = useResizableSidebar('tb.taskSidebar');
  const otherViewActive =
    focusActive || todayActive || calendarActive || habitsActive || objectivesActive || goalsActive || reviewActive || analyticsActive || settingsActive;

  if (collapsed) {
    return (
      <div style={{ width }} className="relative flex min-h-screen shrink-0 flex-col items-center gap-1.5 border-r border-slate-200 bg-white pt-2 dark:border-neutral-800 dark:bg-neutral-900">
        <button
          type="button"
          onClick={toggleCollapsed}
          title="Expand sidebar"
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-neutral-300"
        >
          <ChevronsRight size={16} />
        </button>
        <button
          type="button"
          onClick={() => onSelectProject(null)}
          title="All tasks"
          className={`rounded-md p-1.5 ${activeProject === null && !otherViewActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}
        >
          <Inbox size={16} />
        </button>
        <button
          type="button"
          onClick={onOpenToday}
          title="Today"
          className={`rounded-md p-1.5 ${todayActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}
        >
          <CalendarDays size={16} />
        </button>
        <button
          type="button"
          onClick={onOpenCalendar}
          title="Calendar"
          className={`rounded-md p-1.5 ${calendarActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}
        >
          <CalendarRange size={16} />
        </button>
        <div className="my-1 h-px w-6 bg-slate-100 dark:bg-neutral-800" />
        <button
          type="button"
          onClick={onOpenHabits}
          title="Habits"
          className={`rounded-md p-1.5 ${habitsActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}
        >
          <Repeat size={16} />
        </button>
        <button
          type="button"
          onClick={onOpenFocus}
          title="Focus"
          className={`rounded-md p-1.5 ${focusActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}
        >
          <Timer size={16} />
        </button>
        <div className="my-1 h-px w-6 bg-slate-100 dark:bg-neutral-800" />
        <button
          type="button"
          onClick={onOpenObjectives}
          title="Objectives"
          className={`rounded-md p-1.5 ${objectivesActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}
        >
          <Target size={16} />
        </button>
        <button
          type="button"
          onClick={onOpenGoals}
          title="Goals"
          className={`rounded-md p-1.5 ${goalsActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}
        >
          <Trophy size={16} />
        </button>
        <button
          type="button"
          onClick={onOpenReview}
          title="Review"
          className={`rounded-md p-1.5 ${reviewActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}
        >
          <ClipboardCheck size={16} />
        </button>
        <button
          type="button"
          onClick={onOpenAnalytics}
          title="Analytics"
          className={`rounded-md p-1.5 ${analyticsActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}
        >
          <BarChart3 size={16} />
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings"
          className={`mt-auto mb-1 rounded-md p-1.5 ${settingsActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}
        >
          <SettingsIcon size={16} />
        </button>
      </div>
    );
  }

  return (
    <div style={{ width }} className="relative flex shrink-0 flex-col gap-5 border-r border-slate-200 bg-white py-1 pl-3 pr-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div
        onMouseDown={startDrag}
        className={`absolute -right-0.5 top-0 h-full w-1 cursor-col-resize select-none hover:bg-teal-400/50 ${dragging ? 'bg-teal-500/60' : ''}`}
      />
      <div className="flex items-center justify-between px-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Workspace</span>
        <button
          type="button"
          onClick={toggleCollapsed}
          title="Collapse sidebar"
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-neutral-300"
        >
          <ChevronsLeft size={14} />
        </button>
      </div>
      <div className="space-y-3">
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => onSelectProject(null)}
            className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
              activeProject === null && !otherViewActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
            }`}
          >
            All tasks
          </button>
          <button
            type="button"
            onClick={() => onSelectProject('inbox')}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
              activeProject === 'inbox' && !otherViewActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
            }`}
          >
            <Inbox size={14} /> Inbox
          </button>
          <button
            type="button"
            onClick={onOpenToday}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
              todayActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
            }`}
          >
            <CalendarDays size={14} /> Today
          </button>
        </div>

        <div className="space-y-0.5">
          <span className="block px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Plan</span>
          <button
            type="button"
            onClick={onOpenCalendar}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
              calendarActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
            }`}
          >
            <CalendarRange size={14} /> Calendar
          </button>
          <button
            type="button"
            onClick={onOpenHabits}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
              habitsActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
            }`}
          >
            <Repeat size={14} /> Habits
          </button>
          <button
            type="button"
            onClick={onOpenFocus}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
              focusActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
            }`}
          >
            <Timer size={14} /> Focus
          </button>
        </div>

        <div className="space-y-0.5">
          <span className="block px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">Track</span>
          <button
            type="button"
            onClick={onOpenObjectives}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
              objectivesActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
            }`}
          >
            <Target size={14} /> Objectives
          </button>
          <button
            type="button"
            onClick={onOpenGoals}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
              goalsActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
            }`}
          >
            <Trophy size={14} /> Goals
          </button>
          <button
            type="button"
            onClick={onOpenReview}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
              reviewActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
            }`}
          >
            <ClipboardCheck size={14} /> Review
          </button>
          <button
            type="button"
            onClick={onOpenAnalytics}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
              analyticsActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
            }`}
          >
            <BarChart3 size={14} /> Analytics
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenSettings}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
            settingsActive ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
          }`}
        >
          <SettingsIcon size={14} /> Settings
        </button>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between px-2">
          <button
            type="button"
            onClick={toggleFavoritesCollapsed}
            className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500"
          >
            <ChevronDown size={12} className={`transition-transform ${favoritesCollapsed ? '-rotate-90' : ''}`} />
            Favorites
          </button>
        </div>
        {!favoritesCollapsed && (
          <ul className="space-y-0.5">
            {pinnedProjects.length === 0 && openPinnedTasks.length === 0 ? (
              <li className="px-2 py-1 text-xs text-slate-400 dark:text-neutral-500">Pin a project or task to see it here.</li>
            ) : (
              <>
                {pinnedProjects.map((p) => (
                  <li key={`fav-project-${p.id}`} className="group">
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => onSelectProject(p.id)}
                        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                          activeProject === p.id ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
                        }`}
                      >
                        <ProjectIcon icon={p.icon} color={p.color} />
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateProject.mutate({ id: p.id, patch: { pinned: false } });
                        }}
                        aria-label={`Unpin ${p.name}`}
                        title="Unpin"
                        className="shrink-0 rounded p-1 text-amber-500 opacity-0 group-hover:opacity-100"
                      >
                        <Pin size={12} fill="currentColor" />
                      </button>
                    </div>
                  </li>
                ))}
                {openPinnedTasks.map((t) => (
                  <li key={`fav-task-${t.id}`} className="group">
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => onOpenTask(t.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: t.color ?? '#94a3b8' }} />
                        <span className="min-w-0 flex-1 truncate">{t.content}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateTask.mutate({ id: t.id, patch: { pinned: false } });
                        }}
                        aria-label={`Unpin ${t.content}`}
                        title="Unpin"
                        className="shrink-0 rounded p-1 text-amber-500 opacity-0 group-hover:opacity-100"
                      >
                        <Pin size={12} fill="currentColor" />
                      </button>
                    </div>
                  </li>
                ))}
              </>
            )}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between px-2">
          <button
            type="button"
            onClick={toggleProjectsCollapsed}
            className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500"
          >
            <ChevronDown size={12} className={`transition-transform ${projectsCollapsed ? '-rotate-90' : ''}`} />
            Projects
          </button>
          <button
            type="button"
            onClick={() => setAddingProject((v) => !v)}
            aria-label="Add project"
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-neutral-300"
          >
            <Plus size={14} />
          </button>
        </div>
        <AnimatePresence initial={false}>
          {addingProject && !projectsCollapsed && (
            <motion.form
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={springs.gentle}
              onSubmit={(e) => {
                e.preventDefault();
                if (!newName.trim()) return;
                createProject.mutate(
                  { name: newName.trim(), color: newColor, icon: newIcon },
                  { onSuccess: () => { setNewName(''); setNewIcon(null); setAddingProject(false); } },
                );
              }}
              className="mb-2 space-y-2 overflow-hidden rounded-md border border-slate-200 p-2 dark:border-neutral-800"
            >
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Project name"
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
              <ColorPicker value={newColor} onChange={setNewColor} />
              <IconPicker value={newIcon} onChange={setNewIcon} />
              <div className="flex gap-1.5">
                <button type="submit" className="flex-1 rounded-md bg-teal-600 px-2 py-1 text-xs font-medium text-white">
                  Add
                </button>
                <button type="button" onClick={() => setAddingProject(false)} className="rounded-md px-2 py-1 text-xs text-slate-500 dark:text-neutral-400">
                  Cancel
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
        <ul className={`space-y-1 ${projectsCollapsed ? 'hidden' : ''}`}>
          {active.map((p) => {
            const pct = p.taskCount > 0 ? Math.round((p.doneCount / p.taskCount) * 100) : 0;
            return (
            <li key={p.id} className="group relative">
              <div className="flex items-center">
              <button
                type="button"
                onClick={() => onSelectProject(p.id)}
                onDoubleClick={() => setEditingProjectId(editingProjectId === p.id ? null : p.id)}
                title="Click to open, double-click to edit icon/color"
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  activeProject === p.id ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-white/5'
                }`}
              >
                <ProjectIcon icon={p.icon} color={p.color} />
                <span className={`min-w-0 flex-1 truncate ${hiddenProjects.has(p.id) ? 'opacity-50' : ''}`}>{p.name}</span>
                <span className="text-xs text-slate-400 dark:text-neutral-500">{p.taskCount - p.doneCount}</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  updateProject.mutate({ id: p.id, patch: { pinned: !p.pinned } });
                }}
                aria-label={p.pinned ? `Unpin ${p.name}` : `Pin ${p.name}`}
                title={p.pinned ? 'Unpin' : 'Pin to favorites'}
                className={`shrink-0 rounded p-1 ${
                  p.pinned ? 'block text-amber-500' : 'hidden text-slate-300 hover:text-amber-500 group-hover:block dark:text-neutral-600'
                }`}
              >
                <Pin size={12} fill={p.pinned ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleProjectVisibility(p.id);
                }}
                aria-label={hiddenProjects.has(p.id) ? `Show tasks for ${p.name}` : `Hide tasks for ${p.name}`}
                title={hiddenProjects.has(p.id) ? 'Hidden — click to show its tasks' : 'Click to hide its tasks'}
                className={`shrink-0 rounded p-1 text-slate-300 hover:text-teal-500 dark:text-neutral-600 ${
                  hiddenProjects.has(p.id) ? 'block text-teal-400 dark:text-teal-400' : 'hidden group-hover:block'
                }`}
              >
                {hiddenProjects.has(p.id) ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
              <button
                type="button"
                onClick={() => confirm(`Delete "${p.name}"? Its tasks move to Inbox.`) && deleteProject.mutate(p.id)}
                aria-label={`Delete ${p.name}`}
                className="hidden shrink-0 rounded p-1 text-slate-300 hover:text-red-500 group-hover:block dark:text-neutral-600"
              >
                <Trash2 size={12} />
              </button>
              </div>
              {p.taskCount > 0 && (
                <button
                  type="button"
                  onClick={() => toggleProgressExpanded(p.id)}
                  title={expandedProgress.has(p.id) ? 'Hide progress' : `${p.doneCount}/${p.taskCount} done — click to show progress`}
                  className="flex w-full items-center gap-1 px-2 pb-0.5 text-left"
                >
                  <ChevronDown size={9} className={`shrink-0 text-slate-300 transition-transform dark:text-neutral-600 ${expandedProgress.has(p.id) ? '' : '-rotate-90'}`} />
                  <AnimatePresence initial={false}>
                    {expandedProgress.has(p.id) && (
                      <motion.div
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 'auto', opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={springs.gentle}
                        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
                      >
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, backgroundColor: p.color ?? '#6366f1' }}
                          />
                        </div>
                        <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-slate-400 dark:text-neutral-500">{pct}%</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </button>
              )}
              {editingProjectId === p.id && (
                <div className="absolute left-0 top-full z-10 mt-1 w-56 space-y-2 rounded-md border border-slate-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
                  <ColorPicker value={p.color} onChange={(c) => updateProject.mutate({ id: p.id, patch: { color: c } })} />
                  <IconPicker value={p.icon} onChange={(icon) => updateProject.mutate({ id: p.id, patch: { icon } })} />
                </div>
              )}
            </li>
            );
          })}
        </ul>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between px-2">
          <button
            type="button"
            onClick={toggleLabelsCollapsed}
            className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500"
          >
            <ChevronDown size={12} className={`transition-transform ${labelsCollapsed ? '-rotate-90' : ''}`} />
            Labels
          </button>
          <button
            type="button"
            onClick={() => setAddingLabel((v) => !v)}
            aria-label="Add label"
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-neutral-300"
          >
            <Plus size={14} />
          </button>
        </div>
        <AnimatePresence initial={false}>
          {addingLabel && !labelsCollapsed && (
            <motion.form
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={springs.gentle}
              onSubmit={(e) => {
                e.preventDefault();
                if (!newLabel.trim()) return;
                createLabel.mutate(
                  { name: newLabel.trim(), color: newLabelColor },
                  { onSuccess: () => { setNewLabel(''); setAddingLabel(false); } },
                );
              }}
              className="mb-2 space-y-2 overflow-hidden px-2"
            >
              <input
                autoFocus
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Label name"
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
              <ColorPicker value={newLabelColor} onChange={setNewLabelColor} />
            </motion.form>
          )}
        </AnimatePresence>
        <div className={`flex flex-wrap gap-1.5 px-2 ${labelsCollapsed ? 'hidden' : ''}`}>
          {(labels ?? []).map((l) => (
            <div key={l.id} className="relative">
              <button
                type="button"
                onClick={() => onSelectLabel(activeLabel === l.name ? null : l.name)}
                onDoubleClick={() => setEditingLabelId(editingLabelId === l.id ? null : l.id)}
                title="Click to filter, double-click to change color"
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors ${
                  activeLabel === l.name ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
                }`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: l.color ?? '#94a3b8' }} />
                {l.name}
              </button>
              {editingLabelId === l.id && (
                <div className="absolute left-0 top-full z-10 mt-1 space-y-2 rounded-md border border-slate-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
                  <ColorPicker
                    value={l.color}
                    onChange={(c) => {
                      updateLabel.mutate({ id: l.id, patch: { color: c } });
                      setEditingLabelId(null);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete label "${l.name}"? It will be removed from all tasks.`)) {
                        deleteLabel.mutate(l.id);
                        setEditingLabelId(null);
                      }
                    }}
                    className="flex w-full items-center justify-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/30"
                  >
                    <Trash2 size={12} />
                    Delete label
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
