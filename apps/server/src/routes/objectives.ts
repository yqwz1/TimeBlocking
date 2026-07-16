import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { ObjectiveInputSchema, type ObjectiveDTO } from '@timeblock/shared';
import { objectives } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { getSettings } from '../settings.js';
import { computeObjectiveProgress } from '../plan/objectives.js';

type ObjectiveRow = typeof objectives.$inferSelect;

function toDTO(db: DB, o: ObjectiveRow, tz: string): ObjectiveDTO {
  return {
    id: o.id,
    weekStart: o.weekStart,
    title: o.title,
    targetMinutes: o.targetMinutes,
    targetCount: o.targetCount,
    linkKind: o.linkKind as ObjectiveDTO['linkKind'],
    linkValue: o.linkValue,
    notes: o.notes,
    status: o.status as ObjectiveDTO['status'],
    ...computeObjectiveProgress(db, o, tz),
  };
}

export function registerObjectiveRoutes(app: FastifyInstance, db: DB) {
  app.get<{ Querystring: { weekStart?: string } }>('/objectives', async (req): Promise<ObjectiveDTO[]> => {
    const tz = getSettings(db).timezone;
    const weekStart = req.query.weekStart ?? DateTime.now().setZone(tz).startOf('week').toISODate()!;
    return db
      .select()
      .from(objectives)
      .where(eq(objectives.weekStart, weekStart))
      .all()
      .map((o) => toDTO(db, o, tz));
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
    return toDTO(db, db.select().from(objectives).where(eq(objectives.id, id)).get()!, getSettings(db).timezone);
  });

  app.patch<{ Params: { id: string }; Body: Partial<{ title: string; targetMinutes: number | null; targetCount: number | null; notes: string; status: 'active' | 'done' | 'dropped' }> }>(
    '/objectives/:id',
    async (req, reply) => {
      const existing = db.select().from(objectives).where(eq(objectives.id, req.params.id)).get();
      if (!existing) return reply.code(404).send({ error: 'not found' });
      db.update(objectives).set(req.body).where(eq(objectives.id, req.params.id)).run();
      return toDTO(db, db.select().from(objectives).where(eq(objectives.id, req.params.id)).get()!, getSettings(db).timezone);
    },
  );

  app.delete<{ Params: { id: string } }>('/objectives/:id', async (req) => {
    db.delete(objectives).where(eq(objectives.id, req.params.id)).run();
    return { ok: true };
  });
}
