import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  PartyPopper,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { ObjectiveDTO, WeeklyReviewInput } from '@timeblock/shared';
import { useCompleteWeeklyReview, useReopenWeeklyReview, useSaveWeeklyReview, useWeeklyReview } from '../hooks.js';
import StarRating from '../components/StarRating.js';
import { fmtDur } from '../components/today/format.js';
import { fadeInUp, listItem, springs } from '../lib/motion.js';

function currentWeekStart(): string {
  return DateTime.now().startOf('week').toISODate()!;
}

function weekLabel(weekStart: string): string {
  const start = DateTime.fromISO(weekStart);
  const end = start.plus({ days: 6 });
  const sameMonth = start.month === end.month;
  return sameMonth
    ? `${start.toFormat('MMM d')}–${end.toFormat('d, yyyy')}`
    : `${start.toFormat('MMM d')} – ${end.toFormat('MMM d, yyyy')}`;
}

const inputCls =
  'w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-400/20 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100';

// ---------- pieces ----------

function WeekNav({
  weekStart,
  onShift,
  onToday,
  isCurrent,
}: {
  weekStart: string;
  onShift: (delta: number) => void;
  onToday: () => void;
  isCurrent: boolean;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900">
      <button
        onClick={() => onShift(-1)}
        title="Previous week"
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-white/5"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[9.5rem] px-1 text-center text-sm font-medium tabular-nums text-slate-700 dark:text-neutral-200">
        {weekLabel(weekStart)}
      </span>
      <button
        onClick={() => onShift(1)}
        disabled={isCurrent}
        title="Next week"
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-neutral-400 dark:hover:bg-white/5"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      {!isCurrent && (
        <button
          onClick={onToday}
          className="ml-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-teal-600 hover:bg-teal-50 dark:border-neutral-700 dark:text-teal-400 dark:hover:bg-teal-500/10"
        >
          This week
        </button>
      )}
    </div>
  );
}

/** Big score hero: completion % as a ring-free progress bar, with a one-line read of how the week went. */
function ScoreHero({
  completionRate,
  completedMin,
  plannedMin,
  missedMin,
  rating,
}: {
  completionRate: number;
  completedMin: number;
  plannedMin: number;
  missedMin: number;
  rating: number | null;
}) {
  const pct = Math.round(completionRate * 100);
  const tone = pct >= 80 ? 'emerald' : pct >= 50 ? 'amber' : 'rose';
  const toneCls = { emerald: 'text-emerald-500 dark:text-emerald-400', amber: 'text-amber-500 dark:text-amber-400', rose: 'text-rose-500 dark:text-rose-400' }[tone];
  const barCls = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500' }[tone];
  const verdict =
    plannedMin === 0
      ? 'Nothing was scheduled this week.'
      : pct >= 80
        ? 'Strong week — most of what you planned got done.'
        : pct >= 50
          ? 'A mixed week — about half of what you planned landed.'
          : 'A tough week — a lot slipped. Worth digging into why below.';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className={`text-4xl font-bold tabular-nums ${toneCls}`}>{pct}%</div>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">{verdict}</p>
        </div>
        {rating != null && (
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs text-slate-400 dark:text-neutral-500">Your rating</span>
            <StarRating value={rating} size="sm" />
          </div>
        )}
      </div>

      <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
        <motion.div
          className={`h-full rounded-full ${barCls}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={springs.soft}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs tabular-nums text-slate-400 dark:text-neutral-500">
        <span>{fmtDur(completedMin)} completed</span>
        <span>{fmtDur(plannedMin)} planned</span>
      </div>
      {missedMin > 0 && (
        <p className="mt-1 text-xs text-rose-500 dark:text-rose-400">{fmtDur(missedMin)} missed</p>
      )}
    </div>
  );
}

function StatTile({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-1.5 text-slate-400 dark:text-neutral-500">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className={`mt-1.5 text-xl font-bold tabular-nums ${tone ?? 'text-slate-900 dark:text-neutral-100'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400 dark:text-neutral-500">{sub}</div>}
    </div>
  );
}

function ObjectiveRow({ o }: { o: ObjectiveDTO }) {
  const target = o.targetMinutes ?? o.targetCount ?? 0;
  const progress = (o.targetMinutes != null ? o.progressMinutes : o.progressCount) ?? 0;
  const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : null;
  const done = o.status === 'done';
  const dropped = o.status === 'dropped';

  return (
    <motion.li variants={listItem} className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <span className={`truncate text-sm ${done ? 'text-slate-400 line-through dark:text-neutral-500' : dropped ? 'text-slate-400 dark:text-neutral-500' : 'text-slate-700 dark:text-neutral-200'}`}>
          {o.title}
        </span>
        {pct != null && (
          <span className="shrink-0 tabular-nums text-xs text-slate-400 dark:text-neutral-500">
            {o.targetMinutes != null ? fmtDur(progress) : progress}/{o.targetMinutes != null ? fmtDur(target) : target}
          </span>
        )}
      </div>
      {pct != null && (
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800">
          <motion.div
            className={`h-full rounded-full ${done ? 'bg-emerald-500' : dropped ? 'bg-slate-300 dark:bg-neutral-700' : 'bg-teal-500'}`}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={springs.soft}
          />
        </div>
      )}
    </motion.li>
  );
}

function JournalField({
  icon,
  accent,
  label,
  placeholder,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  accent: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-neutral-300">
        <span className={accent}>{icon}</span>
        {label}
      </label>
      <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} placeholder={placeholder} />
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-neutral-800/60" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-neutral-800/60" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-slate-100 dark:bg-neutral-800/60" />
    </div>
  );
}

// ---------- page ----------

export default function WeeklyReviewPage() {
  const [weekStart, setWeekStart] = useState(currentWeekStart());
  const { data: review, isLoading } = useWeeklyReview(weekStart);
  const save = useSaveWeeklyReview();
  const complete = useCompleteWeeklyReview();
  const reopen = useReopenWeeklyReview();

  const [form, setForm] = useState<WeeklyReviewInput>({ wins: '', challenges: '', nextWeekFocus: '', rating: null });

  useEffect(() => {
    if (review) setForm({ wins: review.wins, challenges: review.challenges, nextWeekFocus: review.nextWeekFocus, rating: review.rating });
  }, [review?.weekStart, review?.reviewedAt]);

  const shiftWeek = (deltaWeeks: number) => setWeekStart(DateTime.fromISO(weekStart).plus({ weeks: deltaWeeks }).toISODate()!);
  const isCurrent = weekStart === currentWeekStart();
  const done = !!review?.reviewedAt;
  const s = review?.summary;

  const activeObjectives = review?.objectives.filter((o) => o.status !== 'dropped') ?? [];
  const objectivesPct = s && s.objectivesTotal > 0 ? Math.round((s.objectivesDone / s.objectivesTotal) * 100) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarRange size={18} className="text-teal-500" />
          <h1 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">Weekly review</h1>
        </div>
        <WeekNav weekStart={weekStart} onShift={shiftWeek} onToday={() => setWeekStart(currentWeekStart())} isCurrent={isCurrent} />
      </div>

      {isLoading || !s ? (
        <LoadingSkeleton />
      ) : (
        <motion.div initial="initial" animate="animate" variants={fadeInUp} className="space-y-5">
          <AnimatePresence>
            {done && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
              >
                <PartyPopper className="h-4 w-4 shrink-0" />
                <span>Review completed {DateTime.fromISO(review!.reviewedAt!).toRelative()}</span>
                <button onClick={() => reopen.mutate(weekStart)} disabled={reopen.isPending} className="ml-auto shrink-0 text-xs underline hover:no-underline disabled:opacity-50">
                  Reopen
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <ScoreHero completionRate={s.completionRate} completedMin={s.completedMin} plannedMin={s.plannedMin} missedMin={s.missedMin} rating={done ? form.rating : null} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile
              icon={<Target size={13} />}
              label="Objectives"
              value={s.objectivesTotal > 0 ? `${s.objectivesDone}/${s.objectivesTotal}` : '—'}
              sub={objectivesPct != null ? `${objectivesPct}% done` : 'none set'}
              tone={objectivesPct === 100 ? 'text-emerald-500 dark:text-emerald-400' : undefined}
            />
            <StatTile
              icon={<CheckCircle2 size={13} />}
              label="Days met"
              value={`${s.daysMet}/${s.daysEvaluated}`}
              sub="streak days"
            />
            <StatTile
              icon={s.completionRate >= 0.5 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
              label="Focused time"
              value={fmtDur(s.completedMin)}
              sub={`of ${fmtDur(s.plannedMin)} planned`}
            />
          </div>

          {activeObjectives.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-neutral-300">
                <Target size={14} className="text-teal-500" />
                This week&rsquo;s objectives
              </h2>
              <motion.ul initial="initial" animate="animate" variants={{ animate: { transition: { staggerChildren: 0.03 } } }} className="divide-y divide-slate-100 dark:divide-neutral-800">
                {activeObjectives.map((o) => (
                  <ObjectiveRow key={o.id} o={o} />
                ))}
              </motion.ul>
            </div>
          )}

          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-neutral-800">
              <span className="text-sm font-medium text-slate-700 dark:text-neutral-300">How was this week overall?</span>
              <StarRating value={form.rating} onChange={(v) => setForm({ ...form, rating: v })} />
            </div>

            <JournalField
              icon={<TrendingUp size={14} />}
              accent="text-emerald-500 dark:text-emerald-400"
              label="Wins — what went well?"
              placeholder="Wins, progress, moments you're proud of…"
              value={form.wins}
              onChange={(v) => setForm({ ...form, wins: v })}
            />
            <JournalField
              icon={<TrendingDown size={14} />}
              accent="text-amber-500 dark:text-amber-400"
              label="Challenges — what got in the way?"
              placeholder="Obstacles, distractions, things to change…"
              value={form.challenges}
              onChange={(v) => setForm({ ...form, challenges: v })}
            />
            <JournalField
              icon={<Clock size={14} />}
              accent="text-teal-500 dark:text-teal-400"
              label="Focus for next week"
              placeholder="What matters most next week?"
              value={form.nextWeekFocus}
              onChange={(v) => setForm({ ...form, nextWeekFocus: v })}
            />

            <div className="flex gap-2 pt-1">
              {!done ? (
                <>
                  <button
                    onClick={() => complete.mutate({ weekStart, input: form })}
                    disabled={complete.isPending}
                    className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
                  >
                    {complete.isPending ? 'Completing…' : 'Complete review'}
                  </button>
                  <button
                    onClick={() => save.mutate({ weekStart, input: form })}
                    disabled={save.isPending}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-white/5"
                  >
                    {save.isPending ? 'Saving…' : 'Save draft'}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => save.mutate({ weekStart, input: form })}
                  disabled={save.isPending}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-white/5"
                >
                  {save.isPending ? 'Saving…' : 'Update notes'}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
