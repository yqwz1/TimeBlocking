import { and, desc, eq, inArray, lte, ne } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type {
  AchievementDTO,
  DayResultKind,
  GamificationSummaryDTO,
  Settings,
  StreakRule,
  XpEventKind,
} from '@timeblock/shared';
import { achievementsUnlocked, blockOutcomes, blocks, dayResults, gamificationState, xpEvents } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { ACHIEVEMENTS, type AchievementCheckCtx } from './achievements.js';

const FREEZE_CAP = 3;
const FREEZE_EVERY_N_DAYS = 7;

// ---------- pure functions ----------

/** Cumulative XP required to REACH a level. Level 1 = 0 XP; L2 @ 100, L3 @ 300, L10 @ 4500. */
export function xpForLevel(level: number): number {
  return 50 * level * (level - 1);
}

export function levelFromXp(totalXp: number): { level: number; xpIntoLevel: number; xpForNextLevel: number } {
  let level = 1;
  while (level < 1000 && xpForLevel(level + 1) <= totalXp) level++;
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, xpIntoLevel: totalXp - base, xpForNextLevel: next - base };
}

/** 10 base + 1 per 5 planned minutes, capped at 40. */
export function xpForBlock(plannedMin: number): number {
  return Math.min(40, 10 + Math.floor(Math.max(0, plannedMin) / 5));
}

export interface DayCounts {
  done: number;
  missed: number;
  planned: number;
}

/** one_block: any completed block/habit holds the day; half_planned: need >=50% of planned done. Zero planned = rest. */
export function evaluateDayResult(counts: DayCounts, rule: StreakRule): 'met' | 'missed' | 'rest' {
  if (counts.planned === 0) return 'rest';
  if (rule === 'one_block') return counts.done >= 1 ? 'met' : 'missed';
  return counts.done / counts.planned >= 0.5 ? 'met' : 'missed';
}

export interface StreakState {
  current: number;
  longest: number;
  freezes: number;
}

export interface DayApplyResult {
  state: StreakState;
  outcome: DayResultKind;
  earnedFreeze: boolean;
  streakXp: number;
}

/** Streak/freeze state machine. met: streak+1 (+freeze every 7th day, capped); missed: consume a freeze if banked, else reset; rest: no-op. */
export function applyDayResult(state: StreakState, result: 'met' | 'missed' | 'rest'): DayApplyResult {
  if (result === 'rest') return { state, outcome: 'rest', earnedFreeze: false, streakXp: 0 };
  if (result === 'met') {
    const current = state.current + 1;
    const longest = Math.max(state.longest, current);
    const earnedFreeze = current % FREEZE_EVERY_N_DAYS === 0 && state.freezes < FREEZE_CAP;
    const freezes = earnedFreeze ? state.freezes + 1 : state.freezes;
    const streakXp = 5 + Math.min(current, 30);
    return { state: { current, longest, freezes }, outcome: 'met', earnedFreeze, streakXp };
  }
  if (state.freezes > 0) {
    return { state: { ...state, freezes: state.freezes - 1 }, outcome: 'freeze', earnedFreeze: false, streakXp: 0 };
  }
  return { state: { ...state, current: 0 }, outcome: 'missed', earnedFreeze: false, streakXp: 0 };
}

// ---------- KV state ----------

const STATE_KEYS = {
  currentStreak: 'current_streak',
  longestStreak: 'longest_streak',
  freezes: 'freezes',
  lastEvaluatedDate: 'last_evaluated_date',
  backfillDone: 'backfill_done',
} as const;

function getG(db: DB, key: string): string | null {
  return db.select().from(gamificationState).where(eq(gamificationState.key, key)).get()?.value ?? null;
}

function setG(db: DB, key: string, value: string) {
  db.insert(gamificationState).values({ key, value }).onConflictDoUpdate({ target: gamificationState.key, set: { value } }).run();
}

function loadStreakState(db: DB): StreakState {
  return {
    current: Number(getG(db, STATE_KEYS.currentStreak) ?? '0'),
    longest: Number(getG(db, STATE_KEYS.longestStreak) ?? '0'),
    freezes: Number(getG(db, STATE_KEYS.freezes) ?? '0'),
  };
}

function saveStreakState(db: DB, s: StreakState) {
  setG(db, STATE_KEYS.currentStreak, String(s.current));
  setG(db, STATE_KEYS.longestStreak, String(s.longest));
  setG(db, STATE_KEYS.freezes, String(s.freezes));
}

// ---------- DB effects ----------

/** Idempotent award: a duplicate (kind, sourceId) is a silent no-op. Returns true iff a row was actually inserted. */
export function awardXp(
  db: DB,
  settings: Settings,
  ev: { kind: XpEventKind; sourceId: string; amount: number; dateLocal: string; meta?: Record<string, unknown> },
  nowIso: string,
): boolean {
  if (!settings.gamificationEnabled) return false;
  const result = db
    .insert(xpEvents)
    .values({
      kind: ev.kind,
      sourceId: ev.sourceId,
      amount: ev.amount,
      dateLocal: ev.dateLocal,
      meta: JSON.stringify(ev.meta ?? {}),
      createdAtUtc: nowIso,
    })
    .onConflictDoNothing({ target: [xpEvents.kind, xpEvents.sourceId] })
    .run();
  return result.changes > 0;
}

function checkAchievements(db: DB, settings: Settings, nowIso: string, ctx: Omit<AchievementCheckCtx, 'db'>): void {
  const unlockedIds = new Set(db.select({ id: achievementsUnlocked.id }).from(achievementsUnlocked).all().map((r) => r.id));
  for (const def of ACHIEVEMENTS) {
    if (unlockedIds.has(def.id)) continue;
    if (!def.check({ db, ...ctx })) continue;
    const inserted = db
      .insert(achievementsUnlocked)
      .values({ id: def.id, unlockedAtUtc: nowIso, xpAwarded: def.xp })
      .onConflictDoNothing()
      .run();
    if (inserted.changes > 0) {
      const dateLocal = DateTime.fromISO(nowIso, { zone: 'utc' }).setZone(settings.timezone).toISODate()!;
      awardXp(db, settings, { kind: 'achievement', sourceId: def.id, amount: def.xp, dateLocal, meta: { achievementId: def.id, title: def.name } }, nowIso);
    }
  }
}

/** Award XP for one completed block/habit instance and run achievement checks. */
export function awardBlockDone(
  db: DB,
  settings: Settings,
  block: { startUtc: string; endUtc: string },
  kind: 'block_done' | 'habit_done',
  sourceId: string,
  title: string,
  nowIso: string,
): void {
  if (!settings.gamificationEnabled) return;
  const tz = settings.timezone;
  const plannedMin = Math.round((Date.parse(block.endUtc) - Date.parse(block.startUtc)) / 60_000);
  const startLocal = DateTime.fromISO(block.startUtc, { zone: 'utc' }).setZone(tz);
  const amount = xpForBlock(plannedMin);
  const inserted = awardXp(db, settings, { kind, sourceId, amount, dateLocal: startLocal.toISODate()!, meta: { title, hourLocal: startLocal.hour } }, nowIso);
  if (inserted) checkAchievements(db, settings, nowIso, { trigger: 'award', award: { kind, hourLocal: startLocal.hour } });
}

function countsForLocalDate(db: DB, tz: string, date: string): DayCounts {
  const dayStart = DateTime.fromISO(date, { zone: tz }).startOf('day');
  const startMs = dayStart.toMillis();
  const endMs = dayStart.plus({ days: 1 }).toMillis();
  const rows = db
    .select()
    .from(blocks)
    .where(inArray(blocks.status, ['done', 'missed']))
    .all()
    .filter((b) => {
      const s = Date.parse(b.startUtc);
      return s >= startMs && s < endMs;
    });
  const done = rows.filter((r) => r.status === 'done').length;
  return { done, missed: rows.length - done, planned: rows.length };
}

function lastNonRestResult(db: DB, onOrBeforeDate: string): DayResultKind | null {
  const row = db
    .select()
    .from(dayResults)
    .where(and(lte(dayResults.date, onOrBeforeDate), ne(dayResults.result, 'rest')))
    .orderBy(desc(dayResults.date))
    .limit(1)
    .get();
  return (row?.result as DayResultKind) ?? null;
}

/** One-time XP grant from historical block_outcomes (no streaks reconstructed). */
export function ensureBackfill(db: DB, settings: Settings, nowIso: string): void {
  if (getG(db, STATE_KEYS.backfillDone)) return;
  const tz = settings.timezone;
  const doneOutcomes = db.select().from(blockOutcomes).where(eq(blockOutcomes.outcome, 'done')).all();
  for (const o of doneOutcomes) {
    const dateLocal = DateTime.fromISO(o.recordedAtUtc, { zone: 'utc' }).setZone(tz).toISODate()!;
    awardXp(db, settings, { kind: 'backfill', sourceId: o.id, amount: xpForBlock(o.plannedMin), dateLocal }, nowIso);
  }
  setG(db, STATE_KEYS.backfillDone, '1');
}

/**
 * Judge every local day strictly before today that hasn't been judged yet.
 * Must run every cycle tick (even when nothing else changed) so a day with
 * zero activity still gets recorded. Cursor + per-date PK make this replay-safe.
 */
export function evaluatePendingDays(db: DB, settings: Settings, nowIso: string): boolean {
  if (!settings.gamificationEnabled) return false;
  ensureBackfill(db, settings, nowIso);

  const tz = settings.timezone;
  const today = DateTime.fromISO(nowIso, { zone: 'utc' }).setZone(tz).toISODate()!;
  const last = getG(db, STATE_KEYS.lastEvaluatedDate);
  if (!last) {
    const yesterday = DateTime.fromISO(today, { zone: tz }).minus({ days: 1 }).toISODate()!;
    setG(db, STATE_KEYS.lastEvaluatedDate, yesterday);
    return false;
  }

  let changed = false;
  let cursor = DateTime.fromISO(last, { zone: tz }).plus({ days: 1 });
  const todayDt = DateTime.fromISO(today, { zone: tz });
  let state = loadStreakState(db);
  let prevResult = lastNonRestResult(db, last);
  let iterations = 0;

  while (cursor < todayDt && iterations < 400) {
    iterations++;
    const date = cursor.toISODate()!;
    const counts = countsForLocalDate(db, tz, date);
    const dayResult = evaluateDayResult(counts, settings.streakRule);
    const applied = applyDayResult(state, dayResult);
    state = applied.state;

    db.insert(dayResults)
      .values({
        date,
        result: applied.outcome,
        doneCount: counts.done,
        missedCount: counts.missed,
        plannedCount: counts.planned,
        streakAfter: state.current,
        freezesAfter: state.freezes,
        decidedAtUtc: nowIso,
      })
      .onConflictDoNothing()
      .run();

    if (applied.streakXp > 0) {
      awardXp(db, settings, { kind: 'streak_day', sourceId: date, amount: applied.streakXp, dateLocal: date }, nowIso);
    }
    checkAchievements(db, settings, nowIso, {
      trigger: 'day',
      dayResult: { date, result: applied.outcome, streakAfter: state.current, missedCount: counts.missed, plannedCount: counts.planned, prevResult },
    });
    if (applied.outcome !== 'rest') prevResult = applied.outcome;

    saveStreakState(db, state);
    setG(db, STATE_KEYS.lastEvaluatedDate, date);
    changed = true;
    cursor = cursor.plus({ days: 1 });
  }
  return changed;
}

const FREEZE_PURCHASE_COST_XP = 300;

/** Spend XP for a banked freeze. Rejects at the freeze cap or on insufficient XP. */
export function buyFreeze(db: DB, settings: Settings, nowIso: string): { ok: true; freezes: number } | { ok: false; error: string } {
  if (!settings.gamificationEnabled) return { ok: false, error: 'Gamification is disabled' };
  const state = loadStreakState(db);
  if (state.freezes >= FREEZE_CAP) return { ok: false, error: 'Already at the freeze cap' };
  const totalXp = db.select().from(xpEvents).all().reduce((sum, r) => sum + r.amount, 0);
  if (totalXp < FREEZE_PURCHASE_COST_XP) return { ok: false, error: 'Not enough XP' };
  const tz = settings.timezone;
  const dateLocal = DateTime.fromISO(nowIso, { zone: 'utc' }).setZone(tz).toISODate()!;
  awardXp(db, settings, { kind: 'freeze_purchase', sourceId: `freeze-${nowIso}`, amount: -FREEZE_PURCHASE_COST_XP, dateLocal }, nowIso);
  const next = { ...state, freezes: state.freezes + 1 };
  saveStreakState(db, next);
  return { ok: true, freezes: next.freezes };
}

export function getSummary(db: DB, settings: Settings): GamificationSummaryDTO {
  if (!settings.gamificationEnabled) {
    return {
      enabled: false,
      totalXp: 0,
      level: 1,
      xpIntoLevel: 0,
      xpForNextLevel: xpForLevel(2),
      streak: { current: 0, longest: 0, freezes: 0, todayMet: false, todayCounts: { done: 0, missed: 0, planned: 0 } },
      latestSeq: 0,
      recentAchievements: [],
    };
  }
  const totalXp = db.select().from(xpEvents).all().reduce((sum, r) => sum + r.amount, 0);
  const { level, xpIntoLevel, xpForNextLevel } = levelFromXp(totalXp);
  const state = loadStreakState(db);
  const tz = settings.timezone;
  const today = DateTime.now().setZone(tz).toISODate()!;
  const todayCounts = countsForLocalDate(db, tz, today);
  const todayMet = evaluateDayResult(todayCounts, settings.streakRule) === 'met';
  const latestSeq = db.select().from(xpEvents).orderBy(desc(xpEvents.seq)).limit(1).get()?.seq ?? 0;

  const defsById = new Map(ACHIEVEMENTS.map((d) => [d.id, d]));
  const recentAchievements: AchievementDTO[] = db
    .select()
    .from(achievementsUnlocked)
    .orderBy(desc(achievementsUnlocked.unlockedAtUtc))
    .limit(3)
    .all()
    .map((r) => {
      const def = defsById.get(r.id);
      return { id: r.id, name: def?.name ?? r.id, description: def?.description ?? '', icon: def?.icon ?? '🏅', xp: r.xpAwarded, unlockedAt: r.unlockedAtUtc };
    });

  return {
    enabled: true,
    totalXp,
    level,
    xpIntoLevel,
    xpForNextLevel,
    streak: { current: state.current, longest: state.longest, freezes: state.freezes, todayMet, todayCounts },
    latestSeq,
    recentAchievements,
  };
}
