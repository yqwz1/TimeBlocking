import { ExternalLink, Lock, Unlock } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ScheduleItemDTO } from '@timeblock/shared';
import {
  useCompleteHabitToday,
  useCompleteTask,
  useLockBlock,
  useRescheduleTask,
  useUnlockBlock,
  useUnscheduleTask,
} from '../../hooks.js';
import { blockMinutes, fmtDur, fmtTime } from './format.js';
import { KindIcon } from './SectionCard.js';

function EmptyDay() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--g-border)] py-10 text-center">
      <span className="text-2xl">🗓️</span>
      <div>
        <p className="text-sm font-medium text-[var(--g-text-dim)]">Nothing scheduled today</p>
        <p className="mt-0.5 text-xs text-[var(--g-text-faint)]">Your day is a blank canvas.</p>
      </div>
    </div>
  );
}

function TimelineRow({ item, now, isLast }: { item: ScheduleItemDTO; now: number; isLast: boolean }) {
  const complete = useCompleteTask();
  const completeHabit = useCompleteHabitToday();
  const reschedule = useRescheduleTask();
  const drop = useUnscheduleTask();
  const lockBlock = useLockBlock();
  const unlockBlock = useUnlockBlock();

  const start = Date.parse(item.start);
  const end = Date.parse(item.end);
  const active = start <= now && end > now;
  const past = end <= now;
  const done = item.status === 'done';
  const missed = item.status === 'missed';

  const dotColor = active
    ? 'border-teal-400 bg-teal-400'
    : done
      ? 'border-emerald-400 bg-emerald-400'
      : missed
        ? 'border-rose-400 bg-rose-400'
        : past
          ? 'border-slate-600 bg-slate-600'
          : 'border-slate-600 bg-transparent';

  const busy = complete.isPending || completeHabit.isPending || reschedule.isPending || drop.isPending || lockBlock.isPending || unlockBlock.isPending;

  return (
    <li className="relative flex gap-4 pb-1.5">
      <div className="flex w-14 shrink-0 flex-col items-end pt-2.5">
        <span
          className={`text-xs font-medium tabular-nums ${active ? 'text-teal-300' : past ? 'text-[var(--g-text-faint)]' : 'text-[var(--g-text-dim)]'}`}
        >
          {fmtTime(item.start)}
        </span>
      </div>

      <div className="relative flex flex-col items-center pt-3">
        <span className={`z-10 h-2.5 w-2.5 rounded-full border-2 ${dotColor} ${active ? 'ring-4 ring-teal-500/20' : ''}`} />
        {!isLast && <span className="absolute top-6 bottom-[-2px] w-px bg-[var(--g-border)]" />}
      </div>

      <div
        className={`group mb-1 min-w-0 flex-1 rounded-xl border px-3.5 py-2.5 transition-colors ${
          active
            ? 'border-teal-400/40 bg-teal-500/10'
            : missed
              ? 'border-rose-400/30 bg-rose-500/5'
              : past
                ? 'border-[var(--g-border)] bg-white/[0.02]'
                : 'border-[var(--g-border)] bg-[var(--g-surface-2)]/40'
        } ${item.atRisk ? 'ring-1 ring-amber-400/50' : ''}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <KindIcon kind={item.kind} className={active ? 'text-teal-300' : done ? 'text-emerald-400' : 'text-[var(--g-text-faint)]'} />
              {item.taskId ? (
                <Link
                  to={`/tasks?task=${item.taskId}`}
                  className={`truncate text-sm font-medium hover:underline ${
                    done ? 'text-[var(--g-text-faint)] line-through' : missed ? 'text-rose-300' : past && !active ? 'text-[var(--g-text-faint)]' : 'text-[var(--g-text)]'
                  }`}
                >
                  {item.title}
                </Link>
              ) : (
                <span
                  className={`truncate text-sm font-medium ${
                    done ? 'text-[var(--g-text-faint)] line-through' : missed ? 'text-rose-300' : past && !active ? 'text-[var(--g-text-faint)]' : 'text-[var(--g-text)]'
                  }`}
                >
                  {item.title}
                </span>
              )}
              {active && (
                <span className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-teal-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  <span className="h-1 w-1 animate-pulse rounded-full bg-white" />
                  Now
                </span>
              )}
              {item.locked && (
                <span title="Locked">
                  <Lock className="h-3 w-3 text-[var(--g-text-faint)]" />
                </span>
              )}
            </div>
            <p className={`mt-0.5 text-xs ${past && !active ? 'text-[var(--g-text-faint)]' : 'text-[var(--g-text-dim)]'}`}>
              {fmtTime(item.start)}–{fmtTime(item.end)} · {fmtDur(blockMinutes(item))}
              {item.chunk ? ` · ${item.chunk.index + 1}/${item.chunk.count}` : ''}
              {item.projectName ? ` · ${item.projectName}` : ''}
            </p>
            {item.reasons && item.reasons.length > 0 && !done && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {item.reasons.slice(0, 2).map((r, i) => (
                  <span
                    key={i}
                    title={r.detail ? `${r.label} · ${r.detail}` : r.label}
                    className="inline-flex items-center rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-[var(--g-text-dim)]"
                  >
                    {r.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {done && <span className="text-xs font-medium text-emerald-400">✓ Done</span>}

            {!done && item.kind === 'task' && item.taskId && (
              <button
                onClick={() => complete.mutate(item.taskId!)}
                disabled={busy}
                title="Mark done"
                className="rounded-lg border border-[var(--g-border)] px-2 py-1 text-[11px] font-medium text-[var(--g-text-dim)] hover:border-emerald-400/50 hover:text-emerald-300 disabled:opacity-50"
              >
                Done
              </button>
            )}
            {!done && item.kind === 'habit' && item.habitId && (
              <button
                onClick={() => completeHabit.mutate(item.habitId!)}
                disabled={busy}
                title="Mark done"
                className="rounded-lg border border-[var(--g-border)] px-2 py-1 text-[11px] font-medium text-[var(--g-text-dim)] hover:border-emerald-400/50 hover:text-emerald-300 disabled:opacity-50"
              >
                Done
              </button>
            )}
            {!done && item.kind === 'task' && item.taskId && (
              <>
                <button
                  onClick={() => reschedule.mutate(item.taskId!)}
                  disabled={busy}
                  title="Reschedule"
                  className="rounded-lg border border-[var(--g-border)] px-2 py-1 text-[11px] font-medium text-[var(--g-text-dim)] hover:text-[var(--g-text)] disabled:opacity-50"
                >
                  Reschedule
                </button>
                <button
                  onClick={() => drop.mutate(item.taskId!)}
                  disabled={busy}
                  title="Drop"
                  className="rounded-lg border border-[var(--g-border)] px-2 py-1 text-[11px] font-medium text-[var(--g-text-faint)] hover:text-rose-300 disabled:opacity-50"
                >
                  Drop
                </button>
              </>
            )}
            {item.editable && !done && (
              <button
                onClick={() => (item.locked ? unlockBlock.mutate(item.id) : lockBlock.mutate(item.id))}
                disabled={busy}
                title={item.locked ? 'Unlock' : 'Lock'}
                className="rounded-lg border border-[var(--g-border)] p-1 text-[var(--g-text-faint)] hover:text-[var(--g-text)] disabled:opacity-50"
              >
                {item.locked ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
              </button>
            )}
            {item.links?.[0] && (
              <a href={item.links[0].url} target="_blank" rel="noreferrer" title={item.links[0].title || 'Open link'} className="rounded-lg border border-[var(--g-border)] p-1 text-[var(--g-text-faint)] hover:text-[var(--g-text)]">
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

export default function Timeline({ blocks, now }: { blocks: ScheduleItemDTO[]; now: number }) {
  if (blocks.length === 0) return <EmptyDay />;
  return (
    <ul>
      {blocks.map((b, i) => (
        <TimelineRow key={b.id} item={b} now={now} isLast={i === blocks.length - 1} />
      ))}
    </ul>
  );
}
