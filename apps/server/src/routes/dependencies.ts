import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { DependencyInputSchema } from '@timeblock/shared';
import { taskDependencies, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import type { SyncManager } from '../sync/manager.js';
import { dependencyRefs, taskToDTO } from '../plan/mappers.js';
import { wouldCreateDependencyCycle } from '../tasks/service.js';
import { nowUtcIso } from '../config.js';

/** "Blocked by" edges: a task can't be scheduled until every task it depends on is done/cancelled. */
export function registerDependencyRoutes(app: FastifyInstance, db: DB, manager: SyncManager) {
  app.post<{ Params: { id: string }; Body: unknown }>('/tasks/:id/dependencies', async (req, reply) => {
    const t = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
    if (!t || t.isDeleted) return reply.code(404).send({ error: 'task not found' });
    const parsed = DependencyInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const { blockerId } = parsed.data;

    if (blockerId === t.id) return reply.code(400).send({ error: 'a task cannot depend on itself' });
    const blocker = db.select().from(tasks).where(eq(tasks.id, blockerId)).get();
    if (!blocker || blocker.isDeleted) return reply.code(400).send({ error: 'blocker task not found' });
    const existing = db
      .select()
      .from(taskDependencies)
      .where(and(eq(taskDependencies.blockerId, blockerId), eq(taskDependencies.blockedId, t.id)))
      .get();
    if (existing) return taskToDTO(db, t);
    if (wouldCreateDependencyCycle(db, blockerId, t.id)) {
      return reply.code(400).send({ error: 'that would create a dependency cycle' });
    }

    db.insert(taskDependencies)
      .values({ id: randomUUID(), blockerId, blockedId: t.id, createdAtUtc: nowUtcIso() })
      .run();
    void manager.forcePlan('task-dependency-add');
    return reply.code(201).send(taskToDTO(db, t));
  });

  app.delete<{ Params: { id: string; blockerId: string } }>('/tasks/:id/dependencies/:blockerId', async (req, reply) => {
    const t = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
    if (!t) return reply.code(404).send({ error: 'task not found' });
    db.delete(taskDependencies)
      .where(and(eq(taskDependencies.blockerId, req.params.blockerId), eq(taskDependencies.blockedId, t.id)))
      .run();
    void manager.forcePlan('task-dependency-remove');
    return taskToDTO(db, t);
  });

  app.get<{ Params: { id: string } }>('/tasks/:id/dependencies', async (req, reply) => {
    const t = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
    if (!t) return reply.code(404).send({ error: 'task not found' });
    return dependencyRefs(db, t.id);
  });
}
