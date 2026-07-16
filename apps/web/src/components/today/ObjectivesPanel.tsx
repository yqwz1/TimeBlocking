import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import type { ObjectiveDTO } from '@timeblock/shared';
import { fmtDur } from './format.js';
import { SectionCard } from './SectionCard.js';
import { listItem, springs } from '../../lib/motion.js';

function ObjectiveRow({ o }: { o: ObjectiveDTO }) {
  const isTime = o.targetMinutes != null;
  const target = o.targetMinutes ?? o.targetCount ?? null;
  const progress = isTime ? o.progressMinutes : o.progressCount;
  const pct = target ? Math.min(100, Math.round((progress / target) * 100)) : 0;
  const complete = target != null && progress >= target;
  return (
    <motion.li layout variants={listItem} initial="initial" animate="animate" exit="exit">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className={`truncate text-sm ${complete ? 'text-[var(--g-text-faint)]' : 'text-[var(--g-text-dim)]'}`}>
          {complete && <span className="mr-1 text-emerald-400">âœ“</span>}
          {o.title}
        </span>
        {target != null && (
          <span className="shrink-0 text-xs tabular-nums text-[var(--g-text-faint)]">
            {isTime ? `${fmtDur(progress)} / ${fmtDur(target)}` : `${progress} / ${target}`}
          </span>
        )}
      </div>
      {target != null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--g-surface-2)]">
          <motion.div
            className="h-full rounded-full bg-emerald-400"
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={springs.soft}
          />
        </div>
      )}
    </motion.li>
  );
}

export default function ObjectivesPanel({ objectives }: { objectives: ObjectiveDTO[] }) {
  return (
    <SectionCard
      title="This week's objectives"
      badge={
        objectives.length > 0 ? (
          <Link to="/objectives" className="text-xs font-medium text-teal-300 hover:text-teal-200">
            View all
          </Link>
        ) : undefined
      }
    >
      {objectives.length === 0 ? (
        <div className="text-sm text-[var(--g-text-faint)]">
          No objectives set yet.{' '}
          <Link to="/objectives" className="font-medium text-teal-300 hover:text-teal-200">
            Set one â†’
          </Link>
        </div>
      ) : (
        <ul className="space-y-3.5">
          <AnimatePresence initial={false}>
            {objectives.map((o) => (
              <ObjectiveRow key={o.id} o={o} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </SectionCard>
  );
}
