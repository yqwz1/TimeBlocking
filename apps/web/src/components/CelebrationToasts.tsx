import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { XpEventDTO } from '@timeblock/shared';
import { api } from '../api.js';
import { useGamificationSummary, useSettings } from '../hooks.js';
import { toast as toastVariants } from '../lib/motion.js';
import { addNotification } from '../lib/notifications.js';
import { playAchievement, playLevelUp } from '../lib/sound.js';

interface Toast {
  id: string;
  text: string;
  icon: string;
  levelUp?: boolean;
}

/**
 * Completions can originate server-side (a habit's schedule ticks over, or a
 * missed block gets swept), so there's no HTTP response to attach "what did I
 * just earn" to. Instead we
 * track the last xp_events seq we've shown and pull anything newer whenever the
 * summary refetches (SSE invalidation or a local mutation). lastSeenSeq starts
 * at the current latestSeq on first load so history/backfill never toasts.
 */
export default function CelebrationToasts() {
  const { data: settings } = useSettings();
  const { data: summary } = useGamificationSummary();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastSeenSeq = useRef<number | null>(null);
  const lastLevel = useRef<number | null>(null);

  useEffect(() => {
    if (!summary?.enabled) return;
    if (lastSeenSeq.current === null) {
      lastSeenSeq.current = summary.latestSeq;
      lastLevel.current = summary.level;
      return;
    }

    if (lastLevel.current !== null && summary.level > lastLevel.current) {
      setToasts((t) => [...t, { id: `level-${summary.level}-${Date.now()}`, text: `Level ${summary.level}!`, icon: '⬆️', levelUp: true }]);
      playLevelUp();
      addNotification({ id: `level-${summary.level}`, kind: 'levelup', title: `Level ${summary.level}!`, body: 'Keep the streak going.' });
    }
    lastLevel.current = summary.level;

    if (summary.latestSeq > lastSeenSeq.current) {
      const after = lastSeenSeq.current;
      lastSeenSeq.current = summary.latestSeq;
      api
        .get<XpEventDTO[]>(`/gamification/events?afterSeq=${after}&limit=10`)
        .then((events) => {
          const next = events.map((e) => ({
            id: `ev-${e.seq}`,
            text: e.kind === 'achievement' ? (e.title ?? 'Achievement unlocked!') : `+${e.amount} XP${e.title ? ` · ${e.title}` : ''}`,
            icon: e.kind === 'achievement' ? '🏅' : e.amount < 0 ? '🧊' : '✨',
          }));
          if (next.length) setToasts((t) => [...t, ...next]);
          const achievements = events.filter((e) => e.kind === 'achievement');
          if (achievements.length) {
            playAchievement();
            for (const e of achievements) {
              addNotification({ id: `ev-${e.seq}`, kind: 'achievement', title: e.title ?? 'Achievement unlocked!' });
            }
          }
        })
        .catch(() => {});
    }
  }, [summary?.latestSeq, summary?.level, summary?.enabled]);

  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => setToasts((t) => t.slice(1)), 4000);
    return () => clearTimeout(timer);
  }, [toasts]);

  if (!settings?.celebrationToasts || !toasts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            variants={toastVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
          >
            <motion.span
              className="text-lg"
              animate={t.levelUp ? { scale: [1, 1.35, 1] } : undefined}
              transition={t.levelUp ? { duration: 0.5, times: [0, 0.5, 1], ease: 'easeOut' } : undefined}
            >
              {t.icon}
            </motion.span>
            <span className="text-sm font-medium text-slate-800 dark:text-neutral-100">{t.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
