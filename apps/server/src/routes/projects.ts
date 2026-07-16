import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { ProjectInputSchema, type ProjectDetailDTO } from '@timeblock/shared';
import { projects, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import type { SyncManager } from '../sync/manager.js';
import { nowUtcIso } from '../config.js';

function toDetail(db: DB, p: typeof projects.$inferSelect): ProjectDetailDTO {
  const openTasks = db.select().from(tasks).where(eq(tasks.projectId, p.id)).all().filter((t) => !t.isDeleted);
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    color: p.color,
    icon: p.icon,
    sortOrder: p.sortOrder,
    archived: !!p.archived,
    createdAt: p.createdAtUtc,
    taskCount: openTasks.length,
    doneCount: openTasks.filter((t) => t.status === 'done').length,
  };
}

export function registerProjectRoutes(app: FastifyInstance, db: DB, manager: SyncManager) {
  app.get('/projects', async (): Promise<ProjectDetailDTO[]> => {
    const rows = db.select().from(projects).all().sort((a, b) => a.sortOrder - b.sortOrder);
    return rows.map((p) => toDetail(db, p));
  });

  app.post<{ Body: unknown }>('/projects', async (req, reply) => {
    const parsed = ProjectInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const input = parsed.data;
    const id = randomUUID();
    db.insert(projects)
      .values({
        id,
        name: input.name,
        description: input.description ?? '',
        color: input.color ?? null,
        icon: input.icon ?? null,
        sortOrder: input.sortOrder ?? 0,
        archived: input.archived ? 1 : 0,
        createdAtUtc: nowUtcIso(),
      })
      .run();
    return reply.code(201).send(toDetail(db, db.select().from(projects).where(eq(projects.id, id)).get()!));
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/projects/:id', async (req, reply) => {
    const p = db.select().from(projects).where(eq(projects.id, req.params.id)).get();
    if (!p) return reply.code(404).send({ error: 'not found' });
    const parsed = ProjectInputSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const input = parsed.data;

    const patch: Partial<typeof projects.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.color !== undefined) patch.color = input.color;
    if (input.icon !== undefined) patch.icon = input.icon;
    if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
    if (input.archived !== undefined) patch.archived = input.archived ? 1 : 0;

    if (Object.keys(patch).length) db.update(projects).set(patch).where(eq(projects.id, p.id)).run();
    // projectName is denormalized onto every task row — keep it in sync on rename.
    if (input.name !== undefined && input.name !== p.name) {
      db.update(tasks).set({ projectName: input.name }).where(eq(tasks.projectId, p.id)).run();
      void manager.forcePlan('project-rename');
    }
    return toDetail(db, db.select().from(projects).where(eq(projects.id, p.id)).get()!);
  });

  app.delete<{ Params: { id: string } }>('/projects/:id', async (req, reply) => {
    const p = db.select().from(projects).where(eq(projects.id, req.params.id)).get();
    if (!p) return reply.code(404).send({ error: 'not found' });
    // Move its tasks to the Inbox (projectId = NULL) rather than deleting them.
    db.update(tasks).set({ projectId: null, projectName: null }).where(eq(tasks.projectId, p.id)).run();
    db.delete(projects).where(eq(projects.id, p.id)).run();
    return { ok: true };
  });
}
