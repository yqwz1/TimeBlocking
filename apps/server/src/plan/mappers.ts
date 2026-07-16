import { and, eq, inArray } from 'drizzle-orm';
import type {
  AttachmentDTO,
  BlockReason,
  BoardDTO,
  EventDTO,
  ReminderDTO,
  ScheduleItemDTO,
  TaskDTO,
  TaskDifficulty,
  TaskLink,
  TaskRefDTO,
  TaskScheduleView,
  TaskStatus,
  TaskViewDTO,
} from '@timeblock/shared';
import {
  attachments,
  blocks,
  events,
  habitInstances,
  habits,
  projects,
  reminders,
  taskDependencies,
  tasks,
  whiteboards,
} from '../db/schema.js';
import type { DB } from '../db/client.js';
import { hasIncompleteBlocker } from '../tasks/service.js';

type BlockRow = typeof blocks.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type EventRow = typeof events.$inferSelect;
type AttachmentRow = typeof attachments.$inferSelect;
type ReminderRow = typeof reminders.$inferSelect;
type WhiteboardRow = typeof whiteboards.$inferSelect;

function parseLinks(raw: string | null | undefined): TaskLink[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TaskLink[]) : [];
  } catch {
    return [];
  }
}

/** Statuses that count as "live" chunks when computing a task's part-of-N label. */
const CHUNK_COUNT_STATUSES: string[] = ['scheduled', 'pending_create', 'done', 'missed'];

function parseReasons(raw: string | null | undefined): BlockReason[] | undefined {
  if (!raw || raw === '[]') return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? (parsed as BlockReason[]) : undefined;
  } catch {
    return undefined;
  }
}

export function blockToItem(db: DB, b: BlockRow): ScheduleItemDTO {
  const status = b.status as ScheduleItemDTO['status'];
  const reasons = parseReasons(b.reasons);
  if (b.taskId) {
    const t = db.select().from(tasks).where(eq(tasks.id, b.taskId)).get();
    const project = t?.projectId ? db.select().from(projects).where(eq(projects.id, t.projectId)).get() : null;
    const siblings = db
      .select({ chunkIndex: blocks.chunkIndex })
      .from(blocks)
      .where(and(eq(blocks.taskId, b.taskId), inArray(blocks.status, CHUNK_COUNT_STATUSES)))
      .all();
    const count = siblings.length;
    return {
      id: b.id,
      kind: 'task',
      title: t?.content ?? 'Task',
      start: b.startUtc,
      end: b.endUtc,
      status,
      locked: !!b.locked,
      taskId: b.taskId,
      projectName: t?.projectName ?? undefined,
      projectColor: project?.color ?? null,
      color: t?.color ?? null,
      links: t ? parseLinks(t.links) : undefined,
      editable: b.status !== 'done',
      reasons,
      priority: t?.priority,
      difficulty: (t?.difficulty as ScheduleItemDTO['difficulty']) ?? null,
      dueDate: t?.dueDate ?? null,
      ...(count > 1 ? { chunk: { index: b.chunkIndex, count } } : {}),
    };
  }
  const inst = b.habitInstanceId ? db.select().from(habitInstances).where(eq(habitInstances.id, b.habitInstanceId)).get() : null;
  const h = inst ? db.select().from(habits).where(eq(habits.id, inst.habitId)).get() : null;
  return {
    id: b.id,
    kind: 'habit',
    title: h?.name ?? 'Habit',
    start: b.startUtc,
    end: b.endUtc,
    status,
    locked: !!b.locked,
    habitId: inst?.habitId,
    editable: b.status !== 'done',
    reasons,
  };
}

export function eventToDTO(e: EventRow): EventDTO {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    location: e.location,
    meetingUrl: e.meetingUrl,
    color: e.color,
    priority: e.priority,
    difficulty: (e.difficulty as TaskDifficulty | null) ?? null,
    startUtc: e.startUtc,
    endUtc: e.endUtc,
    reminderMinutesBefore: e.reminderMinutesBefore ?? null,
    createdAt: e.createdAtUtc,
    updatedAt: e.updatedAtUtc,
  };
}

export function eventToItem(e: EventRow): ScheduleItemDTO {
  return {
    id: `event:${e.id}`,
    kind: 'event',
    title: e.title,
    start: e.startUtc,
    end: e.endUtc,
    eventId: e.id,
    color: e.color,
    location: e.location || null,
    meetingUrl: e.meetingUrl,
    description: e.description || null,
    priority: e.priority,
    difficulty: (e.difficulty as TaskDifficulty | null) ?? null,
    editable: true,
  };
}

export function taskToView(db: DB, t: TaskRow, view: TaskViewDTO['view'], blockStart: string | null, defaultDurationMin: number): TaskViewDTO {
  return {
    id: t.id,
    content: t.content,
    priority: t.priority,
    dueDate: t.dueDate,
    dueDatetimeUtc: t.dueDatetimeUtc,
    durationMin: t.durationMin ?? defaultDurationMin,
    projectName: t.projectName,
    labels: JSON.parse(t.labels || '[]'),
    links: parseLinks(t.links),
    color: t.color,
    status: t.status as TaskStatus,
    view,
    blockStart,
    isBlocked: hasIncompleteBlocker(db, t.id),
  };
}

/** The two dependency directions for a task's detail panel, as lightweight refs. */
export function dependencyRefs(db: DB, taskId: string): { dependsOn: TaskRefDTO[]; blocks: TaskRefDTO[] } {
  const toRefs = (ids: string[]): TaskRefDTO[] =>
    ids.length
      ? db
          .select({ id: tasks.id, content: tasks.content, status: tasks.status })
          .from(tasks)
          .where(and(inArray(tasks.id, ids), eq(tasks.isDeleted, 0)))
          .all()
          .map((t) => ({ id: t.id, content: t.content, status: t.status as TaskStatus }))
      : [];
  const dependsOnIds = db
    .select({ id: taskDependencies.blockerId })
    .from(taskDependencies)
    .where(eq(taskDependencies.blockedId, taskId))
    .all()
    .map((r) => r.id);
  const blocksIds = db
    .select({ id: taskDependencies.blockedId })
    .from(taskDependencies)
    .where(eq(taskDependencies.blockerId, taskId))
    .all()
    .map((r) => r.id);
  return { dependsOn: toRefs(dependsOnIds), blocks: toRefs(blocksIds) };
}

const LIVE_BLOCK_STATUSES: string[] = ['scheduled', 'pending_create'];

export function taskToDTO(db: DB, t: TaskRow, view: TaskScheduleView | null = null): TaskDTO {
  const project = t.projectId ? db.select().from(projects).where(eq(projects.id, t.projectId)).get() : null;
  const children = db
    .select({ status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.parentId, t.id), eq(tasks.isDeleted, 0)))
    .all();
  const activeBlocks = db
    .select()
    .from(blocks)
    .where(and(eq(blocks.taskId, t.id), inArray(blocks.status, LIVE_BLOCK_STATUSES)))
    .all()
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  const attachmentCount = db.select({ id: attachments.id }).from(attachments).where(eq(attachments.taskId, t.id)).all().length;
  const reminderCount = db.select({ id: reminders.id }).from(reminders).where(eq(reminders.taskId, t.id)).all().length;
  const scheduledMin = activeBlocks.reduce((s, b) => s + Math.round((Date.parse(b.endUtc) - Date.parse(b.startUtc)) / 60_000), 0);

  return {
    id: t.id,
    content: t.content,
    description: t.description,
    projectId: t.projectId,
    projectName: t.projectName,
    projectColor: project?.color ?? null,
    parentId: t.parentId,
    priority: t.priority,
    dueDate: t.dueDate,
    dueDatetimeUtc: t.dueDatetimeUtc,
    durationMin: t.durationMin,
    difficulty: (t.difficulty as TaskDTO['difficulty']) ?? null,
    labels: JSON.parse(t.labels || '[]'),
    links: parseLinks(t.links),
    color: t.color,
    status: t.status as TaskStatus,
    skipScheduling: !!t.skipScheduling,
    forceSchedule: !!t.forceSchedule,
    plannedForDate: t.plannedForDate,
    sortOrder: t.sortOrder,
    createdAt: t.createdAtUtc,
    updatedAt: t.updatedAtUtc,
    completedAt: t.completedAtUtc,
    subtaskCount: children.length,
    subtaskDoneCount: children.filter((c) => c.status === 'done').length,
    attachmentCount,
    reminderCount,
    blockStart: activeBlocks[0]?.startUtc ?? null,
    scheduledMin,
    view,
    isBlocked: hasIncompleteBlocker(db, t.id),
  };
}

export function boardToDTO(b: WhiteboardRow): BoardDTO {
  return {
    id: b.id,
    name: b.name,
    sortOrder: b.sortOrder,
    createdAt: b.createdAtUtc,
    updatedAt: b.updatedAtUtc,
  };
}

export function attachmentToDTO(a: AttachmentRow): AttachmentDTO {
  return {
    id: a.id,
    taskId: a.taskId,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAtUtc,
  };
}

export function reminderToDTO(r: ReminderRow): ReminderDTO {
  return {
    id: r.id,
    taskId: r.taskId,
    remindAtUtc: r.remindAtUtc,
    message: r.message,
    firedAt: r.firedAtUtc,
    createdAt: r.createdAtUtc,
  };
}
