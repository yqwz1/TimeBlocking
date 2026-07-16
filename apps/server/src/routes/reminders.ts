import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { ReminderInputSchema } from '@timeblock/shared';
import { reminders, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { reminderToDTO } from '../plan/mappers.js';
import { nowUtcIso } from '../config.js';

export function registerReminderRoutes(app: FastifyInstance, db: DB) {
  app.get<{ Params: { id: string } }>('/tasks/:id/reminders', async (req) => {
    return db.select().from(reminders).where(eq(reminders.taskId, req.params.id)).all().map(reminderToDTO);
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/tasks/:id/reminders', async (req, reply) => {
    const t = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
    if (!t) return reply.code(404).send({ error: 'task not found' });
    const parsed = ReminderInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const input = parsed.data;
    const id = randomUUID();
    db.insert(reminders)
      .values({ id, taskId: t.id, remindAtUtc: input.remindAtUtc, message: input.message ?? '', createdAtUtc: nowUtcIso() })
      .run();
    return reply.code(201).send(reminderToDTO(db.select().from(reminders).where(eq(reminders.id, id)).get()!));
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/reminders/:id', async (req, reply) => {
    const r = db.select().from(reminders).where(eq(reminders.id, req.params.id)).get();
    if (!r) return reply.code(404).send({ error: 'not found' });
    const parsed = ReminderInputSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const input = parsed.data;
    const patch: Partial<typeof reminders.$inferInsert> = {};
    if (input.remindAtUtc !== undefined) {
      patch.remindAtUtc = input.remindAtUtc;
      patch.firedAtUtc = null; // rescheduling re-arms a reminder that already fired
    }
    if (input.message !== undefined) patch.message = input.message;
    if (Object.keys(patch).length) db.update(reminders).set(patch).where(eq(reminders.id, r.id)).run();
    return reminderToDTO(db.select().from(reminders).where(eq(reminders.id, r.id)).get()!);
  });

  app.delete<{ Params: { id: string } }>('/reminders/:id', async (req, reply) => {
    const r = db.select().from(reminders).where(eq(reminders.id, req.params.id)).get();
    if (!r) return reply.code(404).send({ error: 'not found' });
    db.delete(reminders).where(eq(reminders.id, r.id)).run();
    return { ok: true };
  });
}
