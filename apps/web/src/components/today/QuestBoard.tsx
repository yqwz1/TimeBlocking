import { AnimatePresence, motion } from 'motion/react';
import type { TodayPlanDTO } from '@timeblock/shared';
import { useGamificationSummary } from '../../hooks.js';
import { computeQuests } from './quests.js';
import { SectionCard } from './SectionCard.js';
import { popIn, springs } from '../../lib/motion.js';

export default function QuestBoard({ plan }: { plan: TodayPlanDTO }) {
  const { data: summary } = useGamificationSummary();
  const quests = computeQuests(plan, summary);
  const completed = quests.filter((q) => q.done).length;

  return (
    <SectionCard title="Daily quests" badge={<span className="text-xs font-semibold text-[var(--g-text-dim)]">{completed}/{quests.length} complete</span>}>
      <ul className="space-y-3">
        <AnimatePresence initial={false}>
          {quests.map((q) => (
            <motion.li key={q.id} layout variants={popIn} initial="initial" animate="animate" exit="exit">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className={`flex items-center gap-1.5 truncate text-sm ${q.done ? 'text-[var(--g-text-faint)] line-through' : 'text-[var(--g-text)]'}`}>
                  <span>{q.icon}</span>
                  {q.title}
                  {q.done && (
                    <motion.span
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={springs.snappy}
                      className="text-emerald-400"
                    >
                      âœ“
                    </motion.span>
                  )}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-[var(--g-text-faint)]">
                  {q.progress}/{q.target}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--g-surface-2)]">
                <motion.div
                  className={`h-full rounded-full ${q.done ? 'bg-emerald-400' : 'bg-teal-400'}`}
                  initial={false}
                  animate={{ width: `${Math.min(100, Math.round((q.progress / q.target) * 100))}%` }}
                  transition={springs.soft}
                />
              </div>
              {q.hint && <p className="mt-0.5 text-[11px] text-amber-300/80">{q.hint}</p>}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </SectionCard>
  );
}
