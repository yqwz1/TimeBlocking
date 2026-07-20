import { DateTime } from 'luxon';
import { desc, eq, inArray } from 'drizzle-orm';
import type { PlanWarningDTO, ObjectiveDTO, Settings, TodayPlanDTO } from '@timeblock/shared';
import { blocks, events, objectives, scheduleRuns, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import type { TaskRisk } from '../scheduler/feasibility.js';
import { buildDayWindows } from '../scheduler/slots.js';
import { weekStartOf } from '../scheduler/habits.js';
import { blockToItem, eventToItem, taskToView } from './mappers.js';
import { objectiveToDTO } from './objectives.js';

const LIVE_STATUSES: string[] = ['scheduled', 'pending_create', 'done'];

/** Read the latest plan run's structured risks and turn them into display warnings. */
function latestWarnings(db: DB): { warnings: PlanWarningDTO[]; atRiskTaskIds: string[] } {
  const run = db.select().from(scheduleRuns).orderBy(desc(scheduleRuns.id)).limit(1).get();
  if (!run) return { warnings: [], atRiskTaskIds: [] };
  let risks: TaskRisk[] = [];
  try {
    risks = JSON.parse(run.risks || '[]');
  } catch {
    risks = [];
  }
  const warnings: PlanWarningDTO[] = risks.map((r) => {
    const t = db.select().from(tasks).where(eq(tasks.id, r.taskId)).get();
    return {
      kind: r.kind,
      taskId: r.taskId,
      taskContent: t?.content,
      deadline: r.deadlineUtc,
      shortfallMin: r.shortfallMin,
      date: r.date,
    };
  });
  // Drop warnings whose task has since been completed/deleted.
  const live = warnings.filter((w) => {
    const t = db.select().from(tasks).where(eq(tasks.id, w.taskId)).get();
    return t && !t.isCompleted && !t.isDeleted;
  });
  return { warnings: live, atRiskTaskIds: [...new Set(live.map((w) => w.taskId))] };
}

export function buildTodayPlan(db: DB, settings: Settings): TodayPlanDTO {
  const tz = settings.timezone;
  const now = DateTime.now().setZone(tz);
  const date = now.toISODate()!;
  const dayStartMs = now.startOf('day').toMillis();
  const dayEndMs = now.plus({ days: 1 }).startOf('day').toMillis();
  const tomorrowEndMs = now.plus({ days: 2 }).startOf('day').toMillis();
  const yesterdayStartMs = now.minus({ days: 1 }).startOf('day').toMillis();
  const nowMs = now.toMillis();

  const windows = buildDayWindows(nowMs, tz, 0, settings.workingHours, settings.granularityMin * 60_000);
  const capacityMin = Math.round(windows.reduce((sum, w) => sum + (w.end - w.start), 0) / 60_000);

  const activeToday = db
    .select()
    .from(blocks)
    .where(inArray(blocks.status, LIVE_STATUSES))
    .all()
    .filter((b) => Date.parse(b.startUtc) < dayEndMs && Date.parse(b.endUtc) > dayStartMs);

  const plannedMin = Math.round(
    activeToday.reduce((sum, b) => {
      const start = Math.max(Date.parse(b.startUtc), nowMs);
      const end = Date.parse(b.endUtc);
      return sum + Math.max(0, end - start);
    }, 0) / 60_000,
  );

  const todayBlocks = activeToday.map((b) => blockToItem(db, b));

  // Native calendar events (meetings) live in their own table; merge them in so the
  // Today view's "now / up next" and schedule sections see them, matching /schedule.
  const eventRows = db.select().from(events).all();
  const todayEvents = eventRows
    .filter((e) => Date.parse(e.startUtc) < dayEndMs && Date.parse(e.endUtc) > dayStartMs)
    .map(eventToItem);

  const dueToday = db
    .select()
    .from(tasks)
    .where(eq(tasks.isDeleted, 0))
    .all()
    .filter((t) => t.dueDate === date);
  const dueTodayCount = dueToday.length;
  const dueTodayDoneCount = dueToday.filter((t) => t.isCompleted).length;

  const tomorrowBlocks = db
    .select()
    .from(blocks)
    .where(inArray(blocks.status, LIVE_STATUSES))
    .all()
    .filter((b) => Date.parse(b.startUtc) < tomorrowEndMs && Date.parse(b.endUtc) > dayEndMs)
    .map((b) => blockToItem(db, b));
  const tomorrowEvents = eventRows
    .filter((e) => Date.parse(e.startUtc) < tomorrowEndMs && Date.parse(e.endUtc) > dayEndMs)
    .map(eventToItem);

  const missedBlocks = db.select().from(blocks).where(eq(blocks.status, 'missed')).all();
  const missedYesterday = missedBlocks.filter((b) => Date.parse(b.startUtc) >= yesterdayStartMs && Date.parse(b.startUtc) < dayStartMs);
  const missedTodayBlocks = missedBlocks.filter((b) => Date.parse(b.startUtc) >= dayStartMs && Date.parse(b.startUtc) < dayEndMs);

  const taskViewFromBlock = (b: typeof blocks.$inferSelect) => {
    if (!b.taskId) return null;
    const t = db.select().from(tasks).where(eq(tasks.id, b.taskId)).get();
    if (!t || t.isCompleted || t.isDeleted) return null;
    return taskToView(db, t, 'missed', b.startUtc, settings.defaultDurationMin);
  };

  const week = weekStartOf(date, tz);
  const weekObjectives = db.select().from(objectives).where(eq(objectives.weekStart, week)).all();

  const { warnings, atRiskTaskIds } = latestWarnings(db);
  const atRiskSet = new Set(atRiskTaskIds);
  for (const b of todayBlocks) if (b.taskId && atRiskSet.has(b.taskId)) b.atRisk = true;
  for (const b of tomorrowBlocks) if (b.taskId && atRiskSet.has(b.taskId)) b.atRisk = true;

  // Has the Plan Day ritual been confirmed (applied) today? Drives the morning nudge banner.
  const plannedToday = db
    .select()
    .from(scheduleRuns)
    .where(eq(scheduleRuns.trigger, 'proposal-apply'))
    .all()
    .some((r) => {
      const ranAt = Date.parse(r.ranAtUtc);
      return ranAt >= dayStartMs && ranAt < dayEndMs;
    });

  return {
    date,
    timezone: tz,
    now: now.toUTC().toISO({ suppressMilliseconds: true })!,
    capacityMin,
    plannedMin,
    overloaded: plannedMin > capacityMin,
    dueTodayCount,
    dueTodayDoneCount,
    plannedToday,
    blocks: [...todayBlocks, ...todayEvents],
    missedYesterday: missedYesterday.map(taskViewFromBlock).filter((t): t is NonNullable<typeof t> => !!t),
    missedToday: missedTodayBlocks.map(taskViewFromBlock).filter((t): t is NonNullable<typeof t> => !!t),
    tomorrow: [...tomorrowBlocks, ...tomorrowEvents],
    objectives: weekObjectives.map((o) => objectiveToDTO(db, o, tz)),
    warnings,
    atRiskTaskIds,
  };
}
