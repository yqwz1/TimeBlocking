import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { TaskInputSchema, TaskPatchSchema, TaskReorderSchema, type TaskDetailDTO, type TaskDTO, type TaskViewDTO } from '@timeblock/shared';
import { attachments, blocks, projects, reminders, scheduleRuns, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import type { SyncManager } from '../sync/manager.js';
import { getSettings } from '../settings.js';
import { getAuthedClient } from '../integrations/google/auth.js';
import { APP_TAG, eventIdForBlock, Gcal } from '../integrations/google/client.js';
import { attachmentToDTO, dependencyRefs, reminderToDTO, taskToDTO, taskToView } from '../plan/mappers.js';
import { blockHash } from '../sync/hash.js';
import { nowUtcIso } from '../config.js';
import { completeTask, deleteTask, dueDatePatchForMove, ensureLabelsExist, isSelfOrAncestor, setTaskStatus } from '../tasks/service.js';
import { applyDeletionToCalendar } from '../sync/reconciler.js';

function latestRunIds(db: DB): { atRisk: Set<string>; unplaceable: Set<string> } {
  const row = db.select().from(scheduleRuns).orderBy(desc(scheduleRuns.id)).limit(1).get();
  if (!row) return { atRisk: new Set(), unplaceable: new Set() };
  return { atRisk: new Set(JSON.parse(row.atRisk)), unplaceable: new Set(JSON.parse(row.unplaceable)) };
}

function gcalOf(db: DB): Gcal | null {
  const auth = getAuthedClient(db);
  return auth ? new Gcal(auth) : null;
}

export function registerTaskRoutes(app: FastifyInstance, db: DB, manager: SyncManager) {
  app.get<{ Querystring: { view?: string } }>('/tasks', async (req): Promise<TaskViewDTO[]> => {
    const view = req.query.view ?? 'all';
    const { atRisk, unplaceable } = latestRunIds(db);
    const defaultDurationMin = getSettings(db).defaultDurationMin;

    const openTasks = db
      .select()
      .from(tasks)
      .where(eq(tasks.isDeleted, 0))
      .all()
      .filter((t) => t.status === 'todo' || t.status === 'in_progress');
    const allBlocks = db.select().from(blocks).where(inArray(blocks.status, ['scheduled', 'pending_create', 'missed'])).all();
    const blocksByTask = new Map<string, typeof allBlocks>();
    for (const b of allBlocks) {
      if (!b.taskId) continue;
      if (!blocksByTask.has(b.taskId)) blocksByTask.set(b.taskId, []);
      blocksByTask.get(b.taskId)!.push(b);
    }

    const out: TaskViewDTO[] = openTasks.map((t) => {
      const taskBlocks = blocksByTask.get(t.id) ?? [];
      const active = taskBlocks.find((b) => b.status === 'scheduled' || b.status === 'pending_create');
      const missed = taskBlocks.find((b) => b.status === 'missed');
      let v: TaskViewDTO['view'] = active ? 'scheduled' : missed ? 'missed' : 'unscheduled';
      if (unplaceable.has(t.id)) v = 'unplaceable';
      else if (atRisk.has(t.id)) v = 'at_risk';
      return taskToView(db, t, v, active?.startUtc ?? null, defaultDurationMin);
    });

    return view === 'all' ? out : out.filter((t) => t.view === view);
  });

  app.get<{ Querystring: { q?: string; projectId?: string; label?: string; status?: string; priority?: string; dueFrom?: string; dueTo?: string; parentId?: string; includeClosed?: string } }>(
    '/tasks/all',
    async (req): Promise<TaskDTO[]> => {
      const q = req.query;
      let rows = db.select().from(tasks).where(eq(tasks.isDeleted, 0)).all();

      if (!q.includeClosed || q.includeClosed === '0' || q.includeClosed === 'false') {
        rows = rows.filter((t) => t.status !== 'cancelled');
      }
      if (q.status) rows = rows.filter((t) => t.status === q.status);
      if (q.priority) rows = rows.filter((t) => t.priority === Number(q.priority));
      if (q.projectId !== undefined) {
        rows = q.projectId === '' || q.projectId === 'inbox' ? rows.filter((t) => !t.projectId) : rows.filter((t) => t.projectId === q.projectId);
      }
      if (q.parentId !== undefined) {
        rows = q.parentId === '' ? rows.filter((t) => !t.parentId) : rows.filter((t) => t.parentId === q.parentId);
      }
      if (q.label) {
        rows = rows.filter((t) => (JSON.parse(t.labels || '[]') as string[]).includes(q.label!));
      }
      if (q.dueFrom) rows = rows.filter((t) => !!t.dueDate && t.dueDate >= q.dueFrom!);
      if (q.dueTo) rows = rows.filter((t) => !!t.dueDate && t.dueDate <= q.dueTo!);
      if (q.q) {
        const needle = q.q.toLowerCase();
        rows = rows.filter((t) => t.content.toLowerCase().includes(needle) || t.description.toLowerCase().includes(needle));
      }

      return rows.map((t) => taskToDTO(db, t));
    },
  );

  app.get<{ Querystring: { days?: string } }>('/tasks/upcoming', async (req) => {
    const days = Math.max(1, Math.min(60, Number(req.query.days) || 7));
    const today = nowUtcIso().slice(0, 10);
    const end = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    const open = db
      .select()
      .from(tasks)
      .where(eq(tasks.isDeleted, 0))
      .all()
      .filter((t) => (t.status === 'todo' || t.status === 'in_progress') && !!t.dueDate);

    const overdue = open.filter((t) => t.dueDate! < today).map((t) => taskToDTO(db, t));
    const byDate: Record<string, TaskDTO[]> = {};
    for (const t of open) {
      if (t.dueDate! < today || t.dueDate! > end) continue;
      (byDate[t.dueDate!] ??= []).push(taskToDTO(db, t));
    }
    return { overdue, byDate };
  });

  app.get<{ Params: { id: string } }>('/tasks/:id', async (req, reply): Promise<TaskDetailDTO> => {
    const t = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
    if (!t) return reply.code(404).send({ error: 'not found' }) as never;
    const children = db.select().from(tasks).where(and(eq(tasks.parentId, t.id), eq(tasks.isDeleted, 0))).all();
    const taskAttachments = db.select().from(attachments).where(eq(attachments.taskId, t.id)).all();
    const taskReminders = db.select().from(reminders).where(eq(reminders.taskId, t.id)).all();
    const { dependsOn, blocks } = dependencyRefs(db, t.id);
    return {
      ...taskToDTO(db, t),
      children: children.map((c) => taskToDTO(db, c)),
      attachments: taskAttachments.map(attachmentToDTO),
      reminders: taskReminders.map(reminderToDTO),
      dependsOn,
      blocks,
    };
  });

  app.post<{ Body: unknown }>('/tasks', async (req, reply) => {
    const parsed = TaskInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const input = parsed.data;

    if (input.parentId) {
      const parent = db.select().from(tasks).where(eq(tasks.id, input.parentId)).get();
      if (!parent || parent.isDeleted) return reply.code(400).send({ error: 'parent task not found' });
    }
    if (input.labels?.length) ensureLabelsExist(db, input.labels);

    const now = nowUtcIso();
    const id = randomUUID();
    let projectName: string | null = null;
    if (input.projectId) {
      projectName = db.select({ name: projects.name }).from(projects).where(eq(projects.id, input.projectId)).get()?.name ?? null;
    }

    db.insert(tasks)
      .values({
        id,
        content: input.content,
        description: input.description ?? '',
        projectId: input.projectId ?? null,
        projectName,
        parentId: input.parentId ?? null,
        priority: input.priority ?? 1,
        dueDate: input.dueDate ?? null,
        dueDatetimeUtc: input.dueDatetimeUtc ?? null,
        durationMin: input.durationMin ?? null,
        difficulty: input.difficulty ?? null,
        labels: JSON.stringify(input.labels ?? []),
        links: JSON.stringify(input.links ?? []),
        color: input.color ?? null,
        status: input.status ?? 'todo',
        isCompleted: input.status === 'done' ? 1 : 0,
        skipScheduling: input.skipScheduling ? 1 : 0,
        plannedForDate: input.plannedForDate ?? null,
        createdAtUtc: now,
        updatedAtUtc: now,
        completedAtUtc: input.status === 'done' ? now : null,
      })
      .run();

    void manager.forcePlan('task-create');
    const t = db.select().from(tasks).where(eq(tasks.id, id)).get()!;
    return reply.code(201).send(taskToDTO(db, t));
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/tasks/:id', async (req, reply) => {
    const t = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
    if (!t) return reply.code(404).send({ error: 'not found' });
    const parsed = TaskPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const input = parsed.data;

    if (input.parentId) {
      if (input.parentId === t.id || isSelfOrAncestor(db, t.id, input.parentId)) {
        return reply.code(400).send({ error: 'a task cannot be its own ancestor' });
      }
      const parent = db.select().from(tasks).where(eq(tasks.id, input.parentId)).get();
      if (!parent || parent.isDeleted) return reply.code(400).send({ error: 'parent task not found' });
    }
    if (input.labels?.length) ensureLabelsExist(db, input.labels);

    const now = nowUtcIso();
    const wantsDone = input.status === 'done' && t.status !== 'done';
    const wantsReopen = input.status && input.status !== 'done' && t.status === 'done';

    const patch: Partial<typeof tasks.$inferInsert> = { updatedAtUtc: now };
    if (input.content !== undefined) patch.content = input.content;
    if (input.description !== undefined) patch.description = input.description;
    if (input.parentId !== undefined) patch.parentId = input.parentId;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
    if (input.dueDatetimeUtc !== undefined) patch.dueDatetimeUtc = input.dueDatetimeUtc;
    if (input.durationMin !== undefined) patch.durationMin = input.durationMin;
    if (input.difficulty !== undefined) patch.difficulty = input.difficulty;
    if (input.labels !== undefined) patch.labels = JSON.stringify(input.labels);
    if (input.links !== undefined) patch.links = JSON.stringify(input.links);
    if (input.color !== undefined) patch.color = input.color;
    if (input.skipScheduling !== undefined) patch.skipScheduling = input.skipScheduling ? 1 : 0;
    if (input.plannedForDate !== undefined) patch.plannedForDate = input.plannedForDate;
    if (input.status !== undefined && !wantsDone) patch.status = input.status; // 'done' handled via completeTask below

    if (input.projectId !== undefined) {
      patch.projectId = input.projectId;
      patch.projectName = input.projectId
        ? (db.select({ name: projects.name }).from(projects).where(eq(projects.id, input.projectId)).get()?.name ?? null)
        : null;
    }

    if (Object.keys(patch).length > 1) db.update(tasks).set(patch).where(eq(tasks.id, t.id)).run();

    if (wantsDone) {
      await completeTask(db, gcalOf(db), getSettings(db), t.id);
    } else if (wantsReopen) {
      setTaskStatus(db, t.id, input.status!, now);
    }

    const scheduleAffecting =
      input.dueDate !== undefined ||
      input.dueDatetimeUtc !== undefined ||
      input.durationMin !== undefined ||
      input.difficulty !== undefined ||
      input.priority !== undefined ||
      input.labels !== undefined ||
      input.projectId !== undefined ||
      input.status !== undefined ||
      input.parentId !== undefined ||
      input.skipScheduling !== undefined ||
      input.plannedForDate !== undefined;
    if (scheduleAffecting) void manager.forcePlan('task-edit');

    const updated = db.select().from(tasks).where(eq(tasks.id, t.id)).get()!;
    return taskToDTO(db, updated);
  });

  /** Reorder a set of sibling tasks (e.g. drag/move-up-down in the list view). Sets sortOrder = index. */
  app.post<{ Body: unknown }>('/tasks/reorder', async (req, reply) => {
    const parsed = TaskReorderSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const now = nowUtcIso();
    parsed.data.ids.forEach((id, i) => {
      db.update(tasks).set({ sortOrder: i, updatedAtUtc: now }).where(eq(tasks.id, id)).run();
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/tasks/:id', async (req, reply) => {
    const t = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
    if (!t) return reply.code(404).send({ error: 'not found' });
    await deleteTask(db, gcalOf(db), getSettings(db), t.id);
    void manager.forcePlan('task-delete');
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/complete', async (req, reply) => {
    const t = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
    if (!t) return reply.code(404).send({ error: 'not found' });
    await completeTask(db, gcalOf(db), getSettings(db), t.id);
    void manager.forcePlan('task-complete');
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/reopen', async (req, reply) => {
    const t = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
    if (!t) return reply.code(404).send({ error: 'not found' });
    setTaskStatus(db, t.id, 'todo', nowUtcIso());
    void manager.forcePlan('task-reopen');
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/unschedule', async (req, reply) => {
    const t = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
    if (!t) return reply.code(404).send({ error: 'not found' });
    db.update(tasks).set({ skipScheduling: 1, forceSchedule: 0 }).where(eq(tasks.id, t.id)).run();
    // Delete the live block(s) directly instead of waiting for the next auto-plan diff —
    // with autoApply:'off' that diff never applies, so this used to silently no-op.
    await applyDeletionToCalendar(db, gcalOf(db), getSettings(db), [t.id]);
    void manager.forcePlan('task-unschedule');
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/reschedule', async (req, reply) => {
    const t = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
    if (!t) return reply.code(404).send({ error: 'not found' });
    db.update(tasks).set({ skipScheduling: 0, forceSchedule: 1 }).where(eq(tasks.id, t.id)).run();
    await manager.forcePlan('task-reschedule');
    return { ok: true };
  });

  /**
   * Drop a task onto an explicit time slot (drag-to-schedule). Creates or moves
   * the task's block at the given time and locks it so the planner keeps it put.
   * Mirrors reconciler.applyOps: DB row first, then a best-effort Google push.
   */
  app.post<{ Params: { id: string }; Body: { startUtc: string; endUtc: string } }>(
    '/tasks/:id/schedule-at',
    async (req, reply) => {
      const t = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
      if (!t) return reply.code(404).send({ error: 'not found' });
      const { startUtc, endUtc } = req.body ?? {};
      if (!startUtc || !endUtc || startUtc >= endUtc) {
        return reply.code(400).send({ error: 'valid startUtc & endUtc required (start < end)' });
      }

      const settings = getSettings(db);
      const now = nowUtcIso();
      const gcal = gcalOf(db);
      const canPush = !!(gcal && settings.appCalendarId);
      const hash = blockHash(startUtc, endUtc);

      // Keep the task in scope and force it schedulable regardless of due-date policy.
      // If the task carries a deadline, move it along with the block so it doesn't go stale.
      const duePatch = t.dueDate ? dueDatePatchForMove(settings.timezone, startUtc, !!t.dueDatetimeUtc) : {};
      db.update(tasks).set({ skipScheduling: 0, forceSchedule: 1, ...duePatch }).where(eq(tasks.id, t.id)).run();

      const existing = db
        .select()
        .from(blocks)
        .where(and(eq(blocks.taskId, t.id), inArray(blocks.status, ['scheduled', 'pending_create'])))
        .get();

      // DB writes happen synchronously so the response returns immediately; the Google
      // push (and the follow-up gcalEventId write once it resolves) runs in the background
      // — awaiting a live Calendar API round-trip here made every drag-to-schedule wait on it.
      if (existing) {
        db.update(blocks)
          .set({ startUtc, endUtc, locked: 1, lastPushedHash: hash, updatedAtUtc: now })
          .where(eq(blocks.id, existing.id))
          .run();
        if (canPush) {
          if (existing.gcalEventId) {
            void gcal!
              .patchEvent(settings.appCalendarId!, existing.gcalEventId, {
                start: { dateTime: startUtc, timeZone: settings.timezone },
                end: { dateTime: endUtc, timeZone: settings.timezone },
              })
              .catch((err) => req.log.error({ err, blockId: existing.id }, 'failed to push schedule-at move to Google Calendar'));
          } else {
            const eventId = eventIdForBlock(existing.id);
            void gcal!
              .insertEvent(settings.appCalendarId!, {
                id: eventId,
                summary: t.content,
                start: { dateTime: startUtc, timeZone: settings.timezone },
                end: { dateTime: endUtc, timeZone: settings.timezone },
                extendedProperties: { private: { app: APP_TAG, blockId: existing.id, taskId: t.id } },
              })
              .then(() => db.update(blocks).set({ gcalEventId: eventId }).where(eq(blocks.id, existing.id)).run())
              .catch((err) => req.log.error({ err, blockId: existing.id }, 'failed to push schedule-at insert to Google Calendar'));
          }
        }
        return { ok: true, blockId: existing.id };
      }

      const blockId = randomUUID();
      db.insert(blocks)
        .values({
          id: blockId,
          taskId: t.id,
          calendarId: settings.appCalendarId ?? null,
          startUtc,
          endUtc,
          status: 'scheduled',
          locked: 1,
          lastPushedHash: canPush ? hash : null,
          createdAtUtc: now,
          updatedAtUtc: now,
        })
        .run();
      if (canPush) {
        const eventId = eventIdForBlock(blockId);
        void gcal!
          .insertEvent(settings.appCalendarId!, {
            id: eventId,
            summary: t.content,
            start: { dateTime: startUtc, timeZone: settings.timezone },
            end: { dateTime: endUtc, timeZone: settings.timezone },
            extendedProperties: { private: { app: APP_TAG, blockId, taskId: t.id } },
          })
          .then(() => db.update(blocks).set({ gcalEventId: eventId }).where(eq(blocks.id, blockId)).run())
          .catch((err) => req.log.error({ err, blockId }, 'failed to push schedule-at insert to Google Calendar'));
      }
      return { ok: true, blockId };
    },
  );
}
