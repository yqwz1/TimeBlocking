import { useMemo, useState, type FormEvent } from 'react';
import { DateTime } from 'luxon';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ListChecks,
  Minus,
  Pencil,
  Plus,
  Target,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type { ObjectiveDTO, ObjectiveInput } from '@timeblock/shared';
import { useCreateObjective, useDeleteObjective, useHabits, useObjectives, useProjects, useUpdateObjective } from '../hooks.js';
import { formatMinutes, LINK_ICON } from '../components/rail/WeeklyObjectivesPanel.js';
import { listItem, springs } from '../lib/motion.js';

/* ---------- week helpers ---------- */

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

interface WeekPace {
  /** 0–100, how much of the viewed week has elapsed */
  pct: number;
  isCurrent: boolean;
  isPast: boolean;
  isFuture: boolean;
  /** whole days remaining in the week including today (current week only) */
  daysLeft: number;
}

function paceFor(weekStart: string): WeekPace {
  const start = DateTime.fromISO(weekStart).startOf('day');
  const daysElapsed = Math.min(7, Math.max(0, DateTime.now().diff(start, 'days').days));
  const pct = Math.round((daysElapsed / 7) * 100);
  return {
    pct,
    isCurrent: weekStart === currentWeekStart(),
    isPast: pct >= 100 && weekStart !== currentWeekStart(),
    isFuture: daysElapsed <= 0 && weekStart !== currentWeekStart(),
    daysLeft: Math.max(1, 7 - Math.floor(daysElapsed)),
  };
}

/* ---------- progress helpers ---------- */

function computeProgress(o: ObjectiveDTO) {
  const usesCount = !o.targetMinutes && !!o.targetCount;
  const target = usesCount ? o.targetCount! : (o.targetMinutes ?? 0);
  const progress = usesCount ? o.progressCount : o.progressMinutes;
  const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0;
  const plannedPct =
    !usesCount && target > 0 ? Math.min(100, Math.round((Math.max(o.plannedMinutes, progress) / target) * 100)) : pct;
  return { usesCount, target, progress, pct, plannedPct };
}

function isBehindPace(o: ObjectiveDTO, pace: WeekPace): boolean {
  const { target, pct } = computeProgress(o);
  return o.status !== 'done' && target > 0 && pace.isCurrent && pace.pct > 15 && pct + 12 < pace.pct;
}

/* ---------- shared styles ---------- */

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-shadow focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/25 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500';

const fieldLabelCls = 'mb-1 block text-xs font-medium text-slate-600 dark:text-neutral-300';

const iconBtnCls =
  'cursor-pointer rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:hover:bg-white/5 dark:hover:text-neutral-300';

const logChipCls =
  'cursor-pointer rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium tabular-nums text-slate-600 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-teal-500/40 dark:hover:bg-teal-500/10 dark:hover:text-teal-300';

/* ---------- pace tick ---------- */

function PaceTick({ pace }: { pace: WeekPace }) {
  if (!pace.isCurrent || pace.pct <= 0 || pace.pct >= 100) return null;
  return (
    <div
      title={`Week ${pace.pct}% elapsed`}
      className="absolute inset-y-0 z-10 w-0.5 rounded-full bg-slate-500/50 dark:bg-neutral-300/40"
      style={{ left: `${pace.pct}%` }}
    />
  );
}

/* ---------- create / edit form ---------- */

type TrackBy = 'none' | 'time' | 'count';

const TRACK_BY_OPTIONS: [TrackBy, string, string, typeof X][] = [
  ['none', 'Simple', 'Just mark it done when finished', Check],
  ['time', 'Time', 'Target hours for the week', Clock3],
  ['count', 'Count', 'Target number of times', ListChecks],
];

function ObjectiveForm({ weekStart, existing, onDone }: { weekStart: string; existing?: ObjectiveDTO; onDone: () => void }) {
  const { data: projects } = useProjects();
  const { data: habits } = useHabits();
  const create = useCreateObjective();
  const update = useUpdateObjective();

  const initialTrackBy: TrackBy = existing?.targetMinutes ? 'time' : existing?.targetCount ? 'count' : 'none';
  const [title, setTitle] = useState(existing?.title ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [trackBy, setTrackBy] = useState<TrackBy>(initialTrackBy);
  const [hours, setHours] = useState(existing?.targetMinutes ? String(Math.floor(existing.targetMinutes / 60)) : '');
  const [minutes, setMinutes] = useState(existing?.targetMinutes ? String(existing.targetMinutes % 60) : '');
  const [count, setCount] = useState(existing?.targetCount ? String(existing.targetCount) : '');
  const [linkKind, setLinkKind] = useState<ObjectiveInput['linkKind']>(existing?.linkKind ?? null);
  const [linkValue, setLinkValue] = useState<string | null>(existing?.linkValue ?? null);

  const pending = create.isPending || update.isPending;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const targetMinutes = trackBy === 'time' ? Number(hours || 0) * 60 + Number(minutes || 0) || null : null;
    const targetCount = trackBy === 'count' ? Number(count) || null : null;
    const fields = { title: title.trim(), targetMinutes, targetCount, linkKind, linkValue: linkKind ? linkValue : null, notes };
    if (existing) {
      update.mutate({ id: existing.id, patch: fields }, { onSuccess: onDone });
    } else {
      create.mutate({ weekStart, ...fields }, { onSuccess: onDone });
    }
  };

  return (
    <motion.form
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={springs.soft}
      onSubmit={handleSubmit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDone();
      }}
      className="space-y-4 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div>
        <label className={fieldLabelCls}>What do you want to accomplish?</label>
        <input
          required
          autoFocus
          placeholder="e.g. Ship the redesign"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputCls}
        />
      </div>

      <div>
        <label className={fieldLabelCls}>Track progress by</label>
        <div className="flex gap-1.5">
          {TRACK_BY_OPTIONS.map(([val, label, hint, Icon]) => (
            <button
              key={val}
              type="button"
              title={hint}
              onClick={() => setTrackBy(val)}
              className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 ${
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
            <input type="number" min={0} placeholder="0" value={hours} onChange={(e) => setHours(e.target.value)} className={`${inputCls} w-16`} />
            <span className="text-xs text-slate-400 dark:text-neutral-500">hrs</span>
            <input type="number" min={0} max={59} placeholder="0" value={minutes} onChange={(e) => setMinutes(e.target.value)} className={`${inputCls} w-16`} />
            <span className="text-xs text-slate-400 dark:text-neutral-500">min this week</span>
          </div>
        )}
        {trackBy === 'count' && (
          <div className="mt-2 flex items-center gap-2">
            <input type="number" min={1} placeholder="e.g. 5" value={count} onChange={(e) => setCount(e.target.value)} className={`${inputCls} w-20`} />
            <span className="text-xs text-slate-400 dark:text-neutral-500">times this week</span>
          </div>
        )}
      </div>

      <div>
        <label className={fieldLabelCls}>Auto-track from (optional)</label>
        <div className="flex gap-2">
          <select
            value={linkKind ?? ''}
            onChange={(e) => {
              setLinkKind((e.target.value || null) as ObjectiveInput['linkKind']);
              setLinkValue(null);
            }}
            className={`${inputCls} w-auto`}
          >
            <option value="">Nothing — I&rsquo;ll log progress myself</option>
            <option value="project">Project</option>
            <option value="label">Label</option>
            <option value="habit">Habit</option>
          </select>
          {linkKind === 'project' && (
            <select value={linkValue ?? ''} onChange={(e) => setLinkValue(e.target.value || null)} className={`${inputCls} flex-1`}>
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
              className={`${inputCls} flex-1`}
            />
          )}
          {linkKind === 'habit' && (
            <select value={linkValue ?? ''} onChange={(e) => setLinkValue(e.target.value || null)} className={`${inputCls} flex-1`}>
              <option value="">Choose habit…</option>
              {(habits ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {linkKind ? (
          <p className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">
            Progress updates automatically from matching work — and you can still log extra on top.
          </p>
        ) : (
          <p className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">You&rsquo;ll log progress with quick buttons right on the card.</p>
        )}
      </div>

      <div>
        <label className={fieldLabelCls}>Notes (optional)</label>
        <textarea
          rows={2}
          placeholder="Why this matters, definition of done, anything worth remembering…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={`${inputCls} resize-y`}
        />
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-neutral-800">
        <button
          type="button"
          onClick={onDone}
          className="cursor-pointer rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:text-neutral-400 dark:hover:bg-white/5"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="cursor-pointer rounded-md bg-teal-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 disabled:opacity-50"
        >
          {pending ? 'Saving…' : existing ? 'Save changes' : 'Add objective'}
        </button>
      </div>
    </motion.form>
  );
}

/* ---------- objective card ---------- */

function ObjectiveCard({
  o,
  pace,
  linkLabel,
  carryLabel,
  onToggle,
  onDelete,
  onCarry,
}: {
  o: ObjectiveDTO;
  pace: WeekPace;
  linkLabel: string | null;
  carryLabel: string;
  onToggle: () => void;
  onDelete: () => void;
  onCarry: () => void;
}) {
  const update = useUpdateObjective();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);

  const { usesCount, target, progress, pct, plannedPct } = computeProgress(o);
  const hasTarget = target > 0;
  const done = o.status === 'done';
  const behind = isBehindPace(o, pace);
  const missed = !done && pace.isPast && (hasTarget ? pct < 100 : true);
  const format = usesCount ? (n: number) => `${n}` : formatMinutes;
  const unit = usesCount ? (target === 1 ? ' item' : ' items') : '';
  const LinkIcon = o.linkKind ? LINK_ICON[o.linkKind] : null;

  const autoMinutes = o.progressMinutes - o.manualMinutes;
  const autoCount = o.progressCount - o.manualCount;
  const hasAuto = !!o.linkKind;
  const hasManual = usesCount ? o.manualCount > 0 : o.manualMinutes > 0;

  const remaining = Math.max(0, target - progress);
  const perDayHint =
    !done && !usesCount && hasTarget && pace.isCurrent && remaining > 0 ? `≈${formatMinutes(Math.ceil(remaining / pace.daysLeft / 5) * 5)}/day to finish` : null;

  const logMinutes = (delta: number) =>
    update.mutate({ id: o.id, patch: { manualMinutes: Math.max(0, o.manualMinutes + delta) } });
  const logCount = (delta: number) => update.mutate({ id: o.id, patch: { manualCount: Math.max(0, o.manualCount + delta) } });

  if (editing) {
    return (
      <motion.li layout variants={listItem} initial="initial" animate="animate" exit="exit" className="list-none">
        <ObjectiveForm weekStart={o.weekStart} existing={o} onDone={() => setEditing(false)} />
      </motion.li>
    );
  }

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
            <p className={`break-words font-medium ${done ? 'text-slate-500 line-through dark:text-neutral-500' : 'text-slate-900 dark:text-neutral-100'}`}>
              {o.title}
            </p>
            {behind && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                <AlertTriangle size={11} /> Behind pace
              </span>
            )}
            {missed && (
              <span className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-white/5 dark:text-neutral-400">
                Not finished
              </span>
            )}
          </div>
          {o.linkKind && LinkIcon && (
            <span className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400 dark:text-neutral-500">
              <LinkIcon size={12} /> Auto-tracked · {linkLabel ?? o.linkValue ?? o.linkKind}
            </span>
          )}
          {o.notes && (
            <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-slate-500 dark:text-neutral-400">{o.notes}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {confirming ? (
            <>
              <button
                onClick={onDelete}
                className="cursor-pointer rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="cursor-pointer rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:text-neutral-400 dark:hover:bg-white/5"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onToggle}
                title={done ? 'Reopen objective' : 'Mark objective done'}
                className={`flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 ${
                  done
                    ? 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-white/5'
                    : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10'
                }`}
              >
                {done ? <Undo2 size={12} /> : <Check size={12} />}
                {done ? 'Reopen' : 'Done'}
              </button>
              <button onClick={() => setEditing(true)} title="Edit objective" aria-label="Edit objective" className={iconBtnCls}>
                <Pencil size={14} />
              </button>
              {!done && (
                <button onClick={onCarry} title={carryLabel} aria-label={carryLabel} className={iconBtnCls}>
                  <ArrowRight size={14} />
                </button>
              )}
              <button
                onClick={() => setConfirming(true)}
                title="Delete objective"
                aria-label="Delete objective"
                className="cursor-pointer rounded-md border border-transparent p-1.5 text-slate-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 dark:hover:border-red-500/30 dark:hover:bg-red-500/10 dark:hover:text-red-400"
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
            <PaceTick pace={pace} />
            {!usesCount && plannedPct > pct && (
              <div className="absolute inset-y-0 left-0 rounded-full bg-teal-300/50 dark:bg-teal-500/25" style={{ width: `${plannedPct}%` }} />
            )}
            <motion.div
              className={`absolute inset-y-0 left-0 rounded-full ${done ? 'bg-emerald-500' : behind ? 'bg-amber-500' : 'bg-teal-500'}`}
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={springs.soft}
            />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs tabular-nums">
            <span className="text-slate-500 dark:text-neutral-400">
              {format(progress)}
              {unit} of {format(target)}
              {unit} · {pct}%
              {hasAuto && hasManual && (
                <span className="text-slate-400 dark:text-neutral-500">
                  {' '}
                  (auto {usesCount ? autoCount : formatMinutes(autoMinutes)} · logged {usesCount ? o.manualCount : formatMinutes(o.manualMinutes)})
                </span>
              )}
            </span>
            {!done && (
              <span className="text-slate-400 dark:text-neutral-500">
                {format(remaining)}
                {unit} left{perDayHint ? ` · ${perDayHint}` : ''}
              </span>
            )}
          </div>
        </>
      )}

      {!done && hasTarget && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-slate-400 dark:text-neutral-500">Log:</span>
          {usesCount ? (
            <>
              {o.manualCount > 0 && (
                <button onClick={() => logCount(-1)} title="Remove one" aria-label="Remove one" className={logChipCls}>
                  <Minus size={11} className="inline" /> 1
                </button>
              )}
              <button onClick={() => logCount(1)} title="Log one" aria-label="Log one" className={logChipCls}>
                <Plus size={11} className="inline" /> 1
              </button>
            </>
          ) : (
            <>
              {o.manualMinutes > 0 && (
                <button onClick={() => logMinutes(-15)} title="Remove 15 minutes" className={logChipCls}>
                  −15m
                </button>
              )}
              <button onClick={() => logMinutes(15)} className={logChipCls}>
                +15m
              </button>
              <button onClick={() => logMinutes(30)} className={logChipCls}>
                +30m
              </button>
              <button onClick={() => logMinutes(60)} className={logChipCls}>
                +1h
              </button>
            </>
          )}
        </div>
      )}
    </motion.li>
  );
}

/* ---------- page ---------- */

export default function ObjectivesPage() {
  const [weekStart, setWeekStart] = useState(currentWeekStart);
  const { data: objectives, isLoading } = useObjectives(weekStart);
  const { data: projects } = useProjects();
  const { data: habits } = useHabits();
  const update = useUpdateObjective();
  const del = useDeleteObjective();
  const [showForm, setShowForm] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  const pace = paceFor(weekStart);
  const all = objectives ?? [];
  const active = all.filter((o) => o.status !== 'done');
  const done = all.filter((o) => o.status === 'done');
  const behindCount = active.filter((o) => isBehindPace(o, pace)).length;

  const shiftWeek = (weeks: number) => setWeekStart(DateTime.fromISO(weekStart).plus({ weeks }).toISODate()!);

  const linkLabelFor = (o: ObjectiveDTO): string | null => {
    if (!o.linkKind || !o.linkValue) return null;
    if (o.linkKind === 'project') return (projects ?? []).find((p) => p.id === o.linkValue)?.name ?? o.linkValue;
    if (o.linkKind === 'habit') return (habits ?? []).find((h) => h.id === o.linkValue)?.name ?? o.linkValue;
    return o.linkValue;
  };

  // Carrying an unfinished objective forward: past weeks bring it into this week, otherwise push to the following week.
  const carryTarget = pace.isPast ? currentWeekStart() : DateTime.fromISO(weekStart).plus({ weeks: 1 }).toISODate()!;
  const carryLabel = pace.isPast ? 'Move to this week' : 'Move to next week';
  const carry = (o: ObjectiveDTO) =>
    update.mutate({ id: o.id, patch: { weekStart: carryTarget, manualMinutes: 0, manualCount: 0 } });

  const timeStats = useMemo(() => {
    const timed = all.filter((o) => (o.targetMinutes ?? 0) > 0);
    const targetMin = timed.reduce((s, o) => s + o.targetMinutes!, 0);
    const doneMin = timed.reduce((s, o) => s + Math.min(o.progressMinutes, o.targetMinutes!), 0);
    return targetMin > 0 ? { targetMin, doneMin } : null;
  }, [all]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Target size={18} className="text-teal-500" />
            <h1 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">
              {pace.isCurrent ? 'This week’s objectives' : 'Objectives'}
            </h1>
            {pace.isFuture && (
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">
                Planning ahead
              </span>
            )}
            {pace.isPast && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-white/5 dark:text-neutral-400">
                Past week
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-400 dark:text-neutral-500">{weekRangeLabel(weekStart)}</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-slate-200 dark:border-neutral-700">
            <button onClick={() => shiftWeek(-1)} title="Previous week" aria-label="Previous week" className={iconBtnCls}>
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setWeekStart(currentWeekStart())}
              disabled={pace.isCurrent}
              className="cursor-pointer px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 disabled:cursor-default disabled:opacity-40 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              This week
            </button>
            <button onClick={() => shiftWeek(1)} title="Next week" aria-label="Next week" className={iconBtnCls}>
              <ChevronRight size={16} />
            </button>
          </div>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="flex cursor-pointer items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              <Plus size={15} /> New objective
            </button>
          )}
        </div>
      </div>

      {all.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="min-w-[12rem] flex-1">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-neutral-400">
              <span>
                {done.length} of {all.length} complete
              </span>
              {pace.isCurrent && <span>Week {pace.pct}% elapsed</span>}
            </div>
            <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
              <PaceTick pace={pace} />
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${all.length ? Math.round((done.length / all.length) * 100) : 0}%` }}
              />
            </div>
          </div>
          {timeStats && (
            <div className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-neutral-400">
              <span className="font-semibold text-slate-700 dark:text-neutral-200">{formatMinutes(timeStats.doneMin)}</span> of{' '}
              {formatMinutes(timeStats.targetMin)} focused
            </div>
          )}
          {behindCount > 0 && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              <AlertTriangle size={12} /> {behindCount} behind pace
            </span>
          )}
        </div>
      )}

      <AnimatePresence initial={false}>
        {showForm && <ObjectiveForm weekStart={weekStart} onDone={() => setShowForm(false)} />}
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
          <p className="mt-2 text-sm text-slate-500 dark:text-neutral-400">
            {pace.isFuture ? 'Nothing planned for this week yet.' : pace.isPast ? 'No objectives were set this week.' : 'No objectives yet this week.'}
          </p>
          {!pace.isPast && (
            <>
              <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">
                Set 1–3 things that matter most — linked objectives get prioritized automatically in your schedule.
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
              >
                <Plus size={14} /> {pace.isFuture ? 'Plan this week' : 'Add your first objective'}
              </button>
            </>
          )}
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
                    pace={pace}
                    linkLabel={linkLabelFor(o)}
                    carryLabel={carryLabel}
                    onToggle={() => update.mutate({ id: o.id, patch: { status: 'done' } })}
                    onDelete={() => del.mutate(o.id)}
                    onCarry={() => carry(o)}
                  />
                ))}
              </AnimatePresence>
            </ul>
          )}

          {done.length > 0 && (
            <div>
              <button
                onClick={() => setShowCompleted((v) => !v)}
                className="flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1.5 text-xs font-medium text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 dark:text-neutral-500 dark:hover:text-neutral-300"
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
                        pace={pace}
                        linkLabel={linkLabelFor(o)}
                        carryLabel={carryLabel}
                        onToggle={() => update.mutate({ id: o.id, patch: { status: 'active' } })}
                        onDelete={() => del.mutate(o.id)}
                        onCarry={() => carry(o)}
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
