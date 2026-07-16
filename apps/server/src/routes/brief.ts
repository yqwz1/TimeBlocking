import type { FastifyInstance } from 'fastify';
import type { BriefDTO, TodayPlanDTO } from '@timeblock/shared';
import { briefs } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { getSettings } from '../settings.js';
import { buildTodayPlan } from '../plan/today.js';
import { aiConfigured, generateBrief } from '../ai/brief.js';
import { isOfflineError } from '../integrations/google/client.js';
import { nowUtcIso } from '../config.js';

export function registerBriefRoutes(app: FastifyInstance, db: DB) {
  app.get('/plan/today', async (): Promise<TodayPlanDTO> => buildTodayPlan(db, getSettings(db)));

  app.post('/brief', async (_req, reply) => {
    const settings = getSettings(db);
    if (!settings.aiEnabled || !aiConfigured()) return reply.code(501).send({ error: 'AI brief not enabled' });
    const today = buildTodayPlan(db, settings);
    let content: string;
    try {
      content = await generateBrief(today, settings.aiModel);
    } catch (err) {
      // The AI brief needs internet (Gemini). Offline, fail cleanly instead of a 500.
      if (isOfflineError(err)) return reply.code(503).send({ error: 'AI brief unavailable offline' });
      throw err;
    }
    const createdAt = nowUtcIso();
    const result = db.insert(briefs).values({ date: today.date, createdAtUtc: createdAt, content }).run();
    const dto: BriefDTO = { id: Number(result.lastInsertRowid), date: today.date, createdAt, content };
    return dto;
  });

  app.get<{ Querystring: { date?: string } }>('/brief', async (req) => {
    const date = req.query.date ?? new Date().toISOString().slice(0, 10);
    return db.select().from(briefs).where(eq(briefs.date, date)).all().at(-1) ?? null;
  });
}
