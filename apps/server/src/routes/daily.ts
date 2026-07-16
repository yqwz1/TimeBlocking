import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { DailyHighlightSchema, DailyShutdownSchema, type DailyPlanDTO } from '@timeblock/shared';
import { dailyPlans } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { getSettings } from '../settings.js';
import { nowUtcIso } from '../config.js';
import { buildDailySummary } from '../plan/daily.js';
import { awardXp } from '../gamification/engine.js';

type Row = typeof dailyPlans.$inferSelect;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SHUTDOWN_XP = 20;

function toDTO(db: DB, row: Row | undefined, date: string, tz: string): DailyPlanDTO {
  return {
    date,
    highlight: row?.highlight ?? '',
    highlightTaskId: row?.highlightTaskId ?? null,
    highlightDone: !!row?.highlightDone,
    reflection: row?.reflection ?? '',
    rating: row?.rating ?? null,
    intention: row?.intention ?? '',
    shutdownDoneAt: row?.shutdownDoneAtUtc ?? null,
    summary: buildDailySummary(db, tz, date),
  };
}

function getRow(db: DB, date: string): Row | undefined {
  return db.select().from(dailyPlans).where(eq(dailyPlans.date, date)).get();
}

/** Insert a bare row for a date if none exists yet, so subsequent updates have something to patch. */
function ensureRow(db: DB, date: string) {
  const now = nowUtcIso();
  db.insert(dailyPlans).values({ date, createdAtUtc: now, updatedAtUtc: now }).onConflictDoNothing().run();
}

export function registerDailyRoutes(app: FastifyInstance, db: DB) {
  app.get<{ Querystring: { date?: string } }>('/daily', async (req): Promise<DailyPlanDTO> => {
    const tz = getSettings(db).timezone;
    const date = req.query.date ?? DateTime.now().setZone(tz).toISODate()!;
    return toDTO(db, getRow(db, date), date, tz);
  });

  app.patch<{ Params: { date: string }; Body: unknown }>('/daily/:date', async (req, reply) => {
    const tz = getSettings(db).timezone;
    const { date } = req.params;
    if (!DATE_RE.test(date)) return reply.code(400).send({ error: 'bad date' });
    const parsed = DailyHighlightSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const v = parsed.data;
    ensureRow(db, date);
    const patch: Partial<Row> = { updatedAtUtc: nowUtcIso() };
    if (v.highlight !== undefined) patch.highlight = v.highlight;
    if (v.highlightTaskId !== undefined) patch.highlightTaskId = v.highlightTaskId;
    if (v.highlightDone !== undefined) patch.highlightDone = v.highlightDone ? 1 : 0;
    db.update(dailyPlans).set(patch).where(eq(dailyPlans.date, date)).run();
    return toDTO(db, getRow(db, date), date, tz);
  });

  app.post<{ Params: { date: string }; Body: unknown }>('/daily/:date/shutdown', async (req, reply) => {
    const settings = getSettings(db);
    const tz = settings.timezone;
    const { date } = req.params;
    if (!DATE_RE.test(date)) return reply.code(400).send({ error: 'bad date' });
    const parsed = DailyShutdownSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const v = parsed.data;
    const now = nowUtcIso();
    const summary = buildDailySummary(db, tz, date);
    ensureRow(db, date);
    db.update(dailyPlans)
      .set({
        reflection: v.reflection,
        rating: v.rating,
        intention: v.intention,
        shutdownDoneAtUtc: now,
        doneCount: summary.doneCount,
        missedCount: summary.missedCount,
        plannedCount: summary.plannedCount,
        completedMin: summary.completedMin,
        updatedAtUtc: now,
      })
      .where(eq(dailyPlans.date, date))
      .run();
    // Reward the ritual once per day (idempotent on kind+sourceId).
    awardXp(db, settings, { kind: 'shutdown', sourceId: date, amount: SHUTDOWN_XP, dateLocal: date, meta: { title: 'Daily shutdown' } }, now);
    return toDTO(db, getRow(db, date), date, tz);
  });

  app.post<{ Params: { date: string } }>('/daily/:date/shutdown/reopen', async (req, reply) => {
    const tz = getSettings(db).timezone;
    const { date } = req.params;
    if (!DATE_RE.test(date)) return reply.code(400).send({ error: 'bad date' });
    if (getRow(db, date)) {
      db.update(dailyPlans).set({ shutdownDoneAtUtc: null, updatedAtUtc: nowUtcIso() }).where(eq(dailyPlans.date, date)).run();
    }
    return toDTO(db, getRow(db, date), date, tz);
  });
}
