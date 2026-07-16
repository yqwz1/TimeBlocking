import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { GoalInputSchema, GoalMilestoneInputSchema, type GoalDTO, type GoalMilestoneDTO } from '@timeblock/shared';
import { goalMilestones, goals } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { getSettings } from '../settings.js';
import { computeGoalProgress } from '../plan/goals.js';

type GoalRow = typeof goals.$inferSelect;
type MilestoneRow = typeof goalMilestones.$inferSelect;

function toMilestoneDTO(m: MilestoneRow): GoalMilestoneDTO {
  return { id: m.id, goalId: m.goalId, title: m.title, done: !!m.done, sortOrder: m.sortOrder, completedAtUtc: m.completedAtUtc };
}

function milestonesFor(db: DB, goalId: string): GoalMilestoneDTO[] {
  return db
    .select()
    .from(goalMilestones)
    .where(eq(goalMilestones.goalId, goalId))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(toMilestoneDTO);
}

function toDTO(db: DB, g: GoalRow, tz: string, milestones?: GoalMilestoneDTO[]): GoalDTO {
  return {
    id: g.id,
    title: g.title,
    description: g.description,
    targetValue: g.targetValue,
    targetUnit: g.targetUnit,
    currentValue: g.currentValue,
    achievable: g.achievable,
    relevance: g.relevance,
    year: g.year,
    quarter: g.quarter,
    customDeadline: g.customDeadline,
    linkKind: g.linkKind as GoalDTO['linkKind'],
    linkValue: g.linkValue,
    status: g.status as GoalDTO['status'],
    createdAtUtc: g.createdAtUtc,
    milestones: milestones ?? milestonesFor(db, g.id),
    ...computeGoalProgress(db, g, tz),
  };
}

function getGoalOr404(db: DB, id: string): GoalRow | undefined {
  return db.select().from(goals).where(eq(goals.id, id)).get();
}

export function registerGoalRoutes(app: FastifyInstance, db: DB) {
  app.get<{ Querystring: { year?: string; quarter?: string } }>('/goals', async (req): Promise<GoalDTO[]> => {
    const tz = getSettings(db).timezone;
    const now = DateTime.now().setZone(tz);
    const year = req.query.year ? Number(req.query.year) : now.year;
    const quarterParam = req.query.quarter;
    const rows =
      quarterParam === 'all'
        ? db.select().from(goals).where(eq(goals.year, year)).all()
        : db
            .select()
            .from(goals)
            .where(and(eq(goals.year, year), eq(goals.quarter, quarterParam ? Number(quarterParam) : now.quarter)))
            .all();

    const goalIds = rows.map((g) => g.id);
    const allMilestones = goalIds.length ? db.select().from(goalMilestones).where(inArray(goalMilestones.goalId, goalIds)).all() : [];
    const byGoal = new Map<string, GoalMilestoneDTO[]>();
    for (const m of allMilestones.sort((a, b) => a.sortOrder - b.sortOrder)) {
      const list = byGoal.get(m.goalId) ?? [];
      list.push(toMilestoneDTO(m));
      byGoal.set(m.goalId, list);
    }

    return rows.map((g) => toDTO(db, g, tz, byGoal.get(g.id) ?? []));
  });

  app.post<{ Body: unknown }>('/goals', async (req, reply) => {
    const parsed = GoalInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const v = parsed.data;
    const id = randomUUID();
    db.insert(goals)
      .values({
        id,
        title: v.title,
        description: v.description,
        targetValue: v.targetValue,
        targetUnit: v.targetUnit,
        achievable: v.achievable,
        relevance: v.relevance,
        year: v.year,
        quarter: v.quarter,
        customDeadline: v.customDeadline,
        linkKind: v.linkKind,
        linkValue: v.linkValue,
        createdAtUtc: new Date().toISOString(),
      })
      .run();
    return toDTO(db, getGoalOr404(db, id)!, getSettings(db).timezone);
  });

  app.patch<{
    Params: { id: string };
    Body: Partial<{
      title: string;
      description: string;
      targetValue: number | null;
      targetUnit: string | null;
      currentValue: number;
      achievable: string;
      relevance: string;
      year: number;
      quarter: number;
      customDeadline: string | null;
      linkKind: 'project' | 'label' | null;
      linkValue: string | null;
      status: 'active' | 'achieved' | 'dropped';
    }>;
  }>('/goals/:id', async (req, reply) => {
    if (!getGoalOr404(db, req.params.id)) return reply.code(404).send({ error: 'not found' });
    db.update(goals).set(req.body).where(eq(goals.id, req.params.id)).run();
    return toDTO(db, getGoalOr404(db, req.params.id)!, getSettings(db).timezone);
  });

  app.delete<{ Params: { id: string } }>('/goals/:id', async (req) => {
    db.delete(goalMilestones).where(eq(goalMilestones.goalId, req.params.id)).run();
    db.delete(goals).where(eq(goals.id, req.params.id)).run();
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/goals/:id/milestones', async (req, reply) => {
    const goal = getGoalOr404(db, req.params.id);
    if (!goal) return reply.code(404).send({ error: 'not found' });
    const parsed = GoalMilestoneInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const existing = milestonesFor(db, goal.id);
    const nextOrder = existing.length ? Math.max(...existing.map((m) => m.sortOrder)) + 1 : 0;
    db.insert(goalMilestones)
      .values({ id: randomUUID(), goalId: goal.id, title: parsed.data.title, sortOrder: nextOrder })
      .run();
    return toDTO(db, goal, getSettings(db).timezone);
  });

  app.patch<{ Params: { id: string; mid: string }; Body: Partial<{ title: string; done: boolean; sortOrder: number }> }>(
    '/goals/:id/milestones/:mid',
    async (req, reply) => {
      const goal = getGoalOr404(db, req.params.id);
      if (!goal) return reply.code(404).send({ error: 'not found' });
      const patch: Partial<{ title: string; done: number; sortOrder: number; completedAtUtc: string | null }> = {};
      if (req.body.title !== undefined) patch.title = req.body.title;
      if (req.body.sortOrder !== undefined) patch.sortOrder = req.body.sortOrder;
      if (req.body.done !== undefined) {
        patch.done = req.body.done ? 1 : 0;
        patch.completedAtUtc = req.body.done ? new Date().toISOString() : null;
      }
      db.update(goalMilestones).set(patch).where(eq(goalMilestones.id, req.params.mid)).run();
      return toDTO(db, goal, getSettings(db).timezone);
    },
  );

  app.delete<{ Params: { id: string; mid: string } }>('/goals/:id/milestones/:mid', async (req, reply) => {
    const goal = getGoalOr404(db, req.params.id);
    if (!goal) return reply.code(404).send({ error: 'not found' });
    db.delete(goalMilestones).where(eq(goalMilestones.id, req.params.mid)).run();
    return toDTO(db, goal, getSettings(db).timezone);
  });

  app.post<{ Params: { id: string }; Body: { ids: string[] } }>('/goals/:id/milestones/reorder', async (req, reply) => {
    const goal = getGoalOr404(db, req.params.id);
    if (!goal) return reply.code(404).send({ error: 'not found' });
    req.body.ids.forEach((mid, index) => {
      db.update(goalMilestones).set({ sortOrder: index }).where(eq(goalMilestones.id, mid)).run();
    });
    return toDTO(db, goal, getSettings(db).timezone);
  });
}
