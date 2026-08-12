import { randomUUID } from 'node:crypto';
import { and, desc, eq, lt } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type {
  AchievementProgress,
  DailyContract,
  Mission,
  ProgressionDashboard,
  ProgressionEvent,
  RewardItem,
  RewardRedemption,
  SeasonProgress,
  Settings,
} from '@timeblock/shared';
import type { DB } from '../db/client.js';
import {
  dailyContracts,
  blocks,
  progressionAchievements,
  progressionLedger,
  progressionMissions,
  progressionProfiles,
  progressionRedemptions,
  progressionRewards,
  progressionSeasons,
} from '../db/schema.js';

export const PROGRESSION_FORMULA_VERSION = 'gamification-v2.0';
const PROFILE_ID = 'default';
const RANKS = [
  ['Bronze', 0], ['Silver', 400], ['Gold', 900], ['Platinum', 1600], ['Diamond', 2400], ['Apex', 3200],
] as const;

export type ProgressionFact =
  | { kind: 'block_completed'; sourceId: string; plannedMinutes: number; title?: string; atUtc?: string }
  | { kind: 'habit_completed'; sourceId: string; title?: string; atUtc?: string }
  | { kind: 'shutdown_completed'; sourceId: string; atUtc?: string }
  | { kind: 'weekly_review_completed'; sourceId: string; atUtc?: string }
  | { kind: 'activity_summary_finalized'; sourceId: string; baseXp: number; focusedMinutes: number; focusQuality: number; confidence: number; eligible: boolean; atUtc?: string };

type LedgerResource = 'xp' | 'credits' | 'rank_points';

export function baseWorkXp(plannedMinutes: number): number {
  return Math.max(1, Math.round(Math.min(Math.max(0, plannedMinutes), 120) / 5));
}

export function xpToReach(level: number): number {
  return Math.round(75 * Math.pow(Math.max(0, level - 1), 1.6));
}

export function levelFromMasteryXp(totalXp: number) {
  let level = 1;
  while (level < 10_000 && xpToReach(level + 1) <= totalXp) level++;
  const floor = xpToReach(level);
  return { level, xpIntoLevel: totalXp - floor, xpForNextLevel: xpToReach(level + 1) - floor };
}

function localNow(settings: Settings, nowIso: string) {
  return DateTime.fromISO(nowIso, { zone: 'utc' }).setZone(settings.timezone);
}

function upcomingMonday(now: DateTime) {
  const today = now.startOf('day');
  return today.weekday === 1 && now.toFormat('HH:mm') < '10:00' ? today : today.plus({ days: (8 - today.weekday) % 7 || 7 });
}

function activeToday(settings: Settings, date: DateTime) {
  return settings.progressionActiveWeekdays.includes(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][date.weekday - 1] as any);
}

function rankFor(points: number): SeasonProgress {
  let i = 0;
  for (let n = 1; n < RANKS.length; n++) if (points >= RANKS[n][1]) i = n;
  const next = RANKS[i + 1];
  return {
    id: null,
    startLocal: '',
    endLocal: '',
    rankPoints: Math.max(0, points),
    tier: RANKS[i][0],
    nextTier: next ? { name: next[0], at: next[1] } : null,
  };
}

function metadata(row: { metadata: string }) {
  try { return JSON.parse(row.metadata) as Record<string, unknown>; } catch { return {}; }
}

function sumResource(db: DB, resource: LedgerResource, seasonId?: string | null) {
  return db.select().from(progressionLedger).all().filter((x) => x.resource === resource && (seasonId === undefined || x.seasonId === seasonId)).reduce((total, x) => total + x.amount, 0);
}

function writeLedger(db: DB, args: { resource: LedgerResource; kind: string; sourceId: string; amount: number; seasonId?: string | null; nowIso: string; metadata?: Record<string, unknown> }) {
  if (args.amount === 0) return false;
  const result = db.insert(progressionLedger).values({
    resource: args.resource,
    kind: args.kind,
    sourceId: args.sourceId,
    amount: args.amount,
    seasonId: args.seasonId ?? null,
    formulaVersion: PROGRESSION_FORMULA_VERSION,
    metadata: JSON.stringify(args.metadata ?? {}),
    createdAtUtc: args.nowIso,
  }).onConflictDoNothing({ target: [progressionLedger.resource, progressionLedger.kind, progressionLedger.sourceId, progressionLedger.seasonId] }).run();
  return result.changes > 0;
}

function ensureProfile(db: DB, settings: Settings, nowIso: string) {
  let profile = db.select().from(progressionProfiles).where(eq(progressionProfiles.id, PROFILE_ID)).get();
  if (!profile) {
    const start = upcomingMonday(localNow(settings, nowIso)).toISODate()!;
    db.insert(progressionProfiles).values({ id: PROFILE_ID, seasonStartLocal: start, createdAtUtc: nowIso, updatedAtUtc: nowIso }).run();
    profile = db.select().from(progressionProfiles).where(eq(progressionProfiles.id, PROFILE_ID)).get()!;
  }
  return profile;
}

function ensureSeason(db: DB, settings: Settings, nowIso: string) {
  const profile = ensureProfile(db, settings, nowIso);
  const start = DateTime.fromISO(profile.seasonStartLocal, { zone: settings.timezone });
  const now = localNow(settings, nowIso);
  if (now < start) return null;
  const seasonIndex = Math.floor(now.startOf('day').diff(start, 'days').days / 56);
  const seasonStart = start.plus({ days: seasonIndex * 56 }).toISODate()!;
  const seasonEnd = start.plus({ days: (seasonIndex + 1) * 56 - 1 }).toISODate()!;
  const id = `season-${seasonStart}`;
  db.insert(progressionSeasons).values({ id, startLocal: seasonStart, endLocal: seasonEnd, createdAtUtc: nowIso }).onConflictDoNothing().run();
  return db.select().from(progressionSeasons).where(eq(progressionSeasons.id, id)).get()!;
}

function missionDto(row: typeof progressionMissions.$inferSelect): Mission {
  return { id: row.id, type: row.type as Mission['type'], title: row.title, detail: row.detail, metric: row.metric, target: row.target, progress: row.progress, selected: !!row.selected, completedAt: row.completedAtUtc, rewards: { xp: row.rewardXp, credits: row.rewardCredits, rankPoints: row.rewardRank } };
}

function contractDto(db: DB, row: typeof dailyContracts.$inferSelect): DailyContract {
  const missions = db.select().from(progressionMissions).where(eq(progressionMissions.contractDateLocal, row.dateLocal)).all().map(missionDto);
  const core = missions.filter((m) => m.type === 'core');
  const optional = missions.find((m) => m.id === row.optionalMissionId);
  return { dateLocal: row.dateLocal, state: row.state as DailyContract['state'], lockAt: row.lockAtUtc, lockedAt: row.lockedAtUtc, optionalMissionId: row.optionalMissionId, coreComplete: core.length > 0 && core.every((m) => !!m.completedAt), optionalComplete: !!optional?.completedAt, missions };
}

function createMission(db: DB, values: Omit<typeof progressionMissions.$inferInsert, 'id' | 'createdAtUtc'>, nowIso: string) {
  const id = randomUUID();
  db.insert(progressionMissions).values({ id, ...values, createdAtUtc: nowIso }).run();
  return id;
}

function ensureDailyContract(db: DB, settings: Settings, nowIso: string, seasonId: string) {
  const now = localNow(settings, nowIso);
  const date = now.toISODate()!;
  let contract = db.select().from(dailyContracts).where(eq(dailyContracts.dateLocal, date)).get();
  if (contract) return contract;
  const midnight = now.startOf('day');
  const lockAt = midnight.set({ hour: Number(settings.progressionContractLockTime.slice(0, 2)), minute: Number(settings.progressionContractLockTime.slice(3)) }).toUTC().toISO()!;
  const rest = !activeToday(settings, now);
  db.insert(dailyContracts).values({ dateLocal: date, seasonId, state: rest ? 'rest' : 'open', lockAtUtc: lockAt, createdAtUtc: nowIso, updatedAtUtc: nowIso }).run();
  if (!rest) {
    const start = midnight.toUTC().toISO()!;
    const end = midnight.plus({ days: 1 }).toUTC().toISO()!;
    const planned = db.select().from(blocks).all().filter((b) => b.startUtc >= start && b.startUtc < end && ['scheduled', 'done'].includes(b.status));
    const totalMin = planned.reduce((n, b) => n + Math.max(0, Math.round((Date.parse(b.endUtc) - Date.parse(b.startUtc)) / 60_000)), 0);
    createMission(db, { contractDateLocal: date, seasonId, type: 'core', title: 'Keep your commitments', detail: 'Complete two scheduled blocks.', metric: 'block_count', target: Math.max(1, Math.min(2, planned.length || 1)), rewardXp: 15, rewardCredits: 6, rewardRank: 15 }, nowIso);
    createMission(db, { contractDateLocal: date, seasonId, type: 'core', title: 'Put in focused time', detail: 'Credit meaningful planned work.', metric: 'focus_minutes', target: Math.max(15, Math.min(90, totalMin || 30)), rewardXp: 15, rewardCredits: 6, rewardRank: 15 }, nowIso);
    createMission(db, { contractDateLocal: date, seasonId, type: 'optional', title: 'Deep focus push', detail: 'Credit 90 focused minutes.', metric: 'focus_minutes', target: 90, rewardXp: 20, rewardCredits: 8, rewardRank: 20 }, nowIso);
    createMission(db, { contractDateLocal: date, seasonId, type: 'optional', title: 'Finish strong', detail: 'Complete three scheduled blocks.', metric: 'block_count', target: 3, rewardXp: 20, rewardCredits: 8, rewardRank: 20 }, nowIso);
    createMission(db, { contractDateLocal: date, seasonId, type: 'optional', title: 'Close the loop', detail: 'Complete your daily shutdown.', metric: 'shutdown', target: 1, rewardXp: 20, rewardCredits: 8, rewardRank: 20 }, nowIso);
  }
  return db.select().from(dailyContracts).where(eq(dailyContracts.dateLocal, date)).get()!;
}

function ensureWeeklyMissions(db: DB, settings: Settings, nowIso: string, seasonId: string) {
  const week = localNow(settings, nowIso).startOf('week').toISODate()!;
  if (db.select().from(progressionMissions).where(eq(progressionMissions.weekStartLocal, week)).get()) return;
  createMission(db, { weekStartLocal: week, seasonId, type: 'weekly', title: 'Show up', detail: 'Complete 8 scheduled blocks this week.', metric: 'block_count', target: 8, rewardXp: 40, rewardCredits: 20, rewardRank: 40 }, nowIso);
  createMission(db, { weekStartLocal: week, seasonId, type: 'weekly', title: 'Build focus', detail: 'Credit 300 minutes of focused work.', metric: 'focus_minutes', target: 300, rewardXp: 40, rewardCredits: 20, rewardRank: 40 }, nowIso);
  createMission(db, { weekStartLocal: week, seasonId, type: 'weekly', title: 'Reflect and reset', detail: 'Complete the weekly review.', metric: 'weekly_review', target: 1, rewardXp: 40, rewardCredits: 20, rewardRank: 40 }, nowIso);
}

function selectOptional(db: DB, contract: typeof dailyContracts.$inferSelect, nowIso: string) {
  if (contract.optionalMissionId) return contract.optionalMissionId;
  const candidate = db.select().from(progressionMissions).where(and(eq(progressionMissions.contractDateLocal, contract.dateLocal), eq(progressionMissions.type, 'optional'))).all().sort((a, b) => a.target - b.target)[0];
  if (!candidate) return null;
  db.update(progressionMissions).set({ selected: 1 }).where(eq(progressionMissions.id, candidate.id)).run();
  db.update(dailyContracts).set({ optionalMissionId: candidate.id, state: 'locked', lockedAtUtc: nowIso, updatedAtUtc: nowIso }).where(eq(dailyContracts.dateLocal, contract.dateLocal)).run();
  return candidate.id;
}

function awardMission(db: DB, mission: typeof progressionMissions.$inferSelect, nowIso: string) {
  const prefix = `mission:${mission.id}`;
  writeLedger(db, { resource: 'xp', kind: 'mission_completed', sourceId: prefix, amount: mission.rewardXp, seasonId: mission.seasonId, nowIso, metadata: { missionId: mission.id } });
  writeLedger(db, { resource: 'credits', kind: 'mission_completed', sourceId: prefix, amount: mission.rewardCredits, seasonId: mission.seasonId, nowIso, metadata: { missionId: mission.id } });
  writeLedger(db, { resource: 'rank_points', kind: 'mission_completed', sourceId: prefix, amount: mission.rewardRank, seasonId: mission.seasonId, nowIso, metadata: { missionId: mission.id } });
}

function updateMissions(db: DB, seasonId: string, date: string, metric: string, delta: number, nowIso: string) {
  const week = DateTime.fromISO(date).startOf('week').toISODate()!;
  const rows = db.select().from(progressionMissions).all().filter((m) => m.seasonId === seasonId && !m.completedAtUtc && m.metric === metric && (m.contractDateLocal === date || m.weekStartLocal === week) && (m.type !== 'optional' || !!m.selected));
  for (const m of rows) {
    const progress = Math.min(m.target, m.progress + delta);
    const completed = progress >= m.target;
    db.update(progressionMissions).set({ progress, ...(completed ? { completedAtUtc: nowIso } : {}) }).where(eq(progressionMissions.id, m.id)).run();
    if (completed) awardMission(db, { ...m, progress, completedAtUtc: nowIso }, nowIso);
  }
}

function completeContractIfReady(db: DB, profile: typeof progressionProfiles.$inferSelect, contract: typeof dailyContracts.$inferSelect, nowIso: string) {
  const view = contractDto(db, contract);
  if (!view.coreComplete || !view.optionalComplete || contract.state === 'complete') return;
  db.update(dailyContracts).set({ state: 'complete', evaluatedAtUtc: nowIso, updatedAtUtc: nowIso }).where(eq(dailyContracts.dateLocal, contract.dateLocal)).run();
  writeLedger(db, { resource: 'xp', kind: 'full_contract', sourceId: contract.dateLocal, amount: 10, seasonId: contract.seasonId, nowIso });
  writeLedger(db, { resource: 'rank_points', kind: 'full_contract', sourceId: contract.dateLocal, amount: 10, seasonId: contract.seasonId, nowIso });
  db.update(progressionProfiles).set({ pendingWeeklyCredits: profile.pendingWeeklyCredits + 12, updatedAtUtc: nowIso }).where(eq(progressionProfiles.id, PROFILE_ID)).run();
}

function awardLevelCredits(db: DB, beforeXp: number, seasonId: string, sourceId: string, nowIso: string) {
  const afterXp = sumResource(db, 'xp');
  const beforeLevel = levelFromMasteryXp(beforeXp).level;
  const afterLevel = levelFromMasteryXp(afterXp).level;
  for (let level = beforeLevel + 1; level <= afterLevel; level++) writeLedger(db, { resource: 'credits', kind: 'level_up', sourceId: `${sourceId}:${level}`, amount: level % 5 === 0 ? 50 : 15, seasonId, nowIso, metadata: { level } });
}

export function recordProgressionFact(db: DB, settings: Settings, fact: ProgressionFact, nowIso: string) {
  if (!settings.gamificationEnabled) return;
  const season = ensureSeason(db, settings, nowIso);
  if (!season) return;
  const profile = ensureProfile(db, settings, nowIso);
  const now = localNow(settings, fact.atUtc ?? nowIso);
  const date = now.toISODate()!;
  const contract = ensureDailyContract(db, settings, nowIso, season.id);
  ensureWeeklyMissions(db, settings, nowIso, season.id);
  const beforeXp = sumResource(db, 'xp');
  let metric: string | null = null;
  let delta = 0;
  if (fact.kind === 'block_completed') {
    const earnedToday = db.select().from(progressionLedger).all().filter((r) => r.resource === 'xp' && r.kind === 'base_work' && metadata(r).dateLocal === date).reduce((n, r) => n + r.amount, 0);
    const amount = Math.max(0, Math.min(72 - earnedToday, baseWorkXp(fact.plannedMinutes)));
    const inserted = writeLedger(db, { resource: 'xp', kind: 'base_work', sourceId: fact.sourceId, amount, seasonId: season.id, nowIso, metadata: { dateLocal: date, title: fact.title, plannedMinutes: fact.plannedMinutes } });
    if (inserted) {
      metric = 'block_count'; delta = 1;
      updateMissions(db, season.id, date, 'focus_minutes', Math.max(0, fact.plannedMinutes), nowIso);
    }
  } else if (fact.kind === 'habit_completed') {
    const inserted = writeLedger(db, { resource: 'xp', kind: 'base_work', sourceId: fact.sourceId, amount: 2, seasonId: season.id, nowIso, metadata: { dateLocal: date, title: fact.title, habit: true } });
    if (inserted) { metric = 'habit_count'; delta = 1; updateMissions(db, season.id, date, 'block_count', 1, nowIso); }
  } else if (fact.kind === 'shutdown_completed') {
    if (writeLedger(db, { resource: 'xp', kind: 'shutdown', sourceId: fact.sourceId, amount: 8, seasonId: season.id, nowIso, metadata: { dateLocal: date } })) { metric = 'shutdown'; delta = 1; }
  } else if (fact.kind === 'weekly_review_completed') {
    if (writeLedger(db, { resource: 'xp', kind: 'weekly_review', sourceId: fact.sourceId, amount: 30, seasonId: season.id, nowIso, metadata: { dateLocal: date } })) { metric = 'weekly_review'; delta = 1; }
  } else if (fact.kind === 'activity_summary_finalized' && settings.activityWatchBonusConsent && fact.eligible) {
    const bonusPercent = Math.max(0, Math.min(0.3, (fact.focusQuality - 60) / 100)) * Math.max(0, fact.confidence) / 100;
    const xp = Math.round(fact.baseXp * bonusPercent);
    const credits = Math.min(6, Math.floor(Math.min(fact.focusedMinutes, 120) / 20));
    writeLedger(db, { resource: 'xp', kind: 'focus_bonus', sourceId: fact.sourceId, amount: xp, seasonId: season.id, nowIso, metadata: { dateLocal: date, focusQuality: fact.focusQuality, confidence: fact.confidence } });
    writeLedger(db, { resource: 'credits', kind: 'focus_bonus', sourceId: fact.sourceId, amount: credits, seasonId: season.id, nowIso, metadata: { dateLocal: date } });
  }
  if (metric) updateMissions(db, season.id, date, metric, delta, nowIso);
  if (metric) selectOptional(db, contract, nowIso);
  completeContractIfReady(db, profile, db.select().from(dailyContracts).where(eq(dailyContracts.dateLocal, date)).get()!, nowIso);
  awardLevelCredits(db, beforeXp, season.id, fact.sourceId, nowIso);
}

function evaluatePastContracts(db: DB, settings: Settings, nowIso: string) {
  const today = localNow(settings, nowIso).toISODate()!;
  for (const contract of db.select().from(dailyContracts).where(lt(dailyContracts.dateLocal, today)).all()) {
    if (contract.evaluatedAtUtc || contract.state === 'rest') continue;
    selectOptional(db, contract, nowIso);
    const refreshed = db.select().from(dailyContracts).where(eq(dailyContracts.dateLocal, contract.dateLocal)).get()!;
    const view = contractDto(db, refreshed);
    const profile = ensureProfile(db, settings, nowIso);
    if (view.coreComplete) {
      db.update(dailyContracts).set({ state: view.optionalComplete ? 'complete' : 'locked', evaluatedAtUtc: nowIso, updatedAtUtc: nowIso }).where(eq(dailyContracts.dateLocal, refreshed.dateLocal)).run();
      if (view.optionalComplete) completeContractIfReady(db, profile, refreshed, nowIso);
      db.update(progressionProfiles).set({ activeStreak: profile.activeStreak + 1, longestStreak: Math.max(profile.longestStreak, profile.activeStreak + 1), updatedAtUtc: nowIso }).where(eq(progressionProfiles.id, PROFILE_ID)).run();
    } else {
      db.update(dailyContracts).set({ state: 'failed', evaluatedAtUtc: nowIso, updatedAtUtc: nowIso }).where(eq(dailyContracts.dateLocal, refreshed.dateLocal)).run();
      writeLedger(db, { resource: 'rank_points', kind: 'contract_penalty', sourceId: refreshed.dateLocal, amount: -50, seasonId: refreshed.seasonId, nowIso });
      db.update(progressionProfiles).set({ activeStreak: 0, pendingWeeklyCredits: 0, updatedAtUtc: nowIso }).where(eq(progressionProfiles.id, PROFILE_ID)).run();
    }
  }
}

export function selectOptionalMission(db: DB, settings: Settings, missionId: string, nowIso: string) {
  const season = ensureSeason(db, settings, nowIso);
  if (!season) throw new Error('Season 1 has not started yet.');
  const mission = db.select().from(progressionMissions).where(eq(progressionMissions.id, missionId)).get();
  if (!mission || mission.type !== 'optional' || !mission.contractDateLocal) throw new Error('Optional mission not found.');
  const contract = db.select().from(dailyContracts).where(eq(dailyContracts.dateLocal, mission.contractDateLocal)).get()!;
  if (contract.state !== 'open' || contract.optionalMissionId) throw new Error('Today\'s contract is already locked.');
  db.update(progressionMissions).set({ selected: 1 }).where(eq(progressionMissions.id, mission.id)).run();
  db.update(dailyContracts).set({ optionalMissionId: mission.id, updatedAtUtc: nowIso }).where(eq(dailyContracts.dateLocal, contract.dateLocal)).run();
}

function toRewardItem(db: DB, row: typeof progressionRewards.$inferSelect, credits: number): RewardItem {
  const redemptions = db.select().from(progressionRedemptions).where(eq(progressionRedemptions.rewardId, row.id)).all();
  const latest = redemptions.filter((r) => r.status !== 'refunded').sort((a, b) => b.claimedAtUtc.localeCompare(a.claimedAtUtc))[0];
  const cooldown = latest && row.cooldownDays > 0 && DateTime.fromISO(latest.claimedAtUtc).plus({ days: row.cooldownDays }) > DateTime.utc();
  const oneTime = !row.repeatable && redemptions.some((r) => r.status !== 'refunded');
  const unavailableReason = !row.active ? 'Inactive' : oneTime ? 'Already claimed' : cooldown ? 'Cooling down' : credits < row.creditCost ? 'Not enough Credits' : null;
  return { id: row.id, title: row.title, description: row.description, icon: row.icon, creditCost: row.creditCost, template: row.template as RewardItem['template'], repeatable: !!row.repeatable, cooldownDays: row.cooldownDays, active: !!row.active, realWorldPrice: row.realWorldPrice, available: !unavailableReason, unavailableReason };
}

export function listRewards(db: DB): RewardItem[] {
  const credits = sumResource(db, 'credits');
  return db.select().from(progressionRewards).all().map((row) => toRewardItem(db, row, credits));
}

export function upsertReward(db: DB, input: Omit<RewardItem, 'id' | 'available' | 'unavailableReason'> & { id?: string }, nowIso: string) {
  const id = input.id ?? randomUUID();
  db.insert(progressionRewards).values({ id, title: input.title, description: input.description, icon: input.icon, creditCost: input.creditCost, template: input.template, repeatable: input.repeatable ? 1 : 0, cooldownDays: input.cooldownDays, active: input.active ? 1 : 0, realWorldPrice: input.realWorldPrice, createdAtUtc: nowIso, updatedAtUtc: nowIso }).onConflictDoUpdate({ target: progressionRewards.id, set: { title: input.title, description: input.description, icon: input.icon, creditCost: input.creditCost, template: input.template, repeatable: input.repeatable ? 1 : 0, cooldownDays: input.cooldownDays, active: input.active ? 1 : 0, realWorldPrice: input.realWorldPrice, updatedAtUtc: nowIso } }).run();
  return toRewardItem(db, db.select().from(progressionRewards).where(eq(progressionRewards.id, id)).get()!, sumResource(db, 'credits'));
}

export function claimReward(db: DB, rewardId: string, nowIso: string): RewardRedemption {
  return (db as any).transaction((tx: DB) => {
    const reward = tx.select().from(progressionRewards).where(eq(progressionRewards.id, rewardId)).get();
    if (!reward) throw new Error('Reward not found.');
    const item = toRewardItem(tx, reward, sumResource(tx, 'credits'));
    if (!item.available) throw new Error(item.unavailableReason ?? 'Reward cannot be claimed.');
    const id = randomUUID();
    tx.insert(progressionRedemptions).values({ id, rewardId, creditCost: reward.creditCost, claimedAtUtc: nowIso }).run();
    writeLedger(tx, { resource: 'credits', kind: 'reward_claimed', sourceId: id, amount: -reward.creditCost, nowIso, metadata: { rewardId } });
    return { id, rewardId, creditCost: reward.creditCost, status: 'claimed', claimedAt: nowIso, usedAt: null, refundedAt: null };
  });
}

export function updateRedemption(db: DB, id: string, action: 'use' | 'refund', nowIso: string): RewardRedemption {
  return (db as any).transaction((tx: DB) => {
    const redemption = tx.select().from(progressionRedemptions).where(eq(progressionRedemptions.id, id)).get();
    if (!redemption || redemption.status !== 'claimed') throw new Error('Only an unused claim can be changed.');
    if (action === 'use') tx.update(progressionRedemptions).set({ status: 'used', usedAtUtc: nowIso }).where(eq(progressionRedemptions.id, id)).run();
    else {
      tx.update(progressionRedemptions).set({ status: 'refunded', refundedAtUtc: nowIso }).where(eq(progressionRedemptions.id, id)).run();
      writeLedger(tx, { resource: 'credits', kind: 'reward_refunded', sourceId: id, amount: redemption.creditCost, nowIso, metadata: { rewardId: redemption.rewardId } });
    }
    return { id, rewardId: redemption.rewardId, creditCost: redemption.creditCost, status: action === 'use' ? 'used' : 'refunded', claimedAt: redemption.claimedAtUtc, usedAt: action === 'use' ? nowIso : null, refundedAt: action === 'refund' ? nowIso : null };
  });
}

export function listRedemptions(db: DB): RewardRedemption[] {
  return db.select().from(progressionRedemptions).orderBy(desc(progressionRedemptions.claimedAtUtc)).all().map((r) => ({ id: r.id, rewardId: r.rewardId, creditCost: r.creditCost, status: r.status as RewardRedemption['status'], claimedAt: r.claimedAtUtc, usedAt: r.usedAtUtc, refundedAt: r.refundedAtUtc }));
}

export function claimPendingWeeklyBonus(db: DB, settings: Settings, weekStart: string, nowIso: string) {
  const season = ensureSeason(db, settings, nowIso);
  if (!season) throw new Error('Season 1 has not started yet.');
  return (db as any).transaction((tx: DB) => {
    const profile = ensureProfile(tx, settings, nowIso);
    const amount = profile.pendingWeeklyCredits;
    if (amount <= 0) return { claimed: 0 };
    const inserted = writeLedger(tx, { resource: 'credits', kind: 'weekly_bonus', sourceId: weekStart, amount, seasonId: season.id, nowIso });
    if (inserted) tx.update(progressionProfiles).set({ pendingWeeklyCredits: 0, updatedAtUtc: nowIso }).where(eq(progressionProfiles.id, PROFILE_ID)).run();
    return { claimed: inserted ? amount : 0 };
  });
}

const ACHIEVEMENT_GROUPS = [
  ['Foundations', 'First step'], ['Commitment', 'Show up'], ['Planning', 'Plan ahead'], ['Deep Focus', 'Focus block'], ['Resilience', 'Come back'], ['Rewards', 'Make it real'],
] as const;
export function achievementProgress(db: DB): AchievementProgress[] {
  const rows = new Map(db.select().from(progressionAchievements).all().map((r) => [r.id, r]));
  return ACHIEVEMENT_GROUPS.flatMap(([category, stem], group) => Array.from({ length: 6 }, (_, i) => {
    const tier = i < 2 ? 'I' : i < 4 ? 'II' : 'III'; const target = (i + 1) * 5; const id = `${category.toLowerCase().replaceAll(' ', '-')}-${i + 1}`; const row = rows.get(id);
    return { id, category, tier, name: `${stem} ${i + 1}`, requirement: `Reach ${target} ${category.toLowerCase()} actions.`, progress: row?.progress ?? 0, target, xp: 10 + i * 5, credits: 3 + i * 2, unlockedAt: row?.unlockedAtUtc ?? null };
  }));
}

export function getProgressionDashboard(db: DB, settings: Settings, nowIso: string): ProgressionDashboard {
  const profile = ensureProfile(db, settings, nowIso);
  const season = ensureSeason(db, settings, nowIso);
  const lifetimeXp = sumResource(db, 'xp');
  const levels = levelFromMasteryXp(lifetimeXp);
  if (!season) return { started: false, lifetimeXp, ...levels, credits: sumResource(db, 'credits'), activeStreak: profile.activeStreak, longestStreak: profile.longestStreak, pendingWeeklyCredits: profile.pendingWeeklyCredits, season: { ...rankFor(0), startLocal: profile.seasonStartLocal, endLocal: DateTime.fromISO(profile.seasonStartLocal).plus({ days: 55 }).toISODate()! }, contract: null, weeklyMissions: [], recentEvents: [] };
  evaluatePastContracts(db, settings, nowIso);
  const refreshedProfile = ensureProfile(db, settings, nowIso);
  const contract = ensureDailyContract(db, settings, nowIso, season.id);
  ensureWeeklyMissions(db, settings, nowIso, season.id);
  if (nowIso >= contract.lockAtUtc && contract.state === 'open') selectOptional(db, contract, nowIso);
  const rank = rankFor(sumResource(db, 'rank_points', season.id));
  const events: ProgressionEvent[] = db.select().from(progressionLedger).orderBy(desc(progressionLedger.seq)).limit(20).all().map((r) => ({ seq: r.seq, resource: r.resource as ProgressionEvent['resource'], kind: r.kind, amount: r.amount, createdAt: r.createdAtUtc, metadata: metadata(r) }));
  return { started: true, lifetimeXp, ...levels, credits: sumResource(db, 'credits'), activeStreak: refreshedProfile.activeStreak, longestStreak: refreshedProfile.longestStreak, pendingWeeklyCredits: refreshedProfile.pendingWeeklyCredits, season: { ...rank, id: season.id, startLocal: season.startLocal, endLocal: season.endLocal }, contract: contractDto(db, db.select().from(dailyContracts).where(eq(dailyContracts.dateLocal, contract.dateLocal)).get()!), weeklyMissions: db.select().from(progressionMissions).where(eq(progressionMissions.weekStartLocal, localNow(settings, nowIso).startOf('week').toISODate()!)).all().map(missionDto), recentEvents: events };
}
