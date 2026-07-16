import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useSyncStatus } from '../hooks.js';
import PlanDayModal from './plan/PlanDayModal.js';

/**
 * Replaces the old "Recalculate" button. The planner never writes to the
 * calendar on its own (settings.autoApply defaults to 'off') — this chip is
 * the single place that surfaces "the planner has an opinion" and opens the
 * review flow to approve it.
 */
export default function ScheduleStateChip() {
  const { data: status } = useSyncStatus();
  const [open, setOpen] = useState(false);
  const schedule = status?.schedule;
  const state = schedule?.state ?? 'in_sync';
  const driftTotal = schedule ? schedule.driftCreated + schedule.driftMoved + schedule.driftDeleted : 0;

  const label =
    state === 'proposal_pending'
      ? 'Proposal ready'
      : state === 'drift'
        ? `${driftTotal} change${driftTotal === 1 ? '' : 's'} suggested`
        : 'In sync';

  const dotClass = state === 'proposal_pending' ? 'bg-teal-500' : state === 'drift' ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Review schedule changes"
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-white/5"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        {label}
      </button>
      <AnimatePresence>{open && <PlanDayModal label="Review & plan" onClose={() => setOpen(false)} />}</AnimatePresence>
    </>
  );
}
