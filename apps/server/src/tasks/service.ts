import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { Settings, TaskStatus } from '@timeblock/shared';
import { attachments, labels, reminders, taskDependencies, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { DATA_DIR, nowUtcIso } from '../config.js';
import { applyCompletionToCalendar, applyDeletionToCalendar } from '../sync/reconciler.js';
import type { Gcal } from '../integrations/google/client.js';

const TERMINAL_STATUSES: TaskStatus[] = ['done', 'cancelled'];

/**
 * When a task's block is dragged/scheduled onto a new time, its due date should
 * follow along rather than silently going stale. If the task had a due *time*
 * (dueDatetimeUtc set), that moves to the new start instant too; otherwise only
 * the local due date advances.
 */
export function dueDatePatchForMove(
  tz: string,
  startUtc: string,
  hadDueDatetime: boolean,
): { dueDate: string; dueDatetimeUtc: string | null } {
  const local = DateTime.fromISO(startUtc, { zone: 'utc' }).setZone(tz);
  return {
    dueDate: local.toISODate()!,
    dueDatetimeUtc: hadDueDatetime ? startUtc : null,
  };
}

/** Writes status + the derived isCompleted/completedAtUtc mirror together, in one place. */
export function setTaskStatus(db: DB, id: string, status: TaskStatus, nowIso: string): void {
  const isDone = status === 'done';
  db.update(tasks)
    .set({ status, isCompleted: isDone ? 1 : 0, completedAtUtc: isDone ? nowIso : null, updatedAtUtc: nowIso })
    .where(eq(tasks.id, id))
    .run();
}

/** All descendant task ids (children, grandchildren, ...) of a task, non-deleted. */
export function descendantIds(db: DB, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const parent = stack.pop()!;
    const children = db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.parentId, parent), eq(tasks.isDeleted, 0)))
      .all();
    for (const c of children) {
      out.push(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

/** True when the task has at least one non-deleted, non-terminal child (a container, not a leaf). */
export function hasOpenChildren(db: DB, id: string): boolean {
  return db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.parentId, id), eq(tasks.isDeleted, 0)))
    .all()
    .some((c) => !TERMINAL_STATUSES.includes(c.status as TaskStatus));
}

/**
 * Marks a task (and any open descendants) done, cleans up their calendar events,
 * and awards XP/learning. Returns the ids that were actually transitioned.
 */
export async function completeTask(db: DB, gcal: Gcal | null, settings: Settings, taskId: string): Promise<string[]> {
  const now = nowUtcIso();
  const ids = [taskId, ...descendantIds(db, taskId)];
  const transitioned: string[] = [];
  for (const id of ids) {
    const t = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!t || t.isDeleted || TERMINAL_STATUSES.includes(t.status as TaskStatus)) continue;
    setTaskStatus(db, id, 'done', now);
    transitioned.push(id);
  }
  if (transitioned.length) await applyCompletionToCalendar(db, gcal, settings, transitioned);
  return transitioned;
}

/** Inserts any label names not already in the registry (implicit label creation, like typing a new tag). */
export function ensureLabelsExist(db: DB, names: string[]): void {
  if (!names.length) return;
  const existing = new Set(db.select({ name: labels.name }).from(labels).where(inArray(labels.name, names)).all().map((l) => l.name));
  const now = nowUtcIso();
  for (const name of names) {
    if (existing.has(name)) continue;
    db.insert(labels).values({ id: randomUUID(), name, color: null, createdAtUtc: now }).run();
    existing.add(name);
  }
}

/** Ids of tasks that must finish before `taskId` (raw edges, any status). */
export function blockerIdsOf(db: DB, taskId: string): string[] {
  return db
    .select({ blockerId: taskDependencies.blockerId })
    .from(taskDependencies)
    .where(eq(taskDependencies.blockedId, taskId))
    .all()
    .map((r) => r.blockerId);
}

/** True when at least one blocker task is still open (not done/cancelled, not deleted) — the scheduler must skip this task. */
export function hasIncompleteBlocker(db: DB, taskId: string): boolean {
  const blockerIds = blockerIdsOf(db, taskId);
  if (!blockerIds.length) return false;
  return db
    .select({ id: tasks.id, status: tasks.status, isDeleted: tasks.isDeleted })
    .from(tasks)
    .where(inArray(tasks.id, blockerIds))
    .all()
    .some((b) => !b.isDeleted && !TERMINAL_STATUSES.includes(b.status as TaskStatus));
}

/**
 * True if adding an edge `blockerId -> blockedId` (blockedId depends on blockerId) would
 * create a cycle — i.e. blockerId is already (transitively) waiting on blockedId. Walks
 * forward from blockedId along existing "X blocks Y" edges looking for blockerId.
 */
export function wouldCreateDependencyCycle(db: DB, blockerId: string, blockedId: string): boolean {
  if (blockerId === blockedId) return true;
  const seen = new Set<string>();
  const stack = [blockedId];
  while (stack.length) {
    const cur = stack.pop()!;
    const dependents = db
      .select({ blockedId: taskDependencies.blockedId })
      .from(taskDependencies)
      .where(eq(taskDependencies.blockerId, cur))
      .all()
      .map((r) => r.blockedId);
    for (const next of dependents) {
      if (next === blockerId) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return false;
}

/** True if `candidateAncestorId` is `id` itself or one of its ancestors — used to reject cyclic parentId edits. */
export function isSelfOrAncestor(db: DB, id: string, candidateAncestorId: string): boolean {
  let cur: string | null = candidateAncestorId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === id) return true;
    if (seen.has(cur)) return false; // guard against pre-existing corrupt cycles
    seen.add(cur);
    cur = db.select({ parentId: tasks.parentId }).from(tasks).where(eq(tasks.id, cur)).get()?.parentId ?? null;
  }
  return false;
}

/** Soft-deletes a task and its descendants, cancels their live blocks, and removes attachment files. */
export async function deleteTask(db: DB, gcal: Gcal | null, settings: Settings, taskId: string): Promise<void> {
  const now = nowUtcIso();
  const ids = [taskId, ...descendantIds(db, taskId)];
  db.update(tasks).set({ isDeleted: 1, updatedAtUtc: now }).where(inArray(tasks.id, ids)).run();
  await applyDeletionToCalendar(db, gcal, settings, ids);
  for (const id of ids) {
    db.delete(reminders).where(eq(reminders.taskId, id)).run();
    db.delete(attachments).where(eq(attachments.taskId, id)).run();
    db.delete(taskDependencies).where(or(eq(taskDependencies.blockerId, id), eq(taskDependencies.blockedId, id))).run();
    try {
      fs.rmSync(path.join(DATA_DIR, 'attachments', id), { recursive: true, force: true });
    } catch {
      // best-effort cleanup; missing dir is fine
    }
  }
}
