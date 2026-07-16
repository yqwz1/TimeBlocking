import { ExternalLink, Lock, Sparkles, Video } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ScheduleItemDTO } from '@timeblock/shared';
import { useCompleteHabitToday, useCompleteTask } from '../../hooks.js';
import { useNowTick } from './useNowTick.js';
import { fmtDur, fmtTime, blockMinutes } from './format.js';
import { KindIcon } from './SectionCard.js';

function DoneButton({ item }: { item: ScheduleItemDTO }) {
  const complete = useCompleteTask();
  const completeHabit = useCompleteHabitToday();
  const mutate =
    item.kind === 'task' && item.taskId
      ? () => complete.mutate(item.taskId!)
      : item.kind === 'habit' && item.habitId
        ? () => completeHabit.mutate(item.habitId!)
        : null;
  if (!mutate) return null;
  const pending = complete.isPending || completeHabit.isPending;
  return (
    <button
      onClick={mutate}
      disabled={pending}
      className="shrink-0 cursor-pointer rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-teal-500 disabled:opacity-50"
    >
      {pending ? '…' : 'Mark done'}
    </button>
  );
}

function JoinLink({ item }: { item: ScheduleItemDTO }) {
  if (!item.meetingUrl) return null;
  return (
    <a
      href={item.meetingUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors duration-150 hover:border-teal-300 hover:text-teal-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-teal-500/50 dark:hover:text-teal-400"
    >
      <Video size={13} /> Join
    </a>
  );
}

function ItemTitle({ item, className }: { item: ScheduleItemDTO; className: string }) {
  if (item.taskId)
    return (
      <Link to={`/tasks?task=${item.taskId}`} className={`${className} hover:underline`}>
        {item.title}
      </Link>
    );
  return <span className={className}>{item.title}</span>;
}

function metaLine(item: ScheduleItemDTO) {
  const parts = [`${fmtTime(item.start)}–${fmtTime(item.end)}`, fmtDur(blockMinutes(item))];
  if (item.chunk) parts.push(`part ${item.chunk.index + 1} of ${item.chunk.count}`);
  if (item.projectName) parts.push(item.projectName);
  return parts.join(' · ');
}

/** "What should I be doing right now" hero: current block with live progress, or the next one coming up. */
export default function NowCard({ blocks }: { blocks: ScheduleItemDTO[] }) {
  const now = useNowTick(10_000);

  const active = blocks.find((b) => Date.parse(b.start) <= now && Date.parse(b.end) > now && b.status !== 'done' && b.status !== 'missed');
  const upcoming = blocks
    .filter((b) => Date.parse(b.start) > now && b.status !== 'done' && b.status !== 'missed')
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const next = upcoming[0];

  if (!active && !next) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 dark:border-neutral-800 dark:bg-neutral-900/40">
        <Sparkles size={16} className="shrink-0 text-teal-500" aria-hidden />
        <div>
          <p className="text-sm font-medium text-slate-800 dark:text-neutral-100">You're all clear</p>
          <p className="text-xs text-slate-400 dark:text-neutral-500">Nothing scheduled for the rest of today.</p>
        </div>
      </div>
    );
  }

  // Nothing running — show what's coming up.
  if (!active && next) {
    const startsIn = Math.max(0, Math.round((Date.parse(next.start) - now) / 60000));
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 dark:border-neutral-800 dark:bg-neutral-900/40">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
            Up next
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <KindIcon kind={next.kind} className="shrink-0 text-slate-400 dark:text-neutral-500" />
            <ItemTitle item={next} className="truncate text-[15px] font-semibold text-slate-900 dark:text-neutral-50" />
          </div>
          <JoinLink item={next} />
        </div>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-neutral-400">
          starts in <span className="font-semibold text-teal-600 dark:text-teal-400">{fmtDur(startsIn)}</span>
          <span className="text-slate-400 dark:text-neutral-500"> · {metaLine(next)}</span>
        </p>
      </div>
    );
  }

  const item = active!;
  const start = Date.parse(item.start);
  const end = Date.parse(item.end);
  const pct = Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
  const leftMin = Math.max(0, Math.round((end - now) / 60000));

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/40 p-4 dark:border-teal-500/25 dark:bg-teal-500/[0.05]">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-teal-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden />
          Now
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <KindIcon kind={item.kind} className="shrink-0 text-teal-600 dark:text-teal-400" />
            <ItemTitle item={item} className="truncate text-base font-semibold text-slate-900 dark:text-neutral-50" />
            {item.locked && <Lock size={12} className="shrink-0 text-slate-400 dark:text-neutral-500" aria-label="Locked" />}
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-neutral-400">{metaLine(item)}</p>
          {item.reasons && item.reasons.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {item.reasons.slice(0, 2).map((r, i) => (
                <span
                  key={i}
                  title={r.detail ?? r.label}
                  className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200 dark:bg-neutral-900 dark:text-neutral-400 dark:ring-neutral-800"
                >
                  {r.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <JoinLink item={item} />
          {item.links?.[0] && (
            <a
              href={item.links[0].url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 dark:text-neutral-500 dark:hover:text-neutral-300"
            >
              {item.links[0].title || 'Link'} <ExternalLink size={11} />
            </a>
          )}
          <DoneButton item={item} />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-teal-100 dark:bg-teal-500/15">
          <div className="h-full rounded-full bg-teal-500 transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-neutral-400">{fmtDur(leftMin)} left</span>
      </div>

      {next && (
        <p className="mt-2.5 border-t border-teal-100 pt-2 text-xs text-slate-400 dark:border-teal-500/15 dark:text-neutral-500">
          Then <span className="font-medium text-slate-600 dark:text-neutral-300">{next.title}</span> at {fmtTime(next.start)}
        </p>
      )}
    </div>
  );
}
