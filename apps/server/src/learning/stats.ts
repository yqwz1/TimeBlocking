import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { and, eq, like } from 'drizzle-orm';
import type { Settings } from '@timeblock/shared';
import { blockOutcomes, blocks, learnedStats, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import type { PlanLearned } from '../scheduler/types.js';

const DUR_ALPHA_GLOBAL = 0.1;
const DUR_ALPHA_PROJECT = 0.2;
const HOUR_BETA = 0.15;
const DUR_PRIOR = 1.0;
const HOUR_PRIOR = 0.5;

/** One EWMA step: value moves toward the sample by α, weight is a decayed count. */
export function ewmaStep(prev: { value: number; weight: number }, sample: number, alpha: number, prior: number): { value: number; weight: number } {
  const base = prev.weight === 0 ? prior : prev.value;
  return { value: (1 - alpha) * base + alpha * sample, weight: prev.weight * (1 - alpha) + 1 };
}

export function durationRatio(estimatedMin: number, plannedMin: number, overrunMin: number): number {
  if (estimatedMin <= 0) return 1;
  const r = (plannedMin + overrunMin) / estimatedMin;
  return Math.min(3.0, Math.max(0.33, r));
}

// ---------- persistence ----------

function getStat(db: DB, scope: string, key: string, prior: number): { value: number; weight: number } {
  const row = db.select().from(learnedStats).where(and(eq(learnedStats.scope, scope), eq(learnedStats.key, key))).get();
  return row ? { value: row.value, weight: row.weight } : { value: prior, weight: 0 };
}

function putStat(db: DB, scope: string, key: string, next: { value: number; weight: number }, nowIso: string) {
  db.insert(learnedStats)
    .values({ scope, key, value: next.value, weight: next.weight, updatedAtUtc: nowIso })
    .onConflictDoUpdate({
      target: [learnedStats.scope, learnedStats.key],
      set: { value: next.value, weight: next.weight, updatedAtUtc: nowIso },
    })
    .run();
}

function bumpDuration(db: DB, scope: string, ratio: number, alpha: number, nowIso: string) {
  putStat(db, scope, 'duration_multiplier', ewmaStep(getStat(db, scope, 'duration_multiplier', DUR_PRIOR), ratio, alpha, DUR_PRIOR), nowIso);
}

function bumpHour(db: DB, hour: number, hit: number, nowIso: string) {
  const key = `hour_success:${hour}`;
  putStat(db, 'global', key, ewmaStep(getStat(db, 'global', key, HOUR_PRIOR), hit, HOUR_BETA, HOUR_PRIOR), nowIso);
}

/**
 * Record that all of a task's blocks completed: calibrate its duration multiplier
 * (global + per-project) from planned-vs-actual, and credit the hour-of-day success.
 */
export function recordTaskDone(db: DB, settings: Settings, taskId: string, nowIso: string) {
  if (!settings.learningEnabled) return;
  const t = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!t) return;
  const taskBlocks = db.select().from(blocks).where(eq(blocks.taskId, taskId)).all().filter((b) => b.status === 'done' || b.status === 'scheduled' || b.status === 'pending_create');
  if (!taskBlocks.length) return;
  const tz = settings.timezone;
  const now = Date.parse(nowIso);

  const plannedMin = Math.round(taskBlocks.reduce((s, b) => s + (Date.parse(b.endUtc) - Date.parse(b.startUtc)), 0) / 60_000);
  const lastEnd = Math.max(...taskBlocks.map((b) => Date.parse(b.endUtc)));
  const overrunMin = Math.min(180, Math.max(0, Math.round((now - lastEnd) / 60_000)));
  const estimatedMin = t.durationMin ?? settings.defaultDurationMin;
  const ratio = durationRatio(estimatedMin, plannedMin, overrunMin);

  bumpDuration(db, 'global', ratio, DUR_ALPHA_GLOBAL, nowIso);
  if (t.projectId) bumpDuration(db, `project:${t.projectId}`, ratio, DUR_ALPHA_PROJECT, nowIso);

  const first = taskBlocks.slice().sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))[0];
  const startLocal = DateTime.fromISO(first.startUtc, { zone: 'utc' }).setZone(tz);
  bumpHour(db, startLocal.hour, 1, nowIso);

  db.insert(blockOutcomes)
    .values({
      id: randomUUID(),
      kind: 'task',
      taskId,
      projectId: t.projectId,
      outcome: 'done',
      estimatedMin,
      plannedMin,
      overrunMin,
      hourLocal: startLocal.hour,
      dowLocal: startLocal.weekday,
      recordedAtUtc: nowIso,
    })
    .run();
}

/** Record that a habit instance was completed: a positive hour-of-day signal (no duration calibration — habits have a fixed duration). */
export function recordHabitDone(db: DB, settings: Settings, block: { startUtc: string; endUtc: string }, nowIso: string) {
  if (!settings.learningEnabled) return;
  const tz = settings.timezone;
  const startLocal = DateTime.fromISO(block.startUtc, { zone: 'utc' }).setZone(tz);
  bumpHour(db, startLocal.hour, 1, nowIso);
  db.insert(blockOutcomes)
    .values({
      id: randomUUID(),
      kind: 'habit',
      taskId: null,
      projectId: null,
      outcome: 'done',
      estimatedMin: null,
      plannedMin: Math.round((Date.parse(block.endUtc) - Date.parse(block.startUtc)) / 60_000),
      overrunMin: 0,
      hourLocal: startLocal.hour,
      dowLocal: startLocal.weekday,
      recordedAtUtc: nowIso,
    })
    .run();
}

/** Record that a block lapsed unattended: a negative hour-of-day signal (no duration change). */
export function recordBlockMissed(db: DB, settings: Settings, block: { id: string; taskId: string | null; startUtc: string; endUtc: string }, nowIso: string) {
  if (!settings.learningEnabled) return;
  const tz = settings.timezone;
  const startLocal = DateTime.fromISO(block.startUtc, { zone: 'utc' }).setZone(tz);
  bumpHour(db, startLocal.hour, 0, nowIso);
  const projectId = block.taskId ? db.select().from(tasks).where(eq(tasks.id, block.taskId)).get()?.projectId ?? null : null;
  db.insert(blockOutcomes)
    .values({
      id: randomUUID(),
      kind: block.taskId ? 'task' : 'habit',
      taskId: block.taskId,
      projectId,
      outcome: 'missed',
      estimatedMin: null,
      plannedMin: Math.round((Date.parse(block.endUtc) - Date.parse(block.startUtc)) / 60_000),
      overrunMin: 0,
      hourLocal: startLocal.hour,
      dowLocal: startLocal.weekday,
      recordedAtUtc: nowIso,
    })
    .run();
}

// ---------- read side (for the planner) ----------

export function loadLearned(db: DB, settings: Settings): PlanLearned {
  if (!settings.learningEnabled) {
    return {
      enabled: false,
      multipliers: { global: { value: 1, weight: 0 }, byProject: {} },
      hourSuccess: { rates: Array(24).fill(HOUR_PRIOR), totalWeight: 0 },
    };
  }
  const rows = db.select().from(learnedStats).all();
  const global = { value: 1, weight: 0 };
  const byProject: Record<string, { value: number; weight: number }> = {};
  const rates = Array(24).fill(HOUR_PRIOR) as number[];
  let hourWeight = 0;
  for (const r of rows) {
    if (r.key === 'duration_multiplier') {
      if (r.scope === 'global') { global.value = r.value; global.weight = r.weight; }
      else if (r.scope.startsWith('project:')) byProject[r.scope.slice('project:'.length)] = { value: r.value, weight: r.weight };
    } else if (r.key.startsWith('hour_success:')) {
      const h = Number(r.key.slice('hour_success:'.length));
      if (h >= 0 && h < 24) { rates[h] = r.value; hourWeight += r.weight; }
    }
  }
  return { enabled: true, multipliers: { global, byProject }, hourSuccess: { rates, totalWeight: hourWeight } };
}

/** Wipe learned aggregates (keeps the raw outcome history). */
export function resetLearnedStats(db: DB) {
  db.delete(learnedStats).where(like(learnedStats.scope, '%')).run();
}
