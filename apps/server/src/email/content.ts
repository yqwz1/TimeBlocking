import { DateTime } from 'luxon';
import type { ScheduleItemDTO, Settings } from '@timeblock/shared';
import { dailyPlans, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { readLocalSchedule } from '../plan/scheduleQuery.js';
import { buildDailySummary } from '../plan/daily.js';

export interface AgendaEmailModel {
  date: string;
  timezone: string;
  schedule: ScheduleItemDTO[];
  unscheduledTasks: Array<{ id: string; title: string; dueDate: string | null; plannedForDate: string | null }>;
}

export interface RecapEmailModel {
  date: string;
  timezone: string;
  blocks: ScheduleItemDTO[];
  completedTasks: Array<{ id: string; title: string }>;
  openTasks: Array<{ id: string; title: string }>;
  summary: ReturnType<typeof buildDailySummary>;
  completionPercentage: number;
  ritual: { highlight: string; highlightDone: boolean; rating: number | null; reflection: string; completed: boolean };
}

function dayWindow(date: string, timezone: string): { from: string; to: string } {
  const start = DateTime.fromISO(date, { zone: timezone }).startOf('day');
  if (!start.isValid) throw new Error(`Invalid local date ${date} for ${timezone}`);
  return { from: start.toUTC().toISO()!, to: start.plus({ days: 1 }).toUTC().toISO()! };
}

function openTask(task: typeof tasks.$inferSelect): boolean {
  return !task.isDeleted && !task.isCompleted && task.status !== 'done' && task.status !== 'cancelled';
}

export function buildAgendaEmailModel(db: DB, settings: Settings, date: string): AgendaEmailModel {
  const { from, to } = dayWindow(date, settings.timezone);
  const schedule = readLocalSchedule(db, from, to, settings.timezone);
  const scheduledTaskIds = new Set(schedule.filter((item) => item.kind === 'task' && item.taskId).map((item) => item.taskId!));
  const unscheduledTasks = db
    .select()
    .from(tasks)
    .all()
    .filter((task) => openTask(task) && (task.plannedForDate === date || task.dueDate === date) && !scheduledTaskIds.has(task.id))
    .sort((a, b) => a.content.localeCompare(b.content))
    .map((task) => ({ id: task.id, title: task.content, dueDate: task.dueDate, plannedForDate: task.plannedForDate }));
  return { date, timezone: settings.timezone, schedule, unscheduledTasks };
}

export function buildRecapEmailModel(db: DB, settings: Settings, date: string): RecapEmailModel {
  const { from, to } = dayWindow(date, settings.timezone);
  const schedule = readLocalSchedule(db, from, to, settings.timezone);
  const blocks = schedule.filter((item) => (item.kind === 'task' || item.kind === 'habit') && !item.isHabitOccurrence);
  const scheduledTaskIds = new Set(blocks.filter((item) => item.taskId).map((item) => item.taskId!));
  const allTasks = db.select().from(tasks).all();
  const completedTasks = allTasks
    .filter((task) => {
      if (task.isDeleted || !task.completedAtUtc) return false;
      return DateTime.fromISO(task.completedAtUtc, { zone: 'utc' }).setZone(settings.timezone).toISODate() === date;
    })
    .sort((a, b) => (a.completedAtUtc ?? '').localeCompare(b.completedAtUtc ?? ''))
    .map((task) => ({ id: task.id, title: task.content }));
  const openTasks = allTasks
    .filter((task) => openTask(task) && (task.plannedForDate === date || task.dueDate === date || scheduledTaskIds.has(task.id)))
    .sort((a, b) => a.content.localeCompare(b.content))
    .map((task) => ({ id: task.id, title: task.content }));
  const summary = buildDailySummary(db, settings.timezone, date);
  const plan = db.select().from(dailyPlans).all().find((row) => row.date === date);
  return {
    date,
    timezone: settings.timezone,
    blocks,
    completedTasks,
    openTasks,
    summary,
    completionPercentage: summary.plannedMin ? Math.round((summary.completedMin / summary.plannedMin) * 100) : 0,
    ritual: {
      highlight: plan?.highlight ?? '',
      highlightDone: !!plan?.highlightDone,
      rating: plan?.rating ?? null,
      reflection: plan?.reflection ?? '',
      completed: !!plan?.shutdownDoneAtUtc,
    },
  };
}
