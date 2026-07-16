import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Settings } from '@timeblock/shared';
import { blocks, habitInstances, habits, objectives, taskDependencies, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { computeObjectiveProgress } from '../plan/objectives.js';
import { weekStartOf } from '../scheduler/habits.js';
import { nowUtcIso } from '../config.js';
import { logSync } from '../log.js';
import { diffBlocks, type BlockOp, type CurrentBlockLite } from '../scheduler/diff.js';
import { plan } from '../scheduler/engine.js';
import { expandChronotype } from '../scheduler/energy.js';
import { loadLearned, recordBlockMissed, recordTaskDone } from '../learning/stats.js';
import { awardBlockDone } from '../gamification/engine.js';
import type { DesiredBlock, PlanHabitInput, PlanInput, PlanResult, PlanTaskInput } from '../scheduler/types.js';
import { blockHash } from './hash.js';
import { APP_TAG, eventIdForBlock, type Gcal, type GEvent } from '../integrations/google/client.js';

export interface RunSummary {
  created: number;
  moved: number;
  deleted: number;
  atRisk: string[];
  unplaceable: string[];
  risks: import('../scheduler/feasibility.js').TaskRisk[];
  dayLoads: import('../scheduler/feasibility.js').DayLoad[];
}

const ACTIVE_BLOCK_STATUSES: string[] = ['scheduled', 'pending_create'];

/**
 * hasOpenChild: true when the task has a non-deleted, non-terminal subtask — containers
 * don't schedule, their leaves do. hasIncompleteBlocker: true when a dependency this task
 * waits on isn't done/cancelled yet — chained tasks don't schedule until unblocked.
 */
export function isTaskInScope(t: typeof tasks.$inferSelect, settings: Settings, hasOpenChild: boolean, hasIncompleteBlocker = false): boolean {
  if (t.isDeleted || t.skipScheduling) return false;
  if (t.status !== 'todo' && t.status !== 'in_progress') return false;
  if (hasOpenChild) return false;
  if (hasIncompleteBlocker) return false;
  if (settings.schedulePolicy === 'due_only' && !t.dueDate && !t.dueDatetimeUtc && !t.forceSchedule && !t.plannedForDate) return false;
  return true;
}

/** Any block fully in the past and not already terminal becomes history ("missed"). Returns true if anything changed. */
export function markElapsedAsMissed(db: DB, settings: Settings, nowIso: string): boolean {
  const now = Date.parse(nowIso);
  const rows = db.select().from(blocks).where(inArray(blocks.status, ['scheduled', 'pending_create'])).all();
  let changed = false;
  for (const b of rows) {
    if (Date.parse(b.endUtc) <= now) {
      db.update(blocks).set({ status: 'missed', updatedAtUtc: nowIso }).where(eq(blocks.id, b.id)).run();
      if (b.habitInstanceId) {
        db.update(habitInstances)
          .set({ status: 'missed' })
          .where(and(eq(habitInstances.id, b.habitInstanceId), eq(habitInstances.status, 'planned')))
          .run();
      }
      recordBlockMissed(db, settings, { id: b.id, taskId: b.taskId, startUtc: b.startUtc, endUtc: b.endUtc }, nowIso);
      changed = true;
    }
  }
  return changed;
}

export function dateOf(iso: string, tz: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz).toISODate()!;
}

export function addMinutesIso(iso: string, min: number): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).plus({ minutes: min }).toISO({ suppressMilliseconds: true })!;
}

function habitIdOfInstance(db: DB, habitInstanceId: string): string | null {
  return db.select().from(habitInstances).where(eq(habitInstances.id, habitInstanceId)).get()?.habitId ?? null;
}

const DAY_FULLNESS_FRACTION: Record<Settings['dayFullness'], number> = {
  light: 0.5,
  balanced: 0.7,
  packed: 0.9,
};

/**
 * Build the pure PlanInput from current DB + external busy state, and the
 * "movable" current-block list diffBlocks needs. Locked / in-progress blocks
 * are frozen out of both (added to `busy` instead) so the planner never
 * touches them. A task whose only recent block was missed stays out of scope
 * unless `allowMissedReplan` is set (poll-cycle setting, or a forced Recalculate).
 */
export function buildPlanInput(
  db: DB,
  settings: Settings,
  nowIso: string,
  externalBusy: { startUtc: string; endUtc: string }[],
  opts: { sticky: boolean; allowMissedReplan: boolean },
): { input: PlanInput; current: CurrentBlockLite[]; fixedTaskIds: Set<string> } {
  const now = Date.parse(nowIso);
  const tz = settings.timezone;

  const activeBlocks = db.select().from(blocks).where(inArray(blocks.status, ACTIVE_BLOCK_STATUSES)).all();

  const fixedBusy: { startUtc: string; endUtc: string }[] = [];
  const current: CurrentBlockLite[] = [];
  const taskHasFixedChunk = new Set<string>(); // task has a locked/in-progress chunk → leave whole task alone
  const movableChunksByTask = new Map<string, { chunkIndex: number; startUtc: string; endUtc: string }[]>();
  const fixedHabitDates = new Map<string, Set<string>>(); // habitId -> local dates with a frozen future block

  for (const b of activeBlocks) {
    const habitId = b.habitInstanceId ? habitIdOfInstance(db, b.habitInstanceId) : null;
    const inProgress = Date.parse(b.startUtc) <= now && Date.parse(b.endUtc) > now;
    const fixed = !!b.locked || inProgress;

    if (fixed) {
      fixedBusy.push({ startUtc: b.startUtc, endUtc: addMinutesIso(b.endUtc, settings.bufferMin) });
      if (b.taskId) taskHasFixedChunk.add(b.taskId);
      if (habitId) {
        if (!fixedHabitDates.has(habitId)) fixedHabitDates.set(habitId, new Set());
        fixedHabitDates.get(habitId)!.add(dateOf(b.startUtc, tz));
      }
      continue;
    }

    const key = b.taskId ? `task:${b.taskId}:${b.chunkIndex}` : `habit:${habitId}:${dateOf(b.startUtc, tz)}`;
    current.push({ id: b.id, key, startUtc: b.startUtc, endUtc: b.endUtc });
    if (b.taskId) {
      if (!movableChunksByTask.has(b.taskId)) movableChunksByTask.set(b.taskId, []);
      movableChunksByTask.get(b.taskId)!.push({ chunkIndex: b.chunkIndex, startUtc: b.startUtc, endUtc: b.endUtc });
    }
  }

  // Tasks whose most recent block lapsed (history row, status='missed').
  const missedTaskIds = new Set(
    db
      .select({ taskId: blocks.taskId })
      .from(blocks)
      .where(eq(blocks.status, 'missed'))
      .all()
      .map((r) => r.taskId)
      .filter((id): id is string => !!id),
  );

  // ---- objective pacing (Phase 6): behind-pace project/label objectives lift matching tasks ----
  const weekStart = weekStartOf(dateOf(nowIso, tz), tz);
  const weekStartMs = DateTime.fromISO(weekStart, { zone: tz }).startOf('day').toMillis();
  const elapsedFraction = Math.min(1, Math.max(0, (now - weekStartMs) / (7 * 86_400_000)));
  const objectivePacing = db
    .select()
    .from(objectives)
    .where(and(eq(objectives.weekStart, weekStart), eq(objectives.status, 'active')))
    .all()
    .filter((o) => o.targetMinutes && (o.linkKind === 'project' || o.linkKind === 'label'))
    .map((o) => {
      const progress = computeObjectiveProgress(db, o, tz);
      const committed = progress.progressMinutes + progress.plannedMinutes;
      const expected = (o.targetMinutes ?? 0) * elapsedFraction;
      const behind = Math.min(1, Math.max(0, (expected - committed) / (o.targetMinutes || 1)));
      return { linkKind: o.linkKind as 'project' | 'label', linkValue: o.linkValue!, behind };
    })
    .filter((o) => o.behind > 0);

  const objectiveBoostFor = (projectId: string | null, labels: string[]): number => {
    let boost = 0;
    for (const o of objectivePacing) {
      const matches = o.linkKind === 'project' ? projectId === o.linkValue : labels.includes(o.linkValue);
      if (matches && o.behind > boost) boost = o.behind;
    }
    return boost;
  };

  // ---- tasks ----
  const allTasks = db.select().from(tasks).all();
  const openChildParents = new Set<string>();
  for (const t of allTasks) {
    if (t.parentId && !t.isDeleted && t.status !== 'done' && t.status !== 'cancelled') {
      openChildParents.add(t.parentId);
    }
  }
  // Chained tasks: a task waiting on an incomplete blocker doesn't schedule until unblocked.
  const taskById = new Map(allTasks.map((t) => [t.id, t]));
  const blockedTaskIds = new Set<string>();
  for (const d of db.select().from(taskDependencies).all()) {
    if (blockedTaskIds.has(d.blockedId)) continue;
    const blocker = taskById.get(d.blockerId);
    if (blocker && !blocker.isDeleted && blocker.status !== 'done' && blocker.status !== 'cancelled') {
      blockedTaskIds.add(d.blockedId);
    }
  }
  const planTasks: PlanTaskInput[] = [];
  for (const t of allTasks) {
    if (!isTaskInScope(t, settings, openChildParents.has(t.id), blockedTaskIds.has(t.id))) continue;
    if (taskHasFixedChunk.has(t.id)) continue; // any locked/in-progress chunk: leave the whole task alone
    const movableChunks = movableChunksByTask.get(t.id) ?? [];
    if (!movableChunks.length && missedTaskIds.has(t.id) && !opts.allowMissedReplan) continue; // missed, replanning disabled
    const labels: string[] = JSON.parse(t.labels || '[]');
    planTasks.push({
      id: t.id,
      priority: t.priority,
      dueDate: t.dueDate,
      dueDatetimeUtc: t.dueDatetimeUtc,
      plannedForDate: t.plannedForDate,
      durationMin: t.durationMin ?? settings.defaultDurationMin,
      difficulty: (t.difficulty as PlanTaskInput['difficulty']) ?? null,
      createdAtUtc: t.createdAtUtc,
      labels,
      projectId: t.projectId,
      objectiveBoost: objectiveBoostFor(t.projectId, labels),
      currentChunks: movableChunks,
    });
  }

  // ---- habits ----
  const allHabits = db.select().from(habits).where(eq(habits.active, 1)).all();
  const doneOrSkipped = db
    .select()
    .from(habitInstances)
    .where(inArray(habitInstances.status, ['done', 'skipped']))
    .all();
  const doneByHabit = new Map<string, typeof doneOrSkipped>();
  for (const i of doneOrSkipped) {
    if (!doneByHabit.has(i.habitId)) doneByHabit.set(i.habitId, []);
    doneByHabit.get(i.habitId)!.push(i);
  }
  const doneInstances = doneOrSkipped.filter((i) => i.status === 'done');

  const planHabits: PlanHabitInput[] = allHabits.map((h) => {
    const excluded = new Set<string>((doneByHabit.get(h.id) ?? []).map((i) => i.date));
    for (const d of fixedHabitDates.get(h.id) ?? []) excluded.add(d);
    const creditMin: Record<string, number> = {};
    for (const i of doneInstances.filter((x) => x.habitId === h.id)) {
      const wk = DateTime.fromISO(i.date, { zone: tz }).startOf('week').toISODate()!;
      creditMin[wk] = (creditMin[wk] ?? 0) + h.durationMin;
    }
    return {
      id: h.id,
      name: h.name,
      durationMin: h.durationMin,
      rrule: h.rrule,
      preferredStart: h.preferredStart,
      windowStart: h.windowStart,
      windowEnd: h.windowEnd,
      priority: h.priority,
      kind: h.kind as 'habit' | 'learning',
      weeklyTargetMin: h.weeklyTargetMin,
      excludedDates: [...excluded],
      creditMin,
    };
  });

  const busy = [...externalBusy, ...fixedBusy];

  return {
    input: {
      nowUtc: nowIso,
      timezone: tz,
      horizonDays: settings.horizonDays,
      granularityMin: settings.granularityMin,
      bufferMin: settings.bufferMin,
      splitEnabled: settings.splitEnabled,
      maxChunkMin: settings.maxChunkMin,
      minChunkMin: settings.minChunkMin,
      chunkGapPolicy: settings.chunkGapPolicy,
      energy: {
        mode: settings.energyMode,
        windows: settings.energyMode === 'chronotype' ? expandChronotype(settings.chronotype) : settings.energyWindows,
        deepWorkMinMin: settings.deepWorkMinMin,
        deepLabel: settings.deepLabel,
        shallowLabel: settings.shallowLabel,
      },
      learned: loadLearned(db, settings),
      workingHours: settings.workingHours,
      busy,
      tasks: planTasks,
      habits: planHabits,
      sticky: opts.sticky,
      dayBudget: { maxTaskFraction: DAY_FULLNESS_FRACTION[settings.dayFullness] },
    },
    current,
    fixedTaskIds: taskHasFixedChunk,
  };
}

export function titleFor(db: DB, d: DesiredBlock): string {
  if (d.taskId) {
    const t = db.select().from(tasks).where(eq(tasks.id, d.taskId)).get();
    return t?.content ?? 'Task';
  }
  return d.habitName ?? 'Habit';
}

function eventFor(db: DB, d: DesiredBlock, blockId: string, tz: string): GEvent {
  return {
    summary: titleFor(db, d),
    start: { dateTime: d.startUtc, timeZone: tz },
    end: { dateTime: d.endUtc, timeZone: tz },
    extendedProperties: {
      private: {
        app: APP_TAG,
        blockId,
        ...(d.taskId ? { taskId: d.taskId } : {}),
        ...(d.habitId ? { habitId: d.habitId } : {}),
      },
    },
  };
}

function ensureHabitInstance(db: DB, habitId: string, date: string): string {
  const existing = db
    .select()
    .from(habitInstances)
    .where(and(eq(habitInstances.habitId, habitId), eq(habitInstances.date, date)))
    .get();
  if (existing) return existing.id;
  const id = randomUUID();
  db.insert(habitInstances).values({ id, habitId, date, status: 'planned' }).run();
  return id;
}

/** Apply the minimal diff to Google Calendar + DB. Returns write counts. */
export async function applyOps(
  db: DB,
  gcal: Gcal,
  calendarId: string,
  tz: string,
  ops: BlockOp[],
): Promise<{ created: number; moved: number; deleted: number }> {
  let created = 0;
  let moved = 0;
  let deleted = 0;
  const now = nowUtcIso();

  for (const op of ops) {
    if (op.type === 'create') {
      const blockId = randomUUID();
      const habitInstanceId =
        op.desired.habitId && op.desired.date ? ensureHabitInstance(db, op.desired.habitId, op.desired.date) : null;
      db.insert(blocks)
        .values({
          id: blockId,
          taskId: op.desired.taskId ?? null,
          habitInstanceId,
          calendarId,
          startUtc: op.desired.startUtc,
          endUtc: op.desired.endUtc,
          status: 'pending_create',
          reasons: JSON.stringify(op.desired.reasons),
          chunkIndex: op.desired.chunk?.index ?? 0,
          createdAtUtc: now,
          updatedAtUtc: now,
        })
        .run();
      const eventId = eventIdForBlock(blockId);
      await gcal.insertEvent(calendarId, { id: eventId, ...eventFor(db, op.desired, blockId, tz) });
      db.update(blocks)
        .set({
          status: 'scheduled',
          gcalEventId: eventId,
          lastPushedHash: blockHash(op.desired.startUtc, op.desired.endUtc),
          updatedAtUtc: now,
        })
        .where(eq(blocks.id, blockId))
        .run();
      created++;
    } else if (op.type === 'move') {
      const row = db.select().from(blocks).where(eq(blocks.id, op.blockId)).get();
      if (!row) continue;
      const hash = blockHash(op.desired.startUtc, op.desired.endUtc);
      if (row.gcalEventId) {
        await gcal.patchEvent(calendarId, row.gcalEventId, {
          start: { dateTime: op.desired.startUtc, timeZone: tz },
          end: { dateTime: op.desired.endUtc, timeZone: tz },
        });
      } else {
        const eventId = eventIdForBlock(row.id);
        await gcal.insertEvent(calendarId, { id: eventId, ...eventFor(db, op.desired, row.id, tz) });
        db.update(blocks).set({ gcalEventId: eventId }).where(eq(blocks.id, row.id)).run();
      }
      db.update(blocks)
        .set({
          startUtc: op.desired.startUtc,
          endUtc: op.desired.endUtc,
          status: 'scheduled',
          reasons: JSON.stringify(op.desired.reasons),
          chunkIndex: op.desired.chunk?.index ?? row.chunkIndex,
          lastPushedHash: hash,
          updatedAtUtc: now,
        })
        .where(eq(blocks.id, row.id))
        .run();
      moved++;
    } else if (op.type === 'delete') {
      const row = db.select().from(blocks).where(eq(blocks.id, op.blockId)).get();
      if (!row) continue;
      if (row.gcalEventId) await gcal.deleteEvent(calendarId, row.gcalEventId);
      db.update(blocks).set({ status: 'cancelled', updatedAtUtc: now }).where(eq(blocks.id, row.id)).run();
      deleted++;
    }
  }
  return { created, moved, deleted };
}

/**
 * Refresh the "why this slot" reasons on blocks that produced no calendar op
 * (same key, unchanged times). DB-only — never touches Google, so it stays
 * inside the rate-limit guard. Keeps explanations current as deadlines/energy
 * shift even when the placement itself doesn't move.
 */
export function persistAnnotations(db: DB, desired: DesiredBlock[], current: CurrentBlockLite[], nowIso: string): void {
  const currentByKey = new Map(current.map((c) => [c.key, c]));
  for (const d of desired) {
    const c = currentByKey.get(d.key);
    if (!c || c.startUtc !== d.startUtc || c.endUtc !== d.endUtc) continue; // created/moved rows already carry fresh reasons
    const json = JSON.stringify(d.reasons);
    db.update(blocks)
      .set({ reasons: json, chunkIndex: d.chunk?.index ?? 0, updatedAtUtc: nowIso })
      .where(and(eq(blocks.id, c.id), ne(blocks.reasons, json)))
      .run();
  }
}

export interface PlanOnlyResult {
  input: PlanInput;
  current: CurrentBlockLite[];
  result: PlanResult;
  ops: BlockOp[];
}

/**
 * Run the pure planner + diff without writing anything. Shared by the
 * auto-apply path (planAndApply) and the propose/review path (sync/proposals.ts).
 */
export function planOnly(
  db: DB,
  settings: Settings,
  nowIso: string,
  externalBusy: { startUtc: string; endUtc: string }[],
  opts: { sticky: boolean; allowMissedReplan: boolean },
): PlanOnlyResult {
  const { input, current } = buildPlanInput(db, settings, nowIso, externalBusy, opts);
  const result = plan(input);
  const ops = diffBlocks(current, result.blocks);
  return { input, current, result, ops };
}

/** One full plan+apply pass. Returns null when the app calendar isn't set up yet. */
export async function planAndApply(
  db: DB,
  gcal: Gcal,
  settings: Settings,
  externalBusy: { startUtc: string; endUtc: string }[],
  nowIso: string,
  sticky: boolean,
  allowMissedReplan: boolean,
): Promise<RunSummary | null> {
  if (!settings.appCalendarId) return null;
  const { current, result, ops } = planOnly(db, settings, nowIso, externalBusy, { sticky, allowMissedReplan });
  const { created, moved, deleted } = await applyOps(db, gcal, settings.appCalendarId, settings.timezone, ops);
  persistAnnotations(db, result.blocks, current, nowIso);
  if (created || moved || deleted) {
    logSync(db, 'scheduler', 'info', `plan applied: +${created} ~${moved} -${deleted}`);
  }
  if (result.atRisk.length) logSync(db, 'scheduler', 'conflict', `at-risk: ${result.atRisk.join(', ')}`);
  if (result.unplaceable.length) logSync(db, 'scheduler', 'conflict', `unplaceable: ${result.unplaceable.join(', ')}`);
  return {
    created,
    moved,
    deleted,
    atRisk: result.atRisk,
    unplaceable: result.unplaceable,
    risks: result.risks,
    dayLoads: result.dayLoads,
  };
}

/**
 * Task(s) completed (locally): rename or delete each live calendar event per settings,
 * mark blocks done, and award XP/learning. `gcal` may be null (no Google auth / no app
 * calendar yet) — the DB-side effects (block status, XP, learning) still happen.
 */
export async function applyCompletionToCalendar(db: DB, gcal: Gcal | null, settings: Settings, taskIds: string[]): Promise<void> {
  if (!taskIds.length) return;
  const canPush = !!(gcal && settings.appCalendarId);
  for (const taskId of taskIds) {
    const rows = db
      .select()
      .from(blocks)
      .where(and(eq(blocks.taskId, taskId), inArray(blocks.status, ['scheduled', 'pending_create'])))
      .all();
    if (rows.length) {
      const t = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
      for (const row of rows) {
        if (canPush) {
          if (settings.onTaskCompleted === 'delete') {
            if (row.gcalEventId) await gcal!.deleteEvent(settings.appCalendarId!, row.gcalEventId);
          } else if (row.gcalEventId) {
            await gcal!.patchEvent(settings.appCalendarId!, row.gcalEventId, { summary: `✅ ${t?.content ?? ''}` });
          }
        }
        db.update(blocks).set({ status: 'done', updatedAtUtc: nowUtcIso() }).where(eq(blocks.id, row.id)).run();
        awardBlockDone(db, settings, row, 'block_done', row.id, t?.content ?? 'Task', nowUtcIso());
      }
    }
    recordTaskDone(db, settings, taskId, nowUtcIso());
  }
}

/** Task(s) deleted (locally): cancel any live calendar event. `gcal` may be null. */
export async function applyDeletionToCalendar(db: DB, gcal: Gcal | null, settings: Settings, taskIds: string[]): Promise<void> {
  if (!taskIds.length) return;
  const canPush = !!(gcal && settings.appCalendarId);
  const eventIdsToDelete: string[] = [];
  for (const taskId of taskIds) {
    const rows = db
      .select()
      .from(blocks)
      .where(and(eq(blocks.taskId, taskId), inArray(blocks.status, ['scheduled', 'pending_create'])))
      .all();
    for (const row of rows) {
      if (canPush && row.gcalEventId) eventIdsToDelete.push(row.gcalEventId);
      db.update(blocks).set({ status: 'cancelled', updatedAtUtc: nowUtcIso() }).where(eq(blocks.id, row.id)).run();
    }
  }
  // Cancel locally first (fast, synchronous), then push deletes to Google in the
  // background — callers on the request path shouldn't block on a live API round-trip.
  if (canPush) {
    for (const eventId of eventIdsToDelete) {
      void gcal!.deleteEvent(settings.appCalendarId!, eventId).catch((err) => console.error('failed to delete Gcal event', eventId, err));
    }
  }
}
