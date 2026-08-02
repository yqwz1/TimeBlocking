import {
  Activity,
  BarChart3,
  CalendarDays,
  Dumbbell,
  Gauge,
  Medal,
  Settings2,
  Sparkles,
  Target,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { motion } from 'motion/react';

export type WorkoutView = 'overview' | 'strength' | 'powerlifting' | 'volume' | 'body' | 'calendar' | 'records' | 'goals' | 'tools' | 'settings';

const groups: Array<{ label: string; items: Array<{ id: WorkoutView; label: string; icon: LucideIcon }> }> = [
  { label: 'Analyze', items: [
    { id: 'overview', label: 'Overview', icon: Gauge },
    { id: 'strength', label: 'Strength', icon: BarChart3 },
    { id: 'powerlifting', label: 'Powerlifting', icon: Medal },
  ] },
  { label: 'Load', items: [
    { id: 'volume', label: 'Volume & recovery', icon: Activity },
    { id: 'body', label: 'Body map', icon: Dumbbell },
  ] },
  { label: 'History', items: [
    { id: 'calendar', label: 'Calendar', icon: CalendarDays },
    { id: 'records', label: 'Records', icon: Trophy },
    { id: 'goals', label: 'Goals', icon: Target },
  ] },
  { label: 'Manage', items: [
    { id: 'tools', label: 'Coaching tools', icon: Sparkles },
    { id: 'settings', label: 'Settings', icon: Settings2 },
  ] },
];

export const workoutItems = groups.flatMap((group) => group.items);

export default function WorkoutSidebar({ view, onChange }: { view: WorkoutView; onChange: (view: WorkoutView) => void }) {
  return <div className="sticky top-0 z-20 shrink-0 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95 sm:px-4" aria-label="Workout sections">
    <label className="relative block md:hidden"><span className="sr-only">Workout section</span><select aria-label="Workout section" value={view} onChange={(event) => onChange(event.target.value as WorkoutView)} className="h-11 w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 px-3 pr-9 text-sm font-semibold text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100">{groups.map((group) => <optgroup key={group.label} label={group.label}>{group.items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select><span className="pointer-events-none absolute right-3 top-3 text-slate-400">⌄</span></label>
    <nav className="hidden items-center overflow-x-auto md:flex" aria-label="Workout sections">
      {groups.map((group, groupIndex) => <div key={group.label} className={`flex shrink-0 items-center gap-1 ${groupIndex ? 'ml-2 border-l border-slate-200 pl-2 dark:border-neutral-700' : ''}`} aria-label={group.label}>{group.items.map(({ id, label, icon: Icon }) => { const active = view === id; return <button key={id} type="button" aria-current={active ? 'page' : undefined} onClick={() => onChange(id)} className={`group relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-teal-500/60 ${active ? 'text-slate-950 dark:text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-neutral-400 dark:hover:bg-white/[0.05] dark:hover:text-white'}`}>{active && <motion.span layoutId="workout-section-active" className="absolute inset-0 rounded-lg bg-slate-100 dark:bg-white/[0.07]" />}<Icon size={14} strokeWidth={1.8} className="relative" /><span className="relative">{label}</span>{active && <span className="absolute inset-x-2 -bottom-2 h-0.5 rounded bg-teal-500" />}</button>; })}</div>)}
    </nav>
  </div>;
}
