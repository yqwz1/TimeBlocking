import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import { eq, inArray, like } from 'drizzle-orm';
import {
  achievementsUnlocked,
  blocks,
  dayResults,
  gamificationState,
  habitInstances,
  habits,
  objectives,
  scheduleRuns,
  syncState,
  tasks,
  xpEvents,
} from '../db/schema.js';
import type { DB } from '../db/client.js';
import type { SyncManager } from '../sync/manager.js';
import { getSettings } from '../settings.js';
import { nowUtcIso } from '../config.js';
import { awardXp, xpForBlock } from '../gamification/engine.js';
import { ACHIEVEMENTS } from '../gamification/achievements.js';
import { weekStartOf } from '../scheduler/habits.js';

const MANIFEST_KEY = 'demo_manifest';
const GAMIFICATION_KEYS = ['current_streak', 'longest_streak', 'freezes', 'last_evaluated_date', 'backfill_done'];

interface DemoManifest {
  prevGamification: Record<string, string | null>;
  achievementIds: string[];
  dayResultDates: string[];
  scheduleRunId: number;
}

function readManifest(db: DB): DemoManifest | null {
  const row = db.select().from(syncState).where(eq(syncState.key, MANIFEST_KEY)).get();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as DemoManifest;
  } catch {
    return null;
  }
}

function resetDemoData(db: DB) {
  const manifest = readManifest(db);

  db.delete(blocks).where(like(blocks.id, 'demo-%')).run();
  db.delete(tasks).where(like(tasks.id, 'demo-%')).run();
  db.delete(habitInstances).where(like(habitInstances.id, 'demo-%')).run();
  db.delete(habits).where(like(habits.id, 'demo-%')).run();
  db.delete(objectives).where(like(objectives.id, 'demo-%')).run();
  db.delete(xpEvents).where(like(xpEvents.sourceId, 'demo-%')).run();

  if (manifest) {
    if (manifest.dayResultDates.length) {
      db.delete(dayResults).where(inArray(dayResults.date, manifest.dayResultDates)).run();
    }
    if (manifest.achievementIds.length) {
      db.delete(achievementsUnlocked).where(inArray(achievementsUnlocked.id, manifest.achievementIds)).run();
    }
    if (manifest.scheduleRunId) {
      db.delete(scheduleRuns).where(eq(scheduleRuns.id, manifest.scheduleRunId)).run();
    }
    for (const key of GAMIFICATION_KEYS) {
      const prev = manifest.prevGamification[key];
      if (prev === null || prev === undefined) {
        db.delete(gamificationState).where(eq(gamificationState.key, key)).run();
      } else {
        db.insert(gamificationState)
          .values({ key, value: prev })
          .onConflictDoUpdate({ target: gamificationState.key, set: { value: prev } })
          .run();
      }
    }
  }

  db.delete(syncState).where(eq(syncState.key, MANIFEST_KEY)).run();
}

export function registerDemoRoutes(app: FastifyInstance, db: DB, manager: SyncManager) {
  app.get('/demo/status', async () => {
    const active = !!db.select().from(syncState).where(eq(syncState.key, MANIFEST_KEY)).get();
    return { available: true, active };
  });

  app.post('/demo/reset', async () => {
    resetDemoData(db);
    manager.emit('update', manager.getStatus());
    return { ok: true };
  });

  app.post('/demo/seed', async () => {
    resetDemoData(db);

    const settings = getSettings(db);
    const tz = settings.timezone;
    const nowIso = nowUtcIso();
    const nowMs = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const today = DateTime.now().setZone(tz).toISODate()!;
    const tomorrow = DateTime.now().setZone(tz).plus({ days: 1 });

    // ---------- gamification snapshot (for reversible reset) ----------
    const prevGamification: Record<string, string | null> = {};
    for (const key of GAMIFICATION_KEYS) {
      prevGamification[key] = db.select().from(gamificationState).where(eq(gamificationState.key, key)).get()?.value ?? null;
    }

    // ---------- tasks ----------
    const PROJECT_NAME = 'Product';
    const taskRows = [
      { id: 'demo-task-1', content: 'Draft launch announcement', priority: 4, durationMin: 60, isCompleted: 0, dueDate: today },
      { id: 'demo-task-2', content: 'Review PR queue', priority: 3, durationMin: 45, isCompleted: 0, dueDate: today },
      { id: 'demo-task-3', content: 'Update budget sheet', priority: 2, durationMin: 30, isCompleted: 0, dueDate: today },
      { id: 'demo-task-4', content: 'Write weekly plan', priority: 2, durationMin: 60, isCompleted: 1, dueDate: today },
      { id: 'demo-task-5', content: 'Prep 1:1 notes', priority: 3, durationMin: 30, isCompleted: 0, dueDate: today },
      { id: 'demo-task-6', content: 'Read design spec', priority: 1, durationMin: 45, isCompleted: 0, dueDate: tomorrow.toISODate()! },
    ];
    for (const t of taskRows) {
      db.insert(tasks)
        .values({
          id: t.id,
          content: t.content,
          description: '',
          projectId: 'demo-proj-1',
          projectName: PROJECT_NAME,
          priority: t.priority,
          dueDate: t.dueDate,
          durationMin: t.durationMin,
          labels: '[]',
          url: null,
          isCompleted: t.isCompleted,
          isDeleted: 0,
          createdAtUtc: nowIso,
        })
        .run();
    }

    // ---------- habits ----------
    db.insert(habits)
      .values({
        id: 'demo-habit-1',
        name: 'Morning reading',
        durationMin: 30,
        rrule: 'FREQ=DAILY',
        windowStart: '06:00',
        windowEnd: '10:00',
        priority: 2,
        kind: 'habit',
        active: 1,
        createdAtUtc: nowIso,
      })
      .run();
    db.insert(habits)
      .values({
        id: 'demo-habit-2',
        name: 'Workout',
        durationMin: 45,
        rrule: 'FREQ=DAILY',
        windowStart: '17:00',
        windowEnd: '21:00',
        priority: 2,
        kind: 'habit',
        active: 1,
        createdAtUtc: nowIso,
      })
      .run();

    db.insert(habitInstances).values({ id: 'demo-hi-1', habitId: 'demo-habit-1', date: today, status: 'done' }).run();
    db.insert(habitInstances).values({ id: 'demo-hi-2', habitId: 'demo-habit-2', date: today, status: 'planned' }).run();
    db.insert(habitInstances)
      .values({ id: 'demo-hi-3', habitId: 'demo-habit-1', date: tomorrow.toISODate()!, status: 'planned' })
      .run();

    // ---------- blocks ----------
    const reason = (code: string, label: string) => JSON.stringify([{ code, label }]);
    const blockRows = [
      { id: 'demo-block-habit1', habitInstanceId: 'demo-hi-1', taskId: null, start: nowMs - 3.5 * 3600_000, end: nowMs - 3 * 3600_000, status: 'done', reasons: reason('habit_window', 'Habit window') },
      { id: 'demo-block-task4', habitInstanceId: null, taskId: 'demo-task-4', start: nowMs - 2 * 3600_000, end: nowMs - 1 * 3600_000, status: 'done', reasons: reason('earliest_fit', 'Earliest fit') },
      { id: 'demo-block-task3', habitInstanceId: null, taskId: 'demo-task-3', start: nowMs - 45 * 60_000, end: nowMs - 15 * 60_000, status: 'missed', reasons: reason('earliest_fit', 'Earliest fit') },
      { id: 'demo-block-task1', habitInstanceId: null, taskId: 'demo-task-1', start: nowMs - 15 * 60_000, end: nowMs + 45 * 60_000, status: 'scheduled', reasons: reason('deadline_pressure', 'Deadline pressure') },
      { id: 'demo-block-task2', habitInstanceId: null, taskId: 'demo-task-2', start: nowMs + 2 * 3600_000, end: nowMs + 3 * 3600_000, status: 'scheduled', reasons: reason('earliest_fit', 'Earliest fit') },
      { id: 'demo-block-task5', habitInstanceId: null, taskId: 'demo-task-5', start: nowMs + 4 * 3600_000, end: nowMs + 4.5 * 3600_000, status: 'scheduled', reasons: reason('deadline_pressure', 'Deadline pressure') },
      { id: 'demo-block-habit2', habitInstanceId: 'demo-hi-2', taskId: null, start: nowMs + 6 * 3600_000, end: nowMs + 6.75 * 3600_000, status: 'scheduled', reasons: reason('habit_window', 'Habit window') },
    ];
    for (const b of blockRows) {
      db.insert(blocks)
        .values({
          id: b.id,
          taskId: b.taskId,
          habitInstanceId: b.habitInstanceId,
          startUtc: iso(b.start),
          endUtc: iso(b.end),
          status: b.status,
          locked: 1,
          reasons: b.reasons,
          createdAtUtc: nowIso,
          updatedAtUtc: nowIso,
        })
        .run();
    }

    const tomorrowHabitBlock = tomorrow.set({ hour: 7, minute: 30 });
    const tomorrowTaskBlock = tomorrow.set({ hour: 9, minute: 30 });
    db.insert(blocks)
      .values({
        id: 'demo-block-habit1-tomorrow',
        taskId: null,
        habitInstanceId: 'demo-hi-3',
        startUtc: tomorrowHabitBlock.toUTC().toISO({ suppressMilliseconds: true })!,
        endUtc: tomorrowHabitBlock.plus({ minutes: 30 }).toUTC().toISO({ suppressMilliseconds: true })!,
        status: 'scheduled',
        locked: 1,
        reasons: reason('habit_window', 'Habit window'),
        createdAtUtc: nowIso,
        updatedAtUtc: nowIso,
      })
      .run();
    db.insert(blocks)
      .values({
        id: 'demo-block-task6-tomorrow',
        taskId: 'demo-task-6',
        habitInstanceId: null,
        startUtc: tomorrowTaskBlock.toUTC().toISO({ suppressMilliseconds: true })!,
        endUtc: tomorrowTaskBlock.plus({ minutes: 45 }).toUTC().toISO({ suppressMilliseconds: true })!,
        status: 'scheduled',
        locked: 1,
        reasons: reason('earliest_fit', 'Earliest fit'),
        createdAtUtc: nowIso,
        updatedAtUtc: nowIso,
      })
      .run();

    // ---------- gamification: backfill XP + today's completions + achievements ----------
    const dayResultDates: string[] = [];
    const dayScript: { offset: number; result: 'met' | 'missed' | 'rest' | 'freeze'; streakAfter: number }[] = [
      { offset: -14, result: 'met', streakAfter: 1 },
      { offset: -13, result: 'met', streakAfter: 2 },
      { offset: -12, result: 'freeze', streakAfter: 2 },
      { offset: -11, result: 'met', streakAfter: 3 },
      { offset: -10, result: 'met', streakAfter: 4 },
      { offset: -9, result: 'rest', streakAfter: 4 },
      { offset: -8, result: 'missed', streakAfter: 0 },
      { offset: -7, result: 'rest', streakAfter: 0 },
      { offset: -6, result: 'met', streakAfter: 1 },
      { offset: -5, result: 'met', streakAfter: 2 },
      { offset: -4, result: 'met', streakAfter: 3 },
      { offset: -3, result: 'met', streakAfter: 4 },
      { offset: -2, result: 'met', streakAfter: 5 },
      { offset: -1, result: 'met', streakAfter: 6 },
    ];
    for (const d of dayScript) {
      const date = DateTime.now().setZone(tz).plus({ days: d.offset }).toISODate()!;
      dayResultDates.push(date);
      const counts =
        d.result === 'met'
          ? { doneCount: 2, missedCount: 0, plannedCount: 2 }
          : d.result === 'freeze'
            ? { doneCount: 0, missedCount: 1, plannedCount: 1 }
            : d.result === 'missed'
              ? { doneCount: 0, missedCount: 2, plannedCount: 2 }
              : { doneCount: 0, missedCount: 0, plannedCount: 0 };
      db.insert(dayResults)
        .values({ date, result: d.result, ...counts, streakAfter: d.streakAfter, freezesAfter: 2, decidedAtUtc: nowIso })
        .onConflictDoNothing()
        .run();
      if (d.result === 'met') {
        awardXp(db, settings, { kind: 'backfill', sourceId: `demo-xp-day-${date}`, amount: 45 + (Math.abs(d.offset) % 3) * 5, dateLocal: date }, nowIso);
      }
    }

    // today's two completed blocks
    awardXp(db, settings, { kind: 'habit_done', sourceId: 'demo-block-habit1', amount: xpForBlock(30), dateLocal: today, meta: { title: 'Morning reading' } }, nowIso);
    awardXp(db, settings, { kind: 'block_done', sourceId: 'demo-block-task4', amount: xpForBlock(60), dateLocal: today, meta: { title: 'Write weekly plan' } }, nowIso);

    // achievements (with matching xp ledger rows so totals + unlock state agree)
    const unlockDefs = ['first_block', 'first_habit', 'ten_blocks', 'streak_7'];
    const defsById = new Map(ACHIEVEMENTS.map((d) => [d.id, d]));
    unlockDefs.forEach((id, i) => {
      const def = defsById.get(id)!;
      const unlockedAtDt = DateTime.utc().minus({ days: 13 - i * 2 });
      const unlockedAt = unlockedAtDt.toISO()!;
      const unlockDateLocal = unlockedAtDt.setZone(tz).toISODate()!;
      db.insert(achievementsUnlocked).values({ id, unlockedAtUtc: unlockedAt, xpAwarded: def.xp }).onConflictDoNothing().run();
      awardXp(db, settings, { kind: 'achievement', sourceId: id, amount: def.xp, dateLocal: unlockDateLocal, meta: { achievementId: id, title: def.name } }, unlockedAt);
    });

    // final streak/freeze state (independent of the historical rows above — this is what the HUD reads live)
    for (const [key, value] of Object.entries({ current_streak: '6', longest_streak: '11', freezes: '2', last_evaluated_date: DateTime.now().setZone(tz).minus({ days: 1 }).toISODate()!, backfill_done: '1' })) {
      db.insert(gamificationState).values({ key, value }).onConflictDoUpdate({ target: gamificationState.key, set: { value } }).run();
    }

    // ---------- objectives ----------
    const week = weekStartOf(today, tz);
    db.insert(objectives)
      .values({
        id: 'demo-obj-1',
        weekStart: week,
        title: 'Deep work 5h',
        targetMinutes: 300,
        targetCount: null,
        linkKind: 'project',
        linkValue: 'demo-proj-1',
        status: 'active',
        notes: '',
      })
      .run();
    db.insert(objectives)
      .values({
        id: 'demo-obj-2',
        weekStart: week,
        title: 'Workout 3×',
        targetMinutes: null,
        targetCount: 3,
        linkKind: 'habit',
        linkValue: 'demo-habit-2',
        status: 'active',
        notes: '',
      })
      .run();

    // ---------- schedule run (warnings + at-risk rings) ----------
    const risks = [
      { taskId: 'demo-task-2', kind: 'capacity_shortfall', shortfallMin: 40, date: today },
      { taskId: 'demo-task-5', kind: 'placed_after_deadline', deadlineUtc: iso(nowMs + 2 * 3600_000) },
    ];
    const runResult = db
      .insert(scheduleRuns)
      .values({
        ranAtUtc: nowIso,
        trigger: 'demo',
        created: 0,
        moved: 0,
        deleted: 0,
        atRisk: JSON.stringify(['demo-task-2', 'demo-task-5']),
        unplaceable: '[]',
        risks: JSON.stringify(risks),
        dayLoads: '[]',
      })
      .run();
    const scheduleRunId = Number(runResult.lastInsertRowid);

    // ---------- manifest ----------
    const manifest: DemoManifest = { prevGamification, achievementIds: unlockDefs, dayResultDates, scheduleRunId };
    db.insert(syncState)
      .values({ key: MANIFEST_KEY, value: JSON.stringify(manifest), updatedAtUtc: nowIso })
      .onConflictDoUpdate({ target: syncState.key, set: { value: JSON.stringify(manifest), updatedAtUtc: nowIso } })
      .run();

    manager.emit('update', manager.getStatus());
    return { ok: true };
  });
}
