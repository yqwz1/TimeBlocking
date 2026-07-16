import type { ProposalCandidateDTO, ProposalItemDTO } from '@timeblock/shared';
import { formatDuration, PriorityBadge } from '../tasks/taskDisplay.js';
import { CHANGE_STYLES, ItemTimeRange, ReasonsList } from './proposalItemDisplay.js';

export const REASON_LABEL: Record<ProposalCandidateDTO['reason'], string> = {
  due_today: 'Due today',
  overdue: 'Overdue',
  missed: 'Missed',
  picked: 'Picked',
  suggested: 'Suggested',
};

export function CandidateRow({
  c,
  mustDo,
  onToggle,
  disabled,
}: {
  c: ProposalCandidateDTO;
  mustDo: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${
        mustDo ? 'border-amber-300 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5' : 'border-slate-200 dark:border-neutral-700'
      }`}
    >
      <PriorityBadge priority={c.priority} />
      <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-neutral-200">{c.content}</span>
      {mustDo && (
        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          Must-do
        </span>
      )}
      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-white/5 dark:text-neutral-400">
        {REASON_LABEL[c.reason]}
      </span>
      {c.durationMin > 0 && <span className="shrink-0 text-xs text-slate-400 dark:text-neutral-500">{formatDuration(c.durationMin)}</span>}
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50 ${
          c.picked
            ? 'bg-teal-600 text-white hover:bg-teal-500'
            : 'border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-white/5'
        }`}
      >
        {c.picked ? 'Today' : 'Not today'}
      </button>
    </div>
  );
}

export function FullnessMeter({ committedMin, capacityMin }: { committedMin: number; capacityMin: number }) {
  const pct = capacityMin > 0 ? Math.min(100, Math.round((committedMin / capacityMin) * 100)) : 0;
  const color = pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-500' : 'bg-teal-500';
  return (
    <div className="mt-1.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-slate-400 dark:text-neutral-500">
        {(committedMin / 60).toFixed(1)}h of {(capacityMin / 60).toFixed(1)}h committed
      </p>
    </div>
  );
}

export function PlanItemRow({
  item,
  muted,
  onPin,
  onReject,
  disabled,
}: {
  item: ProposalItemDTO;
  muted?: boolean;
  onPin: () => void;
  onReject: () => void;
  disabled: boolean;
}) {
  const style = CHANGE_STYLES[item.change];
  const pinned = item.reasons.some((r) => r.code === 'pinned');
  return (
    <div className={`rounded-lg border border-slate-200 px-3 py-2 dark:border-neutral-800 ${muted ? 'opacity-70' : ''}`}>
      <div className="flex items-center gap-2">
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${style.className}`}>{style.label}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-neutral-200">{item.title}</span>
        <span className="shrink-0 whitespace-nowrap tabular-nums text-xs text-slate-500 dark:text-neutral-400">
          <ItemTimeRange item={item} />
        </span>
        {item.change !== 'removed' && (
          <button
            type="button"
            onClick={onPin}
            disabled={disabled || pinned}
            title={pinned ? 'Pinned in place' : 'Pin this time'}
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium disabled:opacity-70 ${
              pinned
                ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
                : 'border border-slate-200 text-slate-400 hover:bg-slate-50 dark:border-neutral-700 dark:hover:bg-white/5'
            }`}
          >
            {pinned ? 'Pinned' : 'Pin'}
          </button>
        )}
        {item.taskId && item.change !== 'removed' && (
          <button
            type="button"
            onClick={onReject}
            disabled={disabled}
            title="Remove from this proposal"
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-400 hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-white/5"
          >
            Remove
          </button>
        )}
      </div>
      <ReasonsList reasons={item.reasons} />
    </div>
  );
}
