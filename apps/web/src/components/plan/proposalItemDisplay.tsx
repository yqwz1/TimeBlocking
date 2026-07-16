import type { ProposalItemDTO } from '@timeblock/shared';
import { fmtTime } from '../today/format.js';

export const CHANGE_STYLES: Record<ProposalItemDTO['change'], { label: string; className: string }> = {
  new: { label: 'NEW', className: 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' },
  moved: { label: 'MOVED', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  removed: { label: 'REMOVED', className: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
  unchanged: { label: 'AS-IS', className: 'bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-neutral-500' },
};

export function ItemTimeRange({ item }: { item: ProposalItemDTO }) {
  if (item.change === 'removed') {
    return (
      <span className="line-through">
        {fmtTime(item.start)}–{fmtTime(item.end)}
      </span>
    );
  }
  if (item.change === 'moved' && item.prevStart) {
    return (
      <>
        <span className="text-slate-400 line-through dark:text-neutral-600">{fmtTime(item.prevStart)}</span> → {fmtTime(item.start)}–
        {fmtTime(item.end)}
      </>
    );
  }
  return (
    <>
      {fmtTime(item.start)}–{fmtTime(item.end)}
    </>
  );
}

export function ReasonsList({ reasons }: { reasons: ProposalItemDTO['reasons'] }) {
  if (!reasons.length) return null;
  return (
    <ul className="mt-1.5 space-y-0.5 pl-1">
      {reasons.map((r, i) => (
        <li key={i} className="flex gap-1.5 text-xs text-slate-500 dark:text-neutral-500">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-teal-400 dark:bg-teal-500" />
          <span>
            {r.label}
            {r.detail ? <span className="text-slate-400 dark:text-neutral-600"> · {r.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
