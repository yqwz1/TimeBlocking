import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { eq, gte } from 'drizzle-orm';
import type { AchievementDTO, DayResultDTO, DayResultKind, GamificationSummaryDTO, RewardItem, XpEventDTO } from '@timeblock/shared';
import { achievementsUnlocked, dayResults, progressionRewards, xpEvents } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { getSettings } from '../settings.js';
import { buyFreeze, getSummary } from '../gamification/engine.js';
import { ACHIEVEMENTS } from '../gamification/achievements.js';
import { nowUtcIso } from '../config.js';
import { achievementProgress, claimPendingWeeklyBonus, claimReward, getProgressionDashboard, listRedemptions, listRewards, selectOptionalMission, updateRedemption, upsertReward } from '../gamification/progression.js';

export function registerGamificationRoutes(app: FastifyInstance, db: DB) {
  // V1 endpoints below intentionally remain available as a read-only legacy archive.
  app.get('/gamification/summary', async (): Promise<GamificationSummaryDTO> => getSummary(db, getSettings(db)));

  app.get('/progression/dashboard', async () => getProgressionDashboard(db, getSettings(db), nowUtcIso()));
  app.get('/progression/history', async () => getProgressionDashboard(db, getSettings(db), nowUtcIso()).recentEvents);
  app.get('/progression/achievements', async () => achievementProgress(db));
  app.post<{ Params: { id: string } }>('/progression/missions/:id/select', async (req, reply) => {
    try { selectOptionalMission(db, getSettings(db), req.params.id, nowUtcIso()); return getProgressionDashboard(db, getSettings(db), nowUtcIso()); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Could not select mission.' }); }
  });
  app.post<{ Params: { weekStart: string } }>('/progression/weekly-bonus/:weekStart/claim', async (req, reply) => {
    try { return claimPendingWeeklyBonus(db, getSettings(db), req.params.weekStart, nowUtcIso()); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Could not claim weekly bonus.' }); }
  });
  app.get('/progression/rewards', async (): Promise<RewardItem[]> => listRewards(db));
  app.get('/progression/redemptions', async () => listRedemptions(db));
  app.post<{ Body: Partial<RewardItem> }>('/progression/rewards', async (req, reply) => {
    const v = req.body;
    const title = typeof v?.title === 'string' ? v.title : null;
    const creditCost = typeof v?.creditCost === 'number' ? v.creditCost : null;
    if (!title || creditCost === null || !Number.isInteger(creditCost) || creditCost < 1) return reply.code(400).send({ error: 'title and a positive integer creditCost are required.' });
    return upsertReward(db, { id: undefined, title, description: v.description ?? '', icon: v.icon ?? null, creditCost, template: v.template ?? 'custom', repeatable: v.repeatable ?? true, cooldownDays: Math.max(0, v.cooldownDays ?? 0), active: v.active ?? true, realWorldPrice: v.realWorldPrice ?? null }, nowUtcIso());
  });
  app.patch<{ Params: { id: string }; Body: Partial<RewardItem> }>('/progression/rewards/:id', async (req, reply) => {
    const existing = db.select().from(progressionRewards).where(eq(progressionRewards.id, req.params.id)).get();
    if (!existing) return reply.code(404).send({ error: 'Reward not found.' });
    const v = req.body;
    const creditCost = v.creditCost ?? existing.creditCost;
    if (!Number.isInteger(creditCost) || creditCost < 1) return reply.code(400).send({ error: 'creditCost must be a positive integer.' });
    return upsertReward(db, { id: existing.id, title: v.title ?? existing.title, description: v.description ?? existing.description, icon: v.icon === undefined ? existing.icon : v.icon, creditCost, template: v.template ?? existing.template as RewardItem['template'], repeatable: v.repeatable ?? !!existing.repeatable, cooldownDays: Math.max(0, v.cooldownDays ?? existing.cooldownDays), active: v.active ?? !!existing.active, realWorldPrice: v.realWorldPrice === undefined ? existing.realWorldPrice : v.realWorldPrice }, nowUtcIso());
  });
  app.delete<{ Params: { id: string } }>('/progression/rewards/:id', async (req, reply) => {
    const existing = db.select().from(progressionRewards).where(eq(progressionRewards.id, req.params.id)).get();
    if (!existing) return reply.code(404).send({ error: 'Reward not found.' });
    db.update(progressionRewards).set({ active: 0, updatedAtUtc: nowUtcIso() }).where(eq(progressionRewards.id, req.params.id)).run();
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/progression/rewards/:id/claim', async (req, reply) => {
    try { return claimReward(db, req.params.id, nowUtcIso()); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Could not claim reward.' }); }
  });
  app.post<{ Params: { id: string } }>('/progression/redemptions/:id/use', async (req, reply) => {
    try { return updateRedemption(db, req.params.id, 'use', nowUtcIso()); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Could not update redemption.' }); }
  });
  app.post<{ Params: { id: string } }>('/progression/redemptions/:id/refund', async (req, reply) => {
    try { return updateRedemption(db, req.params.id, 'refund', nowUtcIso()); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Could not update redemption.' }); }
  });

  app.get<{ Querystring: { afterSeq?: string; limit?: string } }>('/gamification/events', async (req): Promise<XpEventDTO[]> => {
    const afterSeq = Number(req.query.afterSeq ?? '0') || 0;
    const limit = Math.min(100, Number(req.query.limit ?? '20') || 20);
    return db
      .select()
      .from(xpEvents)
      .where(gte(xpEvents.seq, afterSeq + 1))
      .orderBy(xpEvents.seq)
      .limit(limit)
      .all()
      .map((r) => {
        const meta = JSON.parse(r.meta) as { title?: string; achievementId?: string };
        return {
          seq: r.seq,
          kind: r.kind as XpEventDTO['kind'],
          amount: r.amount,
          dateLocal: r.dateLocal,
          title: meta.title,
          achievementId: meta.achievementId,
          createdAt: r.createdAtUtc,
        };
      });
  });

  app.get('/gamification/achievements', async (): Promise<AchievementDTO[]> => {
    const unlocked = new Map(db.select().from(achievementsUnlocked).all().map((r) => [r.id, r]));
    return ACHIEVEMENTS.map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      icon: def.icon,
      xp: def.xp,
      unlockedAt: unlocked.get(def.id)?.unlockedAtUtc ?? null,
    }));
  });

  app.get<{ Querystring: { days?: string } }>('/gamification/xp-history', async (req): Promise<{ date: string; xp: number }[]> => {
    const days = Math.min(365, Math.max(1, Number(req.query.days ?? '30') || 30));
    const tz = getSettings(db).timezone;
    const today = DateTime.now().setZone(tz).startOf('day');
    const startDate = today.minus({ days: days - 1 }).toISODate()!;
    const rows = db.select().from(xpEvents).where(gte(xpEvents.dateLocal, startDate)).all();
    const byDate = new Map<string, number>();
    for (const r of rows) byDate.set(r.dateLocal, (byDate.get(r.dateLocal) ?? 0) + r.amount);
    const out: { date: string; xp: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = today.minus({ days: i }).toISODate()!;
      out.push({ date, xp: byDate.get(date) ?? 0 });
    }
    return out;
  });

  app.get<{ Querystring: { weeks?: string } }>('/gamification/streak-calendar', async (req): Promise<DayResultDTO[]> => {
    const weeks = Math.min(52, Math.max(1, Number(req.query.weeks ?? '12') || 12));
    const tz = getSettings(db).timezone;
    const today = DateTime.now().setZone(tz).startOf('day');
    const startDate = today.minus({ weeks }).toISODate()!;
    const rows = db.select().from(dayResults).where(gte(dayResults.date, startDate)).orderBy(dayResults.date).all();
    const out: DayResultDTO[] = rows.map((r) => ({
      date: r.date,
      result: r.result as DayResultKind,
      doneCount: r.doneCount,
      missedCount: r.missedCount,
      plannedCount: r.plannedCount,
      streakAfter: r.streakAfter,
    }));
    const todayIso = today.toISODate()!;
    if (!out.some((d) => d.date === todayIso)) {
      const summary = getSummary(db, getSettings(db));
      out.push({
        date: todayIso,
        result: summary.streak.todayMet ? 'met' : 'rest',
        doneCount: summary.streak.todayCounts.done,
        missedCount: summary.streak.todayCounts.missed,
        plannedCount: summary.streak.todayCounts.planned,
        streakAfter: summary.streak.current,
      });
    }
    return out;
  });

  app.post('/gamification/freeze/buy', async (_req, reply) => {
    const settings = getSettings(db);
    const result = buyFreeze(db, settings, nowUtcIso());
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return result;
  });
}
