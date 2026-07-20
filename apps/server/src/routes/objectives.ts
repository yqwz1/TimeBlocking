import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { ObjectiveInputSchema, ObjectivePatchSchema, type ObjectiveDTO } from '@timeblock/shared';
import { objectives } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { getSettings } from '../settings.js';
import { objectiveToDTO } from '../plan/objectives.js';

export function registerObjectiveRoutes(app: FastifyInstance, db: DB) {
  app.get<{ Querystring: { weekStart?: string } }>('/objectives', async (req): Promise<ObjectiveDTO[]> => {
    const tz = getSettings(db).timezone;
    const weekStart = req.query.weekStart ?? DateTime.now().setZone(tz).startOf('week').toISODate()!;
    return db
      .select()
      .from(objectives)
      .where(eq(objectives.weekStart, weekStart))
      .all()
      .map((o) => objectiveToDTO(db, o, tz));
  });

  app.post<{ Body: unknown }>('/objectives', async (req, reply) => {
    const parsed = ObjectiveInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const v = parsed.data;
    const id = randomUUID();
    db.insert(objectives)
      .values({
        id,
        weekStart: v.weekStart,
        title: v.title,
        targetMinutes: v.targetMinutes,
        targetCount: v.targetCount,
        linkKind: v.linkKind,
        linkValue: v.linkValue,
        notes: v.notes,
      })
      .run();
    return objectiveToDTO(db, db.select().from(objectives).where(eq(objectives.id, id)).get()!, getSettings(db).timezone);
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/objectives/:id', async (req, reply) => {
    const existing = db.select().from(objectives).where(eq(objectives.id, req.params.id)).get();
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const parsed = ObjectivePatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
    if (Object.keys(patch).length > 0) {
      db.update(objectives).set(patch).where(eq(objectives.id, req.params.id)).run();
    }
    return objectiveToDTO(db, db.select().from(objectives).where(eq(objectives.id, req.params.id)).get()!, getSettings(db).timezone);
  });

  app.delete<{ Params: { id: string } }>('/objectives/:id', async (req) => {
    db.delete(objectives).where(eq(objectives.id, req.params.id)).run();
    return { ok: true };
  });
}
