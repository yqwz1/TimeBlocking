import { motion } from 'motion/react';
import { useAchievements } from '../../hooks.js';
import { SectionCard } from './SectionCard.js';

export default function AchievementsGrid() {
  const { data } = useAchievements();
  const list = data ?? [];
  const unlockedCount = list.filter((a) => a.unlockedAt).length;

  return (
    <SectionCard
      title="Achievements"
      badge={<span className="text-xs font-semibold text-[var(--g-text-dim)]">{unlockedCount}/{list.length}</span>}
    >
      <div className="grid grid-cols-5 gap-2">
        {list.map((a) => {
          const unlocked = !!a.unlockedAt;
          return (
            <motion.div
              key={a.id}
              layout
              title={unlocked ? `${a.name} — ${a.description} · +${a.xp} XP · ${new Date(a.unlockedAt!).toLocaleDateString()}` : `${a.name} — ${a.description}`}
              animate={{ opacity: unlocked ? 1 : 0.4, scale: unlocked ? [0.75, 1.12, 1] : 1 }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
              whileHover={unlocked ? { scale: 1.06 } : undefined}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-xl border text-2xl ${
                unlocked ? 'border-amber-400/30 bg-amber-400/10 shadow-[0_0_12px_rgba(251,191,36,0.25)]' : 'border-[var(--g-border)] bg-[var(--g-surface-2)] grayscale'
              }`}
            >
              {a.icon}
              {!unlocked && <span className="absolute -bottom-1 -right-1 text-[10px]">🔒</span>}
            </motion.div>
          );
        })}
      </div>
    </SectionCard>
  );
}
