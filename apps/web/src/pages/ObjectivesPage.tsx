import { useState, type FormEvent } from 'react';
import { DateTime } from 'luxon';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Check, ChevronDown, Clock3, ListChecks, Plus, Target, Trash2, Undo2, X } from 'lucide-react';
import type { ObjectiveDTO, ObjectiveInput } from '@timeblock/shared';
import { useCreateObjective, useDeleteObjective, useHabits, useObjectives, useProjects, useUpdateObjective } from '../hooks.js';
import { formatMinutes, LINK_ICON } from '../components/rail/WeeklyObjectivesPanel.js';
import { listItem, springs } from '../lib/motion.js';

function currentWeekStart(): string {
  return DateTime.now().startOf('week').toISODate()!;
}

function weekRangeLabel(weekStart: string): string {
  const start = DateTime.fromISO(weekStart);
  const end = start.plus({ days: 6 });
  return start.month === end.month
    ? `${start.toFormat('MMM d')}–${end.toFormat('d, yyyy')}`
    : `${start.toFormat('MMM d')} – ${end.toFormat('MMM d, yyyy')}`;
}

function computeProgress(o: ObjectiveDTO) {
  const usesCount = !o.targetMinutes && !!o.targetCount;
  const target = usesCount ? o.targetCount! : (o.targetMinutes ?? 0);
  const progress = usesCount ? o.progressCount : o.progressMinutes;
  const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0;
  const plannedPct =
    !usesCount && target > 0 ? Math.min(100, Math.round((Math.max(o.plannedMinutes, progress) / target) * 100)) : pct;
  return { usesCount, target, progress, pct, plannedPct };
}

function isBehindPace(o: ObjectiveDTO, weekProgressPct: number): boolean {
  const { target, pct } = computeProgress(o);
  return o.status !== 'done' && target > 0 && weekProgressPct > 15 && pct + 12 < weekProgressPct;
}

type TrackBy = 'none' | 'time' | 'count';

const TRACK_BY_OPTIONS: [TrackBy, string, typeof X][] = [
  ['none', 'Manual', X],
  ['time', 'Time', Clock3],
  ['count', 'Count', ListChecks],
];

function NewObjectiveForm({ weekStart, onDone }: { weekStart: string; onDone: () => void }) {
  const { data: projects } = useProjects();
  const { data: habits } = useHabits();
  const create = useCreateObjective();
  const [title, setTitle] = useState('');
  const [trackBy, setTrackBy] = useState<TrackBy>('none');
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [count, setCount] = useState('');
  const [linkKind, setLinkKind] = useState<ObjectiveInput['linkKind']>(null);
  const [linkValue, setLinkValue] = useState<string | null>(null);

  const reset = () => {
    setTitle('');
    setTrackBy('none');
    setHours('');
    setMinutes('');
    setCount('');
    setLinkKind(null);
    setLinkValue(null);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const targetMinutes = trackBy === 'time' ? Number(hours || 0) * 60 + Number(minutes || 0) || null : null;
    const targetCount = trackBy === 'count' ? Number(count) || null : null;
    const input: ObjectiveInput = { weekStart, title, targetMinutes, targetCount, linkKind, linkValue, notes: '' };
    create.mutate(input, {
      onSuccess: () => {
        reset();
        onDone();
      },
    });
  };

  return (
    <motion.form
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={springs.soft}
      onSubmit={handleSubmit}
      className="space-y-4 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">What do you want to accomplish?</label>
        <input
          required
          autoFocus
          placeholder="e.g. Ship the redesign"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-neutral-400">Track progress by</label>
        <div className="flex gap-1.5">
          {TRACK_BY_OPTIONS.map(([val, label, Icon]) => (
            <button
              key={val}
              type="button"
              onClick={() => setTrackBy(val)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                trackBy === val
                  ? 'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-500/40 dark:bg-teal-500/15 dark:text-teal-300'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-white/5'
              }`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        {trackBy === 'time' && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={0}
              placeholder="0"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="w-16 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
            <span className="text-xs text-slate-400">hrs</span>
            <input
              type="number"
              min={0}
              max={59}
              placeholder="0"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="w-16 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
            <span className="text-xs text-slate-400">min this week</span>
          </div>
        )}
        {trackBy === 'count' && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={1}
              placeholder="e.g. 5"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
            <span className="text-xs text-slate-400">times this week</span>
          </div>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-neutral-400">Auto-track from (optional)</label>
        <div className="flex gap-2">
          <select
            value={linkKind ?? ''}
            onChange={(e) => {
              setLinkKind((e.target.value || null) as ObjectiveInput['linkKind']);
              setLinkValue(null);
            }}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          >
            <option value="">Nothing — I&rsquo;ll update manually</option>
            <option value="project">Project</option>
            <option value="label">Label</option>
            <option value="habit">Habit</option>
          </select>
          {linkKind === 'project' && (
            <select
              value={linkValue ?? ''}
              onChange={(e) => setLinkValue(e.target.value || null)}
              className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            >
              <option value="">Choose project…</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {linkKind === 'label' && (
            <input
              placeholder="label name"
              value={linkValue ?? ''}
              onChange={(e) => setLinkValue(e.target.value || null)}
              className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          )}
          {linkKind === 'habit' && (
            <select
              value={linkValue ?? ''}
              onChange={(e) => setLinkValue(e.target.value || null)}
              className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            >
              <option value="">Choose habit…</option>
              {(habits ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {linkKind && (
          <p className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">
            Progress updates automatically as you complete matching tasks.
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-neutral-800">
        <button
          type="button"
          onClick={() => {
            reset();
            onDone();
          }}
          className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 dark:text-neutral-400 dark:hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={create.isPending || !title.trim()}
          className="rounded-md bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {create.isPending ? 'Adding…' : 'Add objective'}
        </button>
      </div>
    </motion.form>
  );
}

function ObjectiveCard({
  o,
  weekProgressPct,
  onToggle,
  onDelete,
}: {
  o: ObjectiveDTO;
  weekProgressPct: number;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { usesCount, target, progress, pct, plannedPct } = computeProgress(o);
  const hasTarget = target > 0;
  const done = o.status === 'done';
  const behind = isBehindPace(o, weekProgressPct);
  const format = usesCount ? (n: number) => `${n}` : formatMinutes;
  const unit = usesCount ? (target === 1 ? ' item' : ' items') : '';
  const LinkIcon = o.linkKind ? LINK_ICON[o.linkKind] : null;

  return (
    <motion.li
      layout
      variants={listItem}
      initial="initial"
      animate="animate"
      exit="exit"
      className={`rounded-xl border p-4 transition-colors ${
        done
          ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-500/25 dark:bg-emerald-500/5'
          : 'border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={`truncate font-medium ${done ? 'text-slate-500 line-through dark:text-neutral-500' : 'text-slate-900 dark:text-neutral-100'}`}
              title={o.title}
            >
              {o.title}
            </p>
            {behind && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                <AlertTriangle size={11} /> Behind pace
              </span>
            )}
          </div>
          {o.linkKind && LinkIcon && (
            <span className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400 dark:text-neutral-500">
              <LinkIcon size={12} /> Auto-tracked · {o.linkValue ?? o.linkKind}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {confirming ? (
            <>
              <button onClick={onDelete} className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-500">
                Delete
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onToggle}
                title={done ? 'Reopen objective' : 'Mark objective done'}
                className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                  done
                    ? 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-white/5'
                    : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10'
                }`}
              >
                {done ? <Undo2 size={12} /> : <Check size={12} />}
                {done ? 'Reopen' : 'Done'}
              </button>
              <button
                onClick={() => setConfirming(true)}
                title="Delete objective"
                aria-label="Delete objective"
                className="rounded-md border border-transparent p-1 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:hover:border-red-500/30 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {hasTarget && (
        <>
          <div className="relative mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
            {!usesCount && plannedPct > pct && (
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-teal-300/50 dark:bg-teal-500/25"
                style={{ width: `${plannedPct}%` }}
              />
            )}
            <motion.div
              className={`absolute inset-y-0 left-0 rounded-full ${done ? 'bg-emerald-500' : behind ? 'bg-amber-500' : 'bg-teal-500'}`}
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={springs.soft}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs tabular-nums">
            <span className="text-slate-500 dark:text-neutral-400">
              {format(progress)}
              {unit} of {format(target)}
              {unit} · {pct}%
            </span>
            {!done && (
              <span className="text-slate-400 dark:text-neutral-500">
                {format(Math.max(0, target - progress))}
                {unit} left
              </span>
            )}
          </div>
        </>
      )}
    </motion.li>
  );
}

export default function ObjectivesPage() {
  const weekStart = currentWeekStart();
  const { data: objectives, isLoading } = useObjectives(weekStart);
  const update = useUpdateObjective();
  const del = useDeleteObjective();
  const [showForm, setShowForm] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  const all = objectives ?? [];
  const active = all.filter((o) => o.status !== 'done');
  const done = all.filter((o) => o.status === 'done');

  const start = DateTime.fromISO(weekStart);
  const daysElapsed = Math.min(7, Math.max(0, DateTime.now().diff(start, 'days').days));
  const weekProgressPct = Math.round((daysElapsed / 7) * 100);
  const behindCount = active.filter((o) => isBehindPace(o, weekProgressPct)).length;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Target size={18} className="text-teal-500" />
            <h1 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">This week&rsquo;s objectives</h1>
          </div>
          <p className="mt-1 text-sm text-slate-400 dark:text-neutral-500">{weekRangeLabel(weekStart)}</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500"
          >
            <Plus size={15} /> New objective
          </button>
        )}
      </div>

      {all.length > 0 && (
        <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex-1">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-neutral-400">
              <span>
                {done.length} of {all.length} complete
              </span>
              <span>Week {weekProgressPct}% elapsed</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${all.length ? Math.round((done.length / all.length) * 100) : 0}%` }}
              />
            </div>
          </div>
          {behindCount > 0 && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              <AlertTriangle size={12} /> {behindCount} behind pace
            </span>
          )}
        </div>
      )}

      <AnimatePresence initial={false}>
        {showForm && <NewObjectiveForm weekStart={weekStart} onDone={() => setShowForm(false)} />}
      </AnimatePresence>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-neutral-800/60" />
          ))}
        </div>
      ) : all.length === 0 && !showForm ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-6 py-10 text-center dark:border-neutral-700">
          <Target size={24} className="mx-auto text-slate-300 dark:text-neutral-600" />
          <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">No objectives yet this week.</p>
          <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
            Set 1–3 things that matter most — linked objectives get prioritized automatically in your schedule.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500"
          >
            <Plus size={14} /> Add your first objective
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {active.length > 0 && (
            <ul className="space-y-3">
              <AnimatePresence initial={false}>
                {active.map((o) => (
                  <ObjectiveCard
                    key={o.id}
                    o={o}
                    weekProgressPct={weekProgressPct}
                    onToggle={() => update.mutate({ id: o.id, patch: { status: 'done' } })}
                    onDelete={() => del.mutate(o.id)}
                  />
                ))}
              </AnimatePresence>
            </ul>
          )}

          {done.length > 0 && (
            <div>
              <button
                onClick={() => setShowCompleted((v) => !v)}
                className="flex w-full items-center gap-1.5 rounded-md py-1.5 text-xs font-medium text-slate-400 hover:text-slate-600 dark:text-neutral-500 dark:hover:text-neutral-300"
              >
                <ChevronDown size={13} className={`transition-transform ${showCompleted ? 'rotate-180' : ''}`} />
                {done.length} completed
              </button>
              <AnimatePresence initial={false}>
                {showCompleted && (
                  <motion.ul
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-3 overflow-hidden"
                  >
                    {done.map((o) => (
                      <ObjectiveCard
                        key={o.id}
                        o={o}
                        weekProgressPct={weekProgressPct}
                        onToggle={() => update.mutate({ id: o.id, patch: { status: 'active' } })}
                        onDelete={() => del.mutate(o.id)}
                      />
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
