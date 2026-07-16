import { inArray } from 'drizzle-orm';
import type { DayResultKind, XpEventKind } from '@timeblock/shared';
import { xpEvents } from '../db/schema.js';
import type { DB } from '../db/client.js';

export interface AchievementCheckCtx {
  db: DB;
  trigger: 'award' | 'day';
  award?: { kind: XpEventKind; hourLocal: number };
  dayResult?: {
    date: string;
    result: DayResultKind;
    streakAfter: number;
    missedCount: number;
    plannedCount: number;
    prevResult: DayResultKind | null;
  };
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  xp: number;
  check: (ctx: AchievementCheckCtx) => boolean;
}

function countXpEventsOfKind(db: DB, kinds: XpEventKind[]): number {
  return db.select().from(xpEvents).where(inArray(xpEvents.kind, kinds)).all().length;
}

/** Declarative unlock list. Extend by appending — checked after every award and every day evaluation. */
export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first_block',
    name: 'First Block',
    description: 'Complete your first scheduled block.',
    icon: '🎯',
    xp: 20,
    check: (ctx) => ctx.trigger === 'award' && ctx.award?.kind === 'block_done',
  },
  {
    id: 'first_habit',
    name: 'Habit Former',
    description: 'Complete your first habit.',
    icon: '🌱',
    xp: 20,
    check: (ctx) => ctx.trigger === 'award' && ctx.award?.kind === 'habit_done',
  },
  {
    id: 'ten_blocks',
    name: 'Getting Going',
    description: 'Complete 10 blocks or habits.',
    icon: '🔟',
    xp: 40,
    check: (ctx) => ctx.trigger === 'award' && countXpEventsOfKind(ctx.db, ['block_done', 'habit_done', 'backfill']) >= 10,
  },
  {
    id: 'hundred_blocks',
    name: 'Centurion',
    description: 'Complete 100 blocks or habits.',
    icon: '💯',
    xp: 150,
    check: (ctx) => ctx.trigger === 'award' && countXpEventsOfKind(ctx.db, ['block_done', 'habit_done', 'backfill']) >= 100,
  },
  {
    id: 'early_bird',
    name: 'Early Bird',
    description: 'Complete a block before 7am.',
    icon: '🌅',
    xp: 25,
    check: (ctx) =>
      ctx.trigger === 'award' && (ctx.award?.kind === 'block_done' || ctx.award?.kind === 'habit_done') && (ctx.award?.hourLocal ?? 99) < 7,
  },
  {
    id: 'streak_7',
    name: 'One Week Strong',
    description: 'Hold a 7-day streak.',
    icon: '🔥',
    xp: 50,
    check: (ctx) => ctx.trigger === 'day' && (ctx.dayResult?.streakAfter ?? 0) >= 7,
  },
  {
    id: 'streak_30',
    name: 'One Month Strong',
    description: 'Hold a 30-day streak.',
    icon: '🏆',
    xp: 200,
    check: (ctx) => ctx.trigger === 'day' && (ctx.dayResult?.streakAfter ?? 0) >= 30,
  },
  {
    id: 'perfect_day',
    name: 'Perfect Day',
    description: 'Complete every planned block in a day with none missed.',
    icon: '✨',
    xp: 30,
    check: (ctx) =>
      ctx.trigger === 'day' && ctx.dayResult?.result === 'met' && ctx.dayResult.missedCount === 0 && ctx.dayResult.plannedCount > 0,
  },
  {
    id: 'comeback',
    name: 'Comeback',
    description: 'Bounce back with a met day right after breaking your streak.',
    icon: '💪',
    xp: 30,
    check: (ctx) => ctx.trigger === 'day' && ctx.dayResult?.result === 'met' && ctx.dayResult.prevResult === 'missed',
  },
  {
    id: 'frozen_saved',
    name: 'Saved by the Freeze',
    description: 'Use a streak freeze to protect your streak.',
    icon: '🧊',
    xp: 15,
    check: (ctx) => ctx.trigger === 'day' && ctx.dayResult?.result === 'freeze',
  },
];
