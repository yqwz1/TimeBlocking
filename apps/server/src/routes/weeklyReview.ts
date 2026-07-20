import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import { and, eq, gte, lte } from 'drizzle-orm';
import {
  WeeklyReviewSchema,
  type ObjectiveDTO,
  type WeeklyReviewDTO,
  type WeeklyReviewSummary,
} from '@timeblock/shared';
import { analyticsDaily, dayResults, objectives, weeklyReviews } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { getSettings } from '../settings.js';
import { nowUtcIso } from '../config.js';
import { objectiveToDTO } from '../plan/objectives.js';
import { awardXp } from '../gamification/engine.js';

type Row = typeof weeklyReviews.$inferSelect;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REVIEW_XP = 60;

function weekObjectives(db: DB, weekStart: string, tz: string): ObjectiveDTO[] {
  return db.select().from(objectives).where(eq(objectives.weekStart, weekStart)).all().map((o) => objectiveToDTO(db, o, tz));
}

function buildSummary(db: DB, weekStart: string, tz: string, objs: ObjectiveDTO[]): WeeklyReviewSummary {
  const start = DateTime.fromISO(weekStart, { zone: tz });
  const endDate = start.plus({ days: 6 }).toISODate()!;

  const analytics = db
    .select()
    .from(analyticsDaily)
    .where(and(gte(analyticsDaily.date, weekStart), lte(analyticsDaily.date, endDate)))
    .all();
  let plannedMin = 0;
  let completedMin = 0;
  let missedMin = 0;
  for (const d of analytics) {
    plannedMin += d.plannedMin;
    completedMin += d.completedMin;
    missedMin += d.missedMin;
  }

  const results = db
    .select()
    .from(dayResults)
    .where(and(gte(dayResults.date, weekStart), lte(dayResults.date, endDate)))
    .all();
  const daysMet = results.filter((r) => r.result === 'met').length;
  const daysEvaluated = results.filter((r) => r.result !== 'rest').length;

  return {
    plannedMin,
    completedMin,
    missedMin,
    completionRate: plannedMin > 0 ? Math.min(1, completedMin / plannedMin) : 0,
    objectivesDone: objs.filter((o) => o.status === 'done').length,
    objectivesTotal: objs.length,
    daysMet,
    daysEvaluated,
  };
}

function toDTO(db: DB, row: Row | undefined, weekStart: string, tz: string): WeeklyReviewDTO {
  const objs = weekObjectives(db, weekStart, tz);
  return {
    weekStart,
    wins: row?.wins ?? '',
    challenges: row?.challenges ?? '',
    nextWeekFocus: row?.nextWeekFocus ?? '',
    rating: row?.rating ?? null,
    reviewedAt: row?.reviewedAtUtc ?? null,
    summary: buildSummary(db, weekStart, tz, objs),
    objectives: objs,
  };
}

function getRow(db: DB, weekStart: string): Row | undefined {
  return db.select().from(weeklyReviews).where(eq(weeklyReviews.weekStart, weekStart)).get();
}

function ensureRow(db: DB, weekStart: string) {
  const now = nowUtcIso();
  db.insert(weeklyReviews).values({ weekStart, createdAtUtc: now, updatedAtUtc: now }).onConflictDoNothing().run();
}

export function registerWeeklyReviewRoutes(app: FastifyInstance, db: DB) {
  app.get<{ Querystring: { weekStart?: string } }>('/weekly-review', async (req): Promise<WeeklyReviewDTO> => {
    const tz = getSettings(db).timezone;
    const weekStart = req.query.weekStart ?? DateTime.now().setZone(tz).startOf('week').toISODate()!;
    return toDTO(db, getRow(db, weekStart), weekStart, tz);
  });

  // Save a draft (does not mark the review complete).
  app.put<{ Params: { weekStart: string }; Body: unknown }>('/weekly-review/:weekStart', async (req, reply) => {
    const tz = getSettings(db).timezone;
    const { weekStart } = req.params;
    if (!DATE_RE.test(weekStart)) return reply.code(400).send({ error: 'bad weekStart' });
    const parsed = WeeklyReviewSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const v = parsed.data;
    ensureRow(db, weekStart);
    db.update(weeklyReviews)
      .set({ wins: v.wins, challenges: v.challenges, nextWeekFocus: v.nextWeekFocus, rating: v.rating, updatedAtUtc: nowUtcIso() })
      .where(eq(weeklyReviews.weekStart, weekStart))
      .run();
    return toDTO(db, getRow(db, weekStart), weekStart, tz);
  });

  // Save + finalize the review, snapshotting the week's numbers.
  app.post<{ Params: { weekStart: string }; Body: unknown }>('/weekly-review/:weekStart/complete', async (req, reply) => {
    const settings = getSettings(db);
    const tz = settings.timezone;
    const { weekStart } = req.params;
    if (!DATE_RE.test(weekStart)) return reply.code(400).send({ error: 'bad weekStart' });
    const parsed = WeeklyReviewSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const v = parsed.data;
    const now = nowUtcIso();
    const objs = weekObjectives(db, weekStart, tz);
    const summary = buildSummary(db, weekStart, tz, objs);
    ensureRow(db, weekStart);
    db.update(weeklyReviews)
      .set({
        wins: v.wins,
        challenges: v.challenges,
        nextWeekFocus: v.nextWeekFocus,
        rating: v.rating,
        reviewedAtUtc: now,
        plannedMin: summary.plannedMin,
        completedMin: summary.completedMin,
        missedMin: summary.missedMin,
        objectivesDone: summary.objectivesDone,
        objectivesTotal: summary.objectivesTotal,
        updatedAtUtc: now,
      })
      .where(eq(weeklyReviews.weekStart, weekStart))
      .run();
    awardXp(db, settings, { kind: 'weekly_review', sourceId: weekStart, amount: REVIEW_XP, dateLocal: weekStart, meta: { title: 'Weekly review' } }, now);
    return toDTO(db, getRow(db, weekStart), weekStart, tz);
  });

  app.post<{ Params: { weekStart: string } }>('/weekly-review/:weekStart/reopen', async (req, reply) => {
    const tz = getSettings(db).timezone;
    const { weekStart } = req.params;
    if (!DATE_RE.test(weekStart)) return reply.code(400).send({ error: 'bad weekStart' });
    if (getRow(db, weekStart)) {
      db.update(weeklyReviews).set({ reviewedAtUtc: null, updatedAtUtc: nowUtcIso() }).where(eq(weeklyReviews.weekStart, weekStart)).run();
    }
    return toDTO(db, getRow(db, weekStart), weekStart, tz);
  });
}
