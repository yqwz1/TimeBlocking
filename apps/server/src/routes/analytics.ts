import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { AnalyticsDailyDTO, WeeklyAnalyticsDTO } from '@timeblock/shared';
import { analyticsDaily } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { getSettings } from '../settings.js';

type Row = typeof analyticsDaily.$inferSelect;

function toDTO(row: Row | undefined, date: string): AnalyticsDailyDTO {
  if (!row) return { date, plannedMin: 0, completedMin: 0, missedMin: 0, externalBusyMin: 0, byProject: {}, byLabel: {}, byHabit: {} };
  return {
    date: row.date,
    plannedMin: row.plannedMin,
    completedMin: row.completedMin,
    missedMin: row.missedMin,
    externalBusyMin: row.externalBusyMin,
    byProject: JSON.parse(row.byProject),
    byLabel: JSON.parse(row.byLabel),
    byHabit: JSON.parse(row.byHabit),
  };
}

export function registerAnalyticsRoutes(app: FastifyInstance, db: DB) {
  app.get<{ Querystring: { date?: string } }>('/analytics/daily', async (req): Promise<AnalyticsDailyDTO> => {
    const tz = getSettings(db).timezone;
    const date = req.query.date ?? DateTime.now().setZone(tz).toISODate()!;
    return toDTO(db.select().from(analyticsDaily).where(eq(analyticsDaily.date, date)).get(), date);
  });

  app.get<{ Querystring: { weekStart?: string } }>('/analytics/weekly', async (req): Promise<WeeklyAnalyticsDTO> => {
    const tz = getSettings(db).timezone;
    const weekStart = req.query.weekStart ?? DateTime.now().setZone(tz).startOf('week').toISODate()!;
    const start = DateTime.fromISO(weekStart, { zone: tz });
    const days: AnalyticsDailyDTO[] = [];
    for (let i = 0; i < 7; i++) {
      const date = start.plus({ days: i }).toISODate()!;
      days.push(toDTO(db.select().from(analyticsDaily).where(eq(analyticsDaily.date, date)).get(), date));
    }
    const totals = days.reduce(
      (acc, d) => ({
        plannedMin: acc.plannedMin + d.plannedMin,
        completedMin: acc.completedMin + d.completedMin,
        missedMin: acc.missedMin + d.missedMin,
        externalBusyMin: acc.externalBusyMin + d.externalBusyMin,
      }),
      { plannedMin: 0, completedMin: 0, missedMin: 0, externalBusyMin: 0 },
    );
    const byProject: Record<string, { planned: number; done: number }> = {};
    for (const d of days) {
      for (const [k, v] of Object.entries(d.byProject)) {
        if (!byProject[k]) byProject[k] = { planned: 0, done: 0 };
        byProject[k].planned += v.planned;
        byProject[k].done += v.done;
      }
    }
    return { weekStart, days, totals, byProject };
  });
}
