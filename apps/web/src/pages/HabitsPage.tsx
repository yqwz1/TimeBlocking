import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BookOpen,
  Check,
  ChevronDown,
  CircleDashed,
  Flame,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  SkipForward,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { HabitDTO, HabitInput, HabitWeekDay, WeekdayKey } from '@timeblock/shared';
import { WEEKDAY_KEYS } from '@timeblock/shared';
import { useCompleteHabitToday, useCreateHabit, useDeleteHabit, useHabits, useSkipHabitToday, useUpdateHabit } from '../hooks.js';
import { listItem, springs } from '../lib/motion.js';

const EMPTY: HabitInput = {
  name: '',
  durationMin: 30,
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  preferredStart: null,
  windowStart: '06:00',
  windowEnd: '22:00',
  priority: 2,
  kind: 'habit',
  weeklyTargetMin: null,
  notes: '',
  active: true,
};

/** Two-letter labels avoid the "T = Tue or Thu?" ambiguity of single-letter day chips. */
const DAY_LABELS: Record<WeekdayKey, string> = { mon: 'Mo', tue: 'Tu', wed: 'We', thu: 'Th', fri: 'Fr', sat: 'Sa', sun: 'Su' };

const KIND_META: Record<HabitInput['kind'], { label: string; badge: string; Icon: typeof Repeat }> = {
  habit: { label: 'Habit', badge: 'bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-300', Icon: Repeat },
  learning: { label: 'Learning', badge: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300', Icon: BookOpen },
};

const INPUT_CLS =
  'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500';

function todayWeekdayKey(): WeekdayKey {
  return WEEKDAY_KEYS[(new Date().getDay() + 6) % 7];
}

function fmtMin(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// ---------- shared bits ----------

function StreakBadge({ days, size = 'md' }: { days: number; size?: 'sm' | 'md' }) {
  const lit = days > 0;
  return (
    <span
      title={lit ? `${days}-day streak — keep it going!` : 'No streak yet — complete today to start one'}
      className={`inline-flex items-center gap-1 rounded-full font-bold tabular-nums ${size === 'md' ? 'px-2 py-0.5 text-sm' : 'px-1.5 py-0.5 text-xs'} ${
        lit ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' : 'text-slate-300 dark:text-neutral-600'
      }`}
    >
      <Flame className={`${size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'} ${lit ? 'tb-flame text-amber-500' : ''}`} fill={lit ? 'currentColor' : 'none'} />
      {days}
    </span>
  );
}

const WEEK_DOT: Record<HabitWeekDay['status'], { cls: string; label: string }> = {
  done: { cls: 'bg-emerald-500 text-white', label: 'done' },
  skipped: { cls: 'bg-slate-200 text-slate-500 dark:bg-neutral-700 dark:text-neutral-400', label: 'skipped' },
  missed: { cls: 'bg-rose-100 text-rose-500 dark:bg-rose-500/15 dark:text-rose-400', label: 'missed' },
  pending: { cls: 'border-2 border-teal-500 text-teal-600 dark:text-teal-400', label: 'due today' },
  upcoming: { cls: 'border border-slate-300 text-slate-400 dark:border-neutral-600 dark:text-neutral-500', label: 'upcoming' },
  off: { cls: 'text-slate-300 dark:text-neutral-700', label: 'not scheduled' },
};

/** Mon–Sun at a glance: filled = done, ring = due today, red = missed. */
function WeekTracker({ history }: { history: HabitWeekDay[] }) {
  return (
    <div className="flex items-center gap-1" aria-label="This week">
      {history.map((d, i) => {
        const wk = WEEKDAY_KEYS[i];
        const meta = WEEK_DOT[d.status];
        return (
          <span
            key={d.date}
            title={`${DAY_LABELS[wk]} — ${meta.label}`}
            className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${meta.cls}`}
          >
            {d.status === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : d.status === 'skipped' ? <Minus className="h-3 w-3" /> : DAY_LABELS[wk]}
          </span>
        );
      })}
    </div>
  );
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? done / total : 0;
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative h-16 w-16 shrink-0" role="img" aria-label={`${done} of ${total} habits done today`}>
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={R} fill="none" strokeWidth="6" className="stroke-slate-100 dark:stroke-neutral-800" />
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
          className={`transition-[stroke-dashoffset] duration-500 ${pct >= 1 ? 'stroke-emerald-500' : 'stroke-teal-500'}`}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums text-slate-700 dark:text-neutral-200">
        {done}/{total}
      </span>
    </div>
  );
}

// ---------- form ----------

function DayPicker({ value, onChange, todayKey }: { value: WeekdayKey[]; onChange: (d: WeekdayKey[]) => void; todayKey: WeekdayKey }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {WEEKDAY_KEYS.map((d) => {
        const selected = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => onChange(selected ? value.filter((x) => x !== d) : [...value, d])}
            aria-pressed={selected}
            className={`h-8 w-9 cursor-pointer rounded-lg text-xs font-semibold transition-colors ${
              selected ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'
            } ${d === todayKey ? 'ring-2 ring-teal-400 ring-offset-1 dark:ring-offset-neutral-900' : ''}`}
          >
            {DAY_LABELS[d]}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onChange(value.length === 7 ? ['mon', 'tue', 'wed', 'thu', 'fri'] : [...WEEKDAY_KEYS])}
        className="ml-1 cursor-pointer text-xs font-medium text-teal-600 hover:underline dark:text-teal-400"
      >
        {value.length === 7 ? 'Weekdays' : 'Every day'}
      </button>
    </div>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block text-xs font-medium text-slate-500 dark:text-neutral-400 ${className}`}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function HabitForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: HabitInput;
  submitLabel: string;
  pending: boolean;
  onSubmit: (v: HabitInput) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<HabitInput>(initial);
  const [more, setMore] = useState(false);
  const todayKey = todayWeekdayKey();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_auto]">
        <input
          required
          autoFocus
          placeholder="Name (e.g. Gym, Spanish, Read 20 pages)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={`col-span-2 sm:col-span-1 ${INPUT_CLS}`}
        />
        <div className="col-span-2 flex rounded-lg bg-slate-100 p-0.5 dark:bg-neutral-800 sm:col-span-1">
          {(['habit', 'learning'] as const).map((k) => {
            const { label, Icon } = KIND_META[k];
            const on = form.kind === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setForm({ ...form, kind: k })}
                aria-pressed={on}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  on ? 'bg-white text-slate-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100' : 'text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Repeat on</span>
        <DayPicker value={form.days} onChange={(days) => setForm({ ...form, days })} todayKey={todayKey} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Duration (min)">
          <input
            type="number"
            min={5}
            max={480}
            value={form.durationMin}
            onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })}
            className={`w-full ${INPUT_CLS}`}
          />
        </Field>
        <Field label="Preferred start (optional)">
          <input
            type="time"
            value={form.preferredStart ?? ''}
            onChange={(e) => setForm({ ...form, preferredStart: e.target.value || null })}
            className={`w-full ${INPUT_CLS}`}
          />
        </Field>
        {form.kind === 'learning' && (
          <Field label="Weekly target (min)">
            <input
              type="number"
              min={5}
              placeholder="e.g. 150"
              value={form.weeklyTargetMin ?? ''}
              onChange={(e) => setForm({ ...form, weeklyTargetMin: e.target.value ? Number(e.target.value) : null })}
              className={`w-full ${INPUT_CLS}`}
            />
          </Field>
        )}
      </div>

      <button
        type="button"
        onClick={() => setMore((m) => !m)}
        className="flex cursor-pointer items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${more ? 'rotate-180' : ''}`} /> More options
      </button>
      <AnimatePresence initial={false}>
        {more && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.gentle}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-3">
              <Field label="Earliest slot">
                <input type="time" value={form.windowStart} onChange={(e) => setForm({ ...form, windowStart: e.target.value })} className={`w-full ${INPUT_CLS}`} />
              </Field>
              <Field label="Latest slot">
                <input type="time" value={form.windowEnd} onChange={(e) => setForm({ ...form, windowEnd: e.target.value })} className={`w-full ${INPUT_CLS}`} />
              </Field>
              <Field label="Priority">
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} className={`w-full ${INPUT_CLS}`}>
                  <option value={1}>P1 — must happen</option>
                  <option value={2}>P2 — important</option>
                  <option value={3}>P3 — normal</option>
                  <option value={4}>P4 — flexible</option>
                </select>
              </Field>
              <Field label="Notes" className="col-span-2 sm:col-span-3">
                <input
                  placeholder="Anything the scheduler or future-you should know"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className={`w-full ${INPUT_CLS}`}
                />
              </Field>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-500 disabled:opacity-50"
        >
          {pending ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-white/5"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

// ---------- today checklist ----------

function TodayRow({ habit }: { habit: HabitDTO }) {
  const complete = useCompleteHabitToday();
  const skip = useSkipHabitToday();
  const done = habit.todayStatus === 'done';
  const skipped = habit.todayStatus === 'skipped';
  const missed = habit.todayStatus === 'missed';
  const settled = done || skipped;

  return (
    <motion.div layout variants={listItem} initial="initial" animate="animate" exit="exit" className="flex items-center gap-3 px-4 py-2.5">
      <motion.button
        type="button"
        whileTap={{ scale: 0.85 }}
        disabled={complete.isPending || done}
        onClick={() => complete.mutate(habit.id)}
        aria-label={done ? `${habit.name} done` : `Mark ${habit.name} done`}
        title={done ? 'Done' : 'Mark done'}
        className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors ${
          done
            ? 'bg-emerald-500 text-white'
            : 'border-2 border-slate-300 text-transparent hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-500 dark:border-neutral-600 dark:hover:border-emerald-400 dark:hover:bg-emerald-500/10'
        }`}
      >
        <Check className="h-5 w-5" strokeWidth={3} />
      </motion.button>

      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${settled ? 'text-slate-400 line-through dark:text-neutral-500' : 'text-slate-900 dark:text-neutral-100'}`}>
          {habit.name}
        </p>
        <p className="text-xs text-slate-400 dark:text-neutral-500">
          {fmtMin(habit.durationMin)}
          {habit.preferredStart ? ` · ${habit.preferredStart}` : ''}
          {skipped ? ' · skipped' : ''}
          {missed && <span className="font-medium text-rose-500"> · missed — mark done if you finished late</span>}
        </p>
      </div>

      <StreakBadge days={habit.streakDays} size="sm" />

      {!settled && (
        <button
          type="button"
          onClick={() => skip.mutate(habit.id)}
          disabled={skip.isPending}
          aria-label={`Skip ${habit.name} today`}
          title="Skip today (doesn't break the streak)"
          className="cursor-pointer rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:text-neutral-500 dark:hover:bg-white/5 dark:hover:text-neutral-300"
        >
          <SkipForward className="h-4 w-4" />
        </button>
      )}
    </motion.div>
  );
}

function TodayCard({ habits }: { habits: HabitDTO[] }) {
  const due = habits.filter((h) => h.active && h.todayStatus);
  if (due.length === 0) return null;
  const done = due.filter((h) => h.todayStatus === 'done').length;
  const allDone = done === due.length;
  const sorted = [...due].sort((a, b) => {
    const rank = (h: HabitDTO) => (h.todayStatus === 'missed' ? 0 : h.todayStatus === 'pending' ? 1 : 2);
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 dark:border-neutral-800">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Today</h2>
          <p className="text-xs text-slate-400 dark:text-neutral-500">{dateLabel}</p>
          {allDone && (
            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <Sparkles className="h-3.5 w-3.5" /> All done — nice work!
            </p>
          )}
        </div>
        <ProgressRing done={done} total={due.length} />
      </div>
      <div className="divide-y divide-slate-100 dark:divide-neutral-800">
        <AnimatePresence initial={false}>
          {sorted.map((h) => (
            <TodayRow key={h.id} habit={h} />
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}

// ---------- all habits ----------

function HabitRow({ habit }: { habit: HabitDTO }) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateHabit();
  const del = useDeleteHabit();

  const target = habit.kind === 'learning' && habit.weeklyTargetMin ? habit.weeklyTargetMin : habit.weekPlannedMin;
  const pct = target > 0 ? Math.min(100, Math.round((habit.weekDoneMin / target) * 100)) : 0;
  const { label: kindLabel, badge: kindBadge } = KIND_META[habit.kind];

  if (editing) {
    return (
      <motion.div layout className="rounded-2xl border border-teal-300 bg-white p-4 dark:border-teal-500/40 dark:bg-neutral-900">
        <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-neutral-100">Edit "{habit.name}"</p>
        <HabitForm
          initial={habit}
          submitLabel="Save changes"
          pending={update.isPending}
          onSubmit={(v) => update.mutate({ id: habit.id, patch: v }, { onSuccess: () => setEditing(false) })}
          onCancel={() => setEditing(false)}
        />
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      variants={listItem}
      initial="initial"
      animate="animate"
      exit="exit"
      className={`group rounded-2xl border p-4 transition-colors ${
        habit.active
          ? 'border-slate-200 bg-white hover:border-slate-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700'
          : 'border-slate-100 bg-slate-50 dark:border-neutral-800 dark:bg-neutral-800/40'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* name + meta */}
        <div className={`min-w-0 flex-1 basis-48 ${habit.active ? '' : 'opacity-60'}`}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-semibold text-slate-900 dark:text-neutral-100">{habit.name}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${kindBadge}`}>{kindLabel}</span>
            {!habit.active && (
              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-neutral-700 dark:text-neutral-400">
                Paused
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-neutral-500">
            {fmtMin(habit.durationMin)}
            {habit.preferredStart ? ` · starts ${habit.preferredStart}` : ''} · {habit.days.length === 7 ? 'every day' : `${habit.days.length}×/week`}
          </p>
        </div>

        <div className={habit.active ? '' : 'opacity-60'}>
          <WeekTracker history={habit.weekHistory} />
        </div>

        {/* weekly progress */}
        <div className={`w-28 shrink-0 ${habit.active ? '' : 'opacity-60'}`} title={`${habit.weekDoneMin} of ${target} min this week`}>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
            <div className={`h-full rounded-full transition-[width] duration-500 ${pct >= 100 ? 'bg-emerald-500' : 'bg-teal-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-[10px] tabular-nums text-slate-400 dark:text-neutral-500">
            {fmtMin(habit.weekDoneMin)} / {fmtMin(target)} wk
          </p>
        </div>

        <StreakBadge days={habit.streakDays} />

        {/* actions */}
        <div className="flex shrink-0 items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <button
            type="button"
            aria-label={`Edit ${habit.name}`}
            title="Edit"
            onClick={() => setEditing(true)}
            className="cursor-pointer rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={habit.active ? `Pause ${habit.name}` : `Resume ${habit.name}`}
            title={habit.active ? 'Pause — keeps history, stops scheduling' : 'Resume'}
            disabled={update.isPending}
            onClick={() => update.mutate({ id: habit.id, patch: { active: !habit.active } })}
            className="cursor-pointer rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-white/5"
          >
            {habit.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            type="button"
            aria-label={`Delete ${habit.name}`}
            title="Delete"
            onClick={() => confirm(`Delete "${habit.name}"? This can't be undone.`) && del.mutate(habit.id)}
            className="cursor-pointer rounded-lg p-2 text-rose-500 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ---------- page ----------

type Filter = 'active' | 'paused' | 'all';
const FILTERS: Filter[] = ['active', 'paused', 'all'];

export default function HabitsPage() {
  const { data: habits, isLoading } = useHabits();
  const [filter, setFilter] = useState<Filter>('active');
  const [creating, setCreating] = useState(false);
  const create = useCreateHabit();

  const all = habits ?? [];

  const filtered = useMemo(() => {
    const byFilter = filter === 'all' ? all : all.filter((h) => (filter === 'active' ? h.active : !h.active));
    return [...byFilter].sort((a, b) => Number(b.active) - Number(a.active) || b.streakDays - a.streakDays || a.name.localeCompare(b.name));
  }, [all, filter]);

  const pausedCount = all.filter((h) => !h.active).length;
  const active = all.filter((h) => h.active);
  const weekDone = active.reduce((s, h) => s + h.weekDoneMin, 0);
  const weekPlanned = active.reduce((s, h) => s + (h.kind === 'learning' && h.weeklyTargetMin ? h.weeklyTargetMin : h.weekPlannedMin), 0);
  const bestStreak = all.reduce((m, h) => Math.max(m, h.streakDays), 0);

  const emptyMessage =
    filter === 'paused' ? 'No paused habits.' : filter === 'active' && pausedCount > 0 ? 'No active habits — resume a paused one or add a new habit.' : null;

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Habits</h1>
          <p className="mt-0.5 text-sm text-slate-400 dark:text-neutral-500">Routines and learning goals, auto-scheduled into your open slots.</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
            creating
              ? 'border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-white/5'
              : 'bg-teal-600 text-white hover:bg-teal-500'
          }`}
        >
          {creating ? (
            <>
              <X className="h-4 w-4" /> Close
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" /> New habit
            </>
          )}
        </button>
      </div>

      {/* new habit form */}
      <AnimatePresence initial={false}>
        {creating && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.gentle}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-teal-200 bg-white p-4 dark:border-teal-500/30 dark:bg-neutral-900">
              <HabitForm
                initial={EMPTY}
                submitLabel="Add habit"
                pending={create.isPending}
                onSubmit={(v) => create.mutate(v, { onSuccess: () => setCreating(false) })}
                onCancel={() => setCreating(false)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100 dark:bg-neutral-800/60" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-neutral-700">
          <CircleDashed className="mx-auto h-8 w-8 text-slate-300 dark:text-neutral-600" />
          <p className="mt-3 text-sm font-medium text-slate-600 dark:text-neutral-300">No habits yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400 dark:text-neutral-500">
            Add a routine like "Gym" or a learning goal like "Spanish" and it'll be blocked into your calendar automatically.
          </p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-500"
          >
            <Plus className="h-4 w-4" /> Create your first habit
          </button>
        </div>
      ) : (
        <>
          <TodayCard habits={all} />

          {/* week stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Active habits', value: String(active.length) },
              { label: 'This week', value: `${fmtMin(weekDone)} / ${fmtMin(weekPlanned)}` },
              { label: 'Best streak', value: bestStreak > 0 ? `${bestStreak}d` : '—' },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-neutral-500">{s.label}</p>
                <p className="mt-0.5 truncate text-lg font-bold tabular-nums text-slate-900 dark:text-neutral-100">{s.value}</p>
              </div>
            ))}
          </div>

          {/* all habits */}
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">All habits</h2>
            <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-neutral-800">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                  className={`cursor-pointer rounded-md px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                    filter === f
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                      : 'text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200'
                  }`}
                >
                  {f}
                  {f === 'paused' && pausedCount > 0 ? ` (${pausedCount})` : ''}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400 dark:border-neutral-800 dark:text-neutral-500">
              {emptyMessage ?? 'Nothing here.'}
            </p>
          ) : (
            <div className="space-y-2.5">
              <AnimatePresence initial={false}>
                {filtered.map((h) => (
                  <HabitRow key={h.id} habit={h} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      )}
    </div>
  );
}
