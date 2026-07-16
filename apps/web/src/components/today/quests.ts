import { DateTime } from 'luxon';
import type { GamificationSummaryDTO, TodayPlanDTO } from '@timeblock/shared';

export interface Quest {
  id: string;
  icon: string;
  title: string;
  progress: number;
  target: number;
  done: boolean;
  hint?: string;
}

export function computeQuests(plan: TodayPlanDTO, summary: GamificationSummaryDTO | undefined): Quest[] {
  const doneBlocks = plan.blocks.filter((b) => b.status === 'done');
  const missedCount = plan.missedYesterday.length + plan.missedToday.length + plan.blocks.filter((b) => b.status === 'missed').length;
  const earlyDone = doneBlocks.some((b) => DateTime.fromISO(b.start, { zone: 'utc' }).setZone(plan.timezone).hour < 9);

  const quests: Quest[] = [
    {
      id: 'first_block',
      icon: '🎯',
      title: 'Warm-up — complete a block',
      progress: Math.min(doneBlocks.length, 1),
      target: 1,
      done: doneBlocks.length >= 1,
    },
    {
      id: 'three_blocks',
      icon: '🔥',
      title: 'Momentum — complete 3 blocks',
      progress: Math.min(doneBlocks.length, 3),
      target: 3,
      done: doneBlocks.length >= 3,
    },
    {
      id: 'habit_done',
      icon: '🌱',
      title: 'Habit keeper — finish a habit',
      progress: doneBlocks.some((b) => b.kind === 'habit') ? 1 : 0,
      target: 1,
      done: doneBlocks.some((b) => b.kind === 'habit'),
    },
    {
      id: 'early_bird',
      icon: '🌅',
      title: 'Early strike — finish a block before 9am',
      progress: earlyDone ? 1 : 0,
      target: 1,
      done: earlyDone,
    },
    {
      id: 'clean_sheet',
      icon: '✨',
      title: 'Clean sheet — nothing missed',
      progress: missedCount === 0 ? 1 : 0,
      target: 1,
      done: missedCount === 0,
      hint: missedCount > 0 ? `${missedCount} to resolve` : undefined,
    },
  ];

  if (summary?.enabled) {
    quests.push({
      id: 'streak_keeper',
      icon: '🏆',
      title: 'Keep the flame — meet today\'s streak rule',
      progress: summary.streak.todayMet ? 1 : 0,
      target: 1,
      done: summary.streak.todayMet,
    });
  }

  return quests;
}
