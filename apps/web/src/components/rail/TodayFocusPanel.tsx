import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Clock } from 'lucide-react';
import { useTodayPlan } from '../../hooks.js';
import { listItem, springs } from '../../lib/motion.js';

const WARNING_TEXT: Record<string, string> = {
  past_deadline: 'Past deadline',
  placed_after_deadline: 'Scheduled after its deadline',
  capacity_shortfall: 'Not enough time today to fit everything',
  unplaceable: "Couldn't find a slot",
};

function formatMinutes(min: number): string {
  if (min <= 0) return '0m';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function TodayFocusPanel() {
  const { data: plan } = useTodayPlan();

  if (!plan) {
    return <div className="tb-skeleton relative h-28 rounded-lg" />;
  }

  const total = plan.capacityMin + plan.plannedMin;
  const pct = total > 0 ? Math.min(100, Math.round((plan.plannedMin / total) * 100)) : 0;

  return (
    <div className="space-y-3.5">
      {/* Headline stat */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[28px] font-bold leading-none tabular-nums text-slate-900 dark:text-neutral-50">
              {formatMinutes(plan.plannedMin)}
            </span>
            <span className="text-sm font-medium text-slate-400 dark:text-neutral-500">planned today</span>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-lg px-2.5 py-1 text-sm font-bold tabular-nums ${
            plan.overloaded
              ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
              : 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
          }`}
        >
          {pct}%
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-neutral-800"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Share of today's remaining time already planned"
      >
        <motion.div
          className={`h-full rounded-full ${plan.overloaded ? 'bg-rose-500' : 'bg-teal-500'}`}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={springs.soft}
        />
      </div>

      {/* Free / total breakdown */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-neutral-800/50">
          <p className="flex items-center gap-1 text-[11px] font-medium text-slate-400 dark:text-neutral-500">
            <Clock size={11} className="shrink-0" /> Free
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-700 dark:text-neutral-200">
            {formatMinutes(plan.capacityMin)}
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-neutral-800/50">
          <p className="text-[11px] font-medium text-slate-400 dark:text-neutral-500">Total window</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-700 dark:text-neutral-200">
            {formatMinutes(total)}
          </p>
        </div>
      </div>

      {plan.overloaded && (
        <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-2.5 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          <AlertTriangle size={15} className="shrink-0" />
          <span>Overloaded — more planned than time available</span>
        </div>
      )}

      {plan.warnings.length > 0 && (
        <ul className="space-y-1.5">
          <AnimatePresence initial={false}>
            {plan.warnings.slice(0, 3).map((w, i) => (
              <motion.li
                key={`${w.kind}-${w.taskContent ?? i}`}
                layout
                variants={listItem}
                initial="initial"
                animate="animate"
                exit="exit"
                className="flex items-start gap-2 rounded-lg border border-amber-200/70 bg-amber-50 px-2.5 py-2 dark:border-amber-500/20 dark:bg-amber-500/10"
              >
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500 dark:text-amber-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold leading-snug text-amber-800 dark:text-amber-200">
                    {WARNING_TEXT[w.kind] ?? w.kind}
                  </p>
                  {w.taskContent && (
                    <p className="mt-0.5 truncate text-xs leading-snug text-amber-700/80 dark:text-amber-200/60">
                      {w.taskContent}
                    </p>
                  )}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
