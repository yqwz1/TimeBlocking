import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { HabitInputSchema, WEEKDAY_KEYS, type HabitDTO } from '@timeblock/shared';
import { habitInstances, habits, blocks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import type { SyncManager } from '../sync/manager.js';
import { getSettings } from '../settings.js';
import { daysToRrule, rruleToDays, weekStartOf } from '../scheduler/habits.js';
import { getAuthedClient } from '../integrations/google/auth.js';
import { Gcal } from '../integrations/google/client.js';
import { nowUtcIso } from '../config.js';
import { recordHabitDone } from '../learning/stats.js';
import { awardBlockDone } from '../gamification/engine.js';

type HabitRow = typeof habits.$inferSelect;
type InstanceRow = typeof habitInstances.$inferSelect;

function computeStreak(instances: InstanceRow[], days: string[], tz: string): number {
  const byDate = new Map(instances.map((i) => [i.date, i.status]));
  const recur = new Set(days);
  let cursor = DateTime.now().setZone(tz).startOf('day');
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const wk = WEEKDAY_KEYS[cursor.weekday - 1];
    if (recur.has(wk)) {
      const status = byDate.get(cursor.toISODate()!);
      if (status === 'done') streak++;
      else if (i > 0) break; // today pending doesn't break the streak
    }
    cursor = cursor.minus({ days: 1 });
  }
  return streak;
}

function todayStatusOf(instances: InstanceRow[], days: string[], today: string, todayWk: string): HabitDTO['todayStatus'] {
  if (!days.includes(todayWk)) return null;
  const status = instances.find((i) => i.date === today)?.status;
  if (status === 'done') return 'done';
  if (status === 'skipped') return 'skipped';
  if (status === 'missed') return 'missed';
  return 'pending';
}

function weekHistoryOf(
  weekInstances: InstanceRow[],
  days: string[],
  weekStart: string,
  today: string,
  tz: string,
  createdAtUtc: string | null,
): HabitDTO['weekHistory'] {
  const byDate = new Map(weekInstances.map((i) => [i.date, i.status]));
  const monday = DateTime.fromISO(weekStart, { zone: tz });
  const createdDate = createdAtUtc ? DateTime.fromISO(createdAtUtc, { zone: 'utc' }).setZone(tz).toISODate() : null;
  return WEEKDAY_KEYS.map((wk, idx) => {
    const date = monday.plus({ days: idx }).toISODate()!;
    // days before the habit existed don't count as missed
    if (!days.includes(wk) || (createdDate && date < createdDate)) return { date, status: 'off' as const };
    const status = byDate.get(date);
    if (status === 'done' || status === 'skipped' || status === 'missed') return { date, status };
    // planned or no record yet — derive from where the day sits relative to today
    if (date < today) return { date, status: 'missed' as const };
    if (date === today) return { date, status: 'pending' as const };
    return { date, status: 'upcoming' as const };
  });
}

function toDTO(db: DB, h: HabitRow, tz: string): HabitDTO {
  const days = rruleToDays(h.rrule);
  const instances = db.select().from(habitInstances).where(eq(habitInstances.habitId, h.id)).all();
  const now = DateTime.now().setZone(tz);
  const today = now.toISODate()!;
  const todayWk = WEEKDAY_KEYS[now.weekday - 1];
  const week = weekStartOf(today, tz);
  const weekInstances = instances.filter((i) => weekStartOf(i.date, tz) === week);
  return {
    id: h.id,
    name: h.name,
    durationMin: h.durationMin,
    days,
    preferredStart: h.preferredStart,
    windowStart: h.windowStart,
    windowEnd: h.windowEnd,
    priority: h.priority,
    kind: h.kind as 'habit' | 'learning',
    weeklyTargetMin: h.weeklyTargetMin,
    notes: h.notes,
    active: !!h.active,
    weekPlannedMin: weekInstances.filter((i) => i.status !== 'skipped').length * h.durationMin,
    weekDoneMin: weekInstances.filter((i) => i.status === 'done').length * h.durationMin,
    streakDays: computeStreak(instances, days, tz),
    todayStatus: todayStatusOf(instances, days, today, todayWk),
    weekHistory: weekHistoryOf(weekInstances, days, week, today, tz, h.createdAtUtc),
  };
}

export function registerHabitRoutes(app: FastifyInstance, db: DB, manager: SyncManager) {
  app.get('/habits', async (): Promise<HabitDTO[]> => {
    const tz = getSettings(db).timezone;
    return db.select().from(habits).all().map((h) => toDTO(db, h, tz));
  });

  app.post<{ Body: unknown }>('/habits', async (req, reply) => {
    const parsed = HabitInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const v = parsed.data;
    const id = randomUUID();
    db.insert(habits)
      .values({
        id,
        name: v.name,
        durationMin: v.durationMin,
        rrule: daysToRrule(v.days),
        preferredStart: v.preferredStart,
        windowStart: v.windowStart,
        windowEnd: v.windowEnd,
        priority: v.priority,
        kind: v.kind,
        weeklyTargetMin: v.weeklyTargetMin,
        notes: v.notes,
        active: v.active ? 1 : 0,
        createdAtUtc: nowUtcIso(),
      })
      .run();
    await manager.forcePlan('habit-created');
    return toDTO(db, db.select().from(habits).where(eq(habits.id, id)).get()!, getSettings(db).timezone);
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/habits/:id', async (req, reply) => {
    const existing = db.select().from(habits).where(eq(habits.id, req.params.id)).get();
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const parsed = HabitInputSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const v = parsed.data;
    db.update(habits)
      .set({
        ...(v.name !== undefined ? { name: v.name } : {}),
        ...(v.durationMin !== undefined ? { durationMin: v.durationMin } : {}),
        ...(v.days !== undefined ? { rrule: daysToRrule(v.days) } : {}),
        ...(v.preferredStart !== undefined ? { preferredStart: v.preferredStart } : {}),
        ...(v.windowStart !== undefined ? { windowStart: v.windowStart } : {}),
        ...(v.windowEnd !== undefined ? { windowEnd: v.windowEnd } : {}),
        ...(v.priority !== undefined ? { priority: v.priority } : {}),
        ...(v.kind !== undefined ? { kind: v.kind } : {}),
        ...(v.weeklyTargetMin !== undefined ? { weeklyTargetMin: v.weeklyTargetMin } : {}),
        ...(v.notes !== undefined ? { notes: v.notes } : {}),
        ...(v.active !== undefined ? { active: v.active ? 1 : 0 } : {}),
      })
      .where(eq(habits.id, req.params.id))
      .run();
    await manager.forcePlan('habit-updated');
    return toDTO(db, db.select().from(habits).where(eq(habits.id, req.params.id)).get()!, getSettings(db).timezone);
  });

  app.delete<{ Params: { id: string } }>('/habits/:id', async (req) => {
    const instanceIds = db
      .select({ id: habitInstances.id })
      .from(habitInstances)
      .where(eq(habitInstances.habitId, req.params.id))
      .all()
      .map((r) => r.id);

    if (instanceIds.length) {
      const affected = db
        .select()
        .from(blocks)
        .where(inArray(blocks.habitInstanceId, instanceIds))
        .all()
        .filter((b) => b.status === 'scheduled' || b.status === 'pending_create');
      const auth = getAuthedClient(db);
      const settings = getSettings(db);
      if (affected.length && auth && settings.appCalendarId) {
        const gcal = new Gcal(auth);
        for (const b of affected) if (b.gcalEventId) await gcal.deleteEvent(settings.appCalendarId, b.gcalEventId);
      }
      for (const b of affected) db.update(blocks).set({ status: 'cancelled', updatedAtUtc: nowUtcIso() }).where(eq(blocks.id, b.id)).run();
    }
    db.delete(habitInstances).where(eq(habitInstances.habitId, req.params.id)).run();
    db.delete(habits).where(eq(habits.id, req.params.id)).run();
    return { ok: true };
  });

  /**
   * Mark today's occurrence of a habit as done. The only write path for
   * habitInstances.status='done' — also flips any scheduled/missed block for
   * today, pushes the calendar update, and records the completion for
   * learning + gamification. Mirrors skip-today's instance-upsert shape.
   */
  app.post<{ Params: { id: string } }>('/habits/:id/complete-today', async (req, reply) => {
    const habit = db.select().from(habits).where(eq(habits.id, req.params.id)).get();
    if (!habit) return reply.code(404).send({ error: 'not found' });
    const settings = getSettings(db);
    const tz = settings.timezone;
    const today = DateTime.now().setZone(tz).toISODate()!;
    const now = nowUtcIso();

    const existing = db
      .select()
      .from(habitInstances)
      .where(eq(habitInstances.habitId, req.params.id))
      .all()
      .find((i) => i.date === today);
    const instanceId = existing?.id ?? randomUUID();
    if (existing) db.update(habitInstances).set({ status: 'done' }).where(eq(habitInstances.id, existing.id)).run();
    else db.insert(habitInstances).values({ id: instanceId, habitId: req.params.id, date: today, status: 'done' }).run();

    const affected = db
      .select()
      .from(blocks)
      .where(eq(blocks.habitInstanceId, instanceId))
      .all()
      .filter((b) => b.status === 'scheduled' || b.status === 'pending_create' || b.status === 'missed');

    const auth = getAuthedClient(db);
    const gcal = auth && settings.appCalendarId ? new Gcal(auth) : null;
    for (const b of affected) {
      if (gcal && settings.appCalendarId && b.gcalEventId) {
        if (settings.onTaskCompleted === 'delete') await gcal.deleteEvent(settings.appCalendarId, b.gcalEventId);
        else await gcal.patchEvent(settings.appCalendarId, b.gcalEventId, { summary: `✅ ${habit.name}` });
      }
      db.update(blocks).set({ status: 'done', updatedAtUtc: now }).where(eq(blocks.id, b.id)).run();
      recordHabitDone(db, settings, { startUtc: b.startUtc, endUtc: b.endUtc }, now);
      awardBlockDone(db, settings, { startUtc: b.startUtc, endUtc: b.endUtc }, 'habit_done', b.id, habit.name, now);
    }
    if (!affected.length) {
      // No calendar block today (e.g. habit not yet scheduled) — still credit the completion.
      awardBlockDone(db, settings, { startUtc: now, endUtc: now }, 'habit_done', instanceId, habit.name, now);
    }

    await manager.forcePlan('habit-complete-today');
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/habits/:id/skip-today', async (req) => {
    const tz = getSettings(db).timezone;
    const today = DateTime.now().setZone(tz).toISODate()!;
    const existing = db
      .select()
      .from(habitInstances)
      .where(eq(habitInstances.habitId, req.params.id))
      .all()
      .find((i) => i.date === today);
    if (existing) db.update(habitInstances).set({ status: 'skipped' }).where(eq(habitInstances.id, existing.id)).run();
    else db.insert(habitInstances).values({ id: randomUUID(), habitId: req.params.id, date: today, status: 'skipped' }).run();
    await manager.forcePlan('habit-skip-today');
    return { ok: true };
  });
}
