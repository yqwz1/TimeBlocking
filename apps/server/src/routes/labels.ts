import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { LabelInputSchema, type LabelDTO } from '@timeblock/shared';
import { labels, objectives, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { nowUtcIso } from '../config.js';

function taskCountFor(db: DB, name: string): number {
  return db
    .select({ labels: tasks.labels })
    .from(tasks)
    .where(eq(tasks.isDeleted, 0))
    .all()
    .filter((t) => (JSON.parse(t.labels || '[]') as string[]).includes(name)).length;
}

function toDTO(db: DB, l: typeof labels.$inferSelect): LabelDTO {
  return { id: l.id, name: l.name, color: l.color, taskCount: taskCountFor(db, l.name) };
}

/** Rewrites every occurrence of a label name across tasks.labels JSON and label-linked objectives. */
function renameEverywhere(db: DB, oldName: string, newName: string): void {
  const affected = db.select().from(tasks).where(eq(tasks.isDeleted, 0)).all();
  for (const t of affected) {
    const names: string[] = JSON.parse(t.labels || '[]');
    if (!names.includes(oldName)) continue;
    db.update(tasks)
      .set({ labels: JSON.stringify(names.map((n) => (n === oldName ? newName : n))) })
      .where(eq(tasks.id, t.id))
      .run();
  }
  db.update(objectives)
    .set({ linkValue: newName })
    .where(and(eq(objectives.linkKind, 'label'), eq(objectives.linkValue, oldName)))
    .run();
}

/** Strips a label name from every task that carries it (used before a label is deleted). */
function stripEverywhere(db: DB, name: string): void {
  const affected = db.select().from(tasks).where(eq(tasks.isDeleted, 0)).all();
  for (const t of affected) {
    const names: string[] = JSON.parse(t.labels || '[]');
    if (!names.includes(name)) continue;
    db.update(tasks)
      .set({ labels: JSON.stringify(names.filter((n) => n !== name)) })
      .where(eq(tasks.id, t.id))
      .run();
  }
}

export function registerLabelRoutes(app: FastifyInstance, db: DB) {
  app.get('/labels', async (): Promise<LabelDTO[]> => {
    return db.select().from(labels).all().map((l) => toDTO(db, l));
  });

  app.post<{ Body: unknown }>('/labels', async (req, reply) => {
    const parsed = LabelInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const input = parsed.data;
    const existing = db.select().from(labels).where(eq(labels.name, input.name)).get();
    if (existing) return toDTO(db, existing);
    const id = randomUUID();
    db.insert(labels).values({ id, name: input.name, color: input.color ?? null, createdAtUtc: nowUtcIso() }).run();
    return reply.code(201).send(toDTO(db, db.select().from(labels).where(eq(labels.id, id)).get()!));
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/labels/:id', async (req, reply) => {
    const l = db.select().from(labels).where(eq(labels.id, req.params.id)).get();
    if (!l) return reply.code(404).send({ error: 'not found' });
    const parsed = LabelInputSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const input = parsed.data;

    if (input.name !== undefined && input.name !== l.name) {
      renameEverywhere(db, l.name, input.name);
    }
    const patch: Partial<typeof labels.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.color !== undefined) patch.color = input.color;
    if (Object.keys(patch).length) db.update(labels).set(patch).where(eq(labels.id, l.id)).run();
    return toDTO(db, db.select().from(labels).where(eq(labels.id, l.id)).get()!);
  });

  app.delete<{ Params: { id: string } }>('/labels/:id', async (req, reply) => {
    const l = db.select().from(labels).where(eq(labels.id, req.params.id)).get();
    if (!l) return reply.code(404).send({ error: 'not found' });
    stripEverywhere(db, l.name);
    db.delete(labels).where(eq(labels.id, l.id)).run();
    return { ok: true };
  });
}
