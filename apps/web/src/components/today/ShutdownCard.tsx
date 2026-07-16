import { useEffect, useState } from 'react';
import { CheckCircle2, Moon } from 'lucide-react';
import type { DailyPlanDTO } from '@timeblock/shared';
import { useReopenShutdown, useShutdownDay } from '../../hooks.js';
import StarRating from '../StarRating.js';
import { fmtDur } from './format.js';

const card = 'rounded-xl border border-slate-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/40';
const label = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500';
const field =
  'w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-600';

function Stat({ label: statLabel, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center dark:bg-neutral-800/60">
      <div className={`text-base font-bold tabular-nums ${tone ?? 'text-slate-700 dark:text-neutral-200'}`}>{value}</div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-neutral-500">{statLabel}</div>
    </div>
  );
}

/** End-of-day shutdown ritual (Cal Newport / Sunsama): review the day, reflect, set tomorrow's intention. */
export default function ShutdownCard({ daily, date }: { daily: DailyPlanDTO | undefined; date: string }) {
  const shutdown = useShutdownDay();
  const reopen = useReopenShutdown();
  const [open, setOpen] = useState(false);
  const [reflection, setReflection] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [intention, setIntention] = useState('');

  const isDone = !!daily?.shutdownDoneAt;
  const summary = daily?.summary;

  useEffect(() => {
    if (daily) {
      setReflection(daily.reflection);
      setRating(daily.rating);
      setIntention(daily.intention);
    }
  }, [daily?.reflection, daily?.rating, daily?.intention, daily?.shutdownDoneAt]);

  if (!daily || !summary) return null;

  if (isDone) {
    return (
      <section className={card}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">Day shut down</h3>
          <CheckCircle2 size={15} className="text-emerald-500" aria-hidden />
        </div>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500 dark:text-neutral-400">
              {summary.doneCount} done · {summary.missedCount} missed · {fmtDur(summary.completedMin)} focused
            </span>
            {daily.rating != null && <StarRating value={daily.rating} size="sm" />}
          </div>
          {daily.reflection && (
            <p className="whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-neutral-800/60 dark:text-neutral-300">
              {daily.reflection}
            </p>
          )}
          {daily.intention && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">First thing tomorrow</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600 dark:text-neutral-300">{daily.intention}</p>
            </div>
          )}
          <button
            onClick={() => reopen.mutate(date)}
            disabled={reopen.isPending}
            className="cursor-pointer text-xs text-slate-400 hover:text-slate-600 disabled:opacity-50 dark:text-neutral-500 dark:hover:text-neutral-300"
          >
            Reopen day
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={card}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">Shut down your day</h3>
        <Moon size={14} className="text-teal-500" aria-hidden />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Done" value={summary.doneCount} tone="text-emerald-600 dark:text-emerald-400" />
        <Stat label="Missed" value={summary.missedCount} tone={summary.missedCount > 0 ? 'text-rose-600 dark:text-rose-400' : undefined} />
        <Stat label="Left" value={summary.remainingCount} />
      </div>
      <p className="mt-2 text-center text-xs text-slate-400 dark:text-neutral-500">
        {fmtDur(summary.completedMin)} focused of {fmtDur(summary.plannedMin)} planned
      </p>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-3 w-full cursor-pointer rounded-md bg-teal-600 px-3 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-teal-500"
        >
          Start shutdown
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            shutdown.mutate({ date, input: { reflection: reflection.trim(), rating, intention: intention.trim() } });
          }}
          className="mt-3 space-y-3"
        >
          <div>
            <label className={label}>How did today feel?</label>
            <StarRating value={rating} onChange={setRating} />
          </div>
          <div>
            <label className={label}>Reflection</label>
            <textarea
              value={reflection}
              onChange={(e) => setReflection(e.target.value)}
              rows={3}
              placeholder="What went well? What got in the way?"
              className={field}
            />
          </div>
          <div>
            <label className={label}>First thing tomorrow</label>
            <textarea
              value={intention}
              onChange={(e) => setIntention(e.target.value)}
              rows={2}
              placeholder="One thing to pick up first tomorrow…"
              className={field}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={shutdown.isPending}
              className="flex-1 cursor-pointer rounded-md bg-teal-600 px-3 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-teal-500 disabled:opacity-50"
            >
              {shutdown.isPending ? 'Wrapping up…' : 'Complete shutdown'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="cursor-pointer rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Later
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
