import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@timeblock/shared';
import { createDb, type DB } from '../db/client.js';
import { tasks } from '../db/schema.js';
import { isTaskInScope } from './reconciler.js';

function insertTask(db: DB, overrides: Partial<typeof tasks.$inferInsert> = {}) {
  const id = overrides.id ?? randomUUID();
  db.insert(tasks)
    .values({ id, content: 'Task', status: 'todo', ...overrides })
    .run();
  return db.select().from(tasks).where(eq(tasks.id, id)).get()!;
}

describe('isTaskInScope', () => {
  let db: DB;
  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('excludes deleted and skip-scheduling tasks', () => {
    const deleted = insertTask(db, { isDeleted: 1 });
    const skipped = insertTask(db, { skipScheduling: 1 });
    expect(isTaskInScope(deleted, DEFAULT_SETTINGS, false)).toBe(false);
    expect(isTaskInScope(skipped, DEFAULT_SETTINGS, false)).toBe(false);
  });

  it('excludes backlog/done/cancelled; includes todo/in_progress', () => {
    for (const status of ['backlog', 'done', 'cancelled'] as const) {
      const t = insertTask(db, { status, forceSchedule: 1 });
      expect(isTaskInScope(t, DEFAULT_SETTINGS, false)).toBe(false);
    }
    for (const status of ['todo', 'in_progress'] as const) {
      const t = insertTask(db, { status, forceSchedule: 1 });
      expect(isTaskInScope(t, DEFAULT_SETTINGS, false)).toBe(true);
    }
  });

  it('excludes a container task with an open child; includes a leaf', () => {
    const t = insertTask(db, { status: 'todo', forceSchedule: 1 });
    expect(isTaskInScope(t, DEFAULT_SETTINGS, true)).toBe(false);
    expect(isTaskInScope(t, DEFAULT_SETTINGS, false)).toBe(true);
  });

  it('excludes a task with an incomplete blocker; includes it once unblocked', () => {
    const t = insertTask(db, { status: 'todo', forceSchedule: 1 });
    expect(isTaskInScope(t, DEFAULT_SETTINGS, false, true)).toBe(false);
    expect(isTaskInScope(t, DEFAULT_SETTINGS, false, false)).toBe(true);
    expect(isTaskInScope(t, DEFAULT_SETTINGS, false)).toBe(true); // defaults to unblocked
  });

  it('due_only policy requires a due date or forceSchedule', () => {
    const settings = { ...DEFAULT_SETTINGS, schedulePolicy: 'due_only' as const };
    const undated = insertTask(db, { status: 'todo' });
    expect(isTaskInScope(undated, settings, false)).toBe(false);
    const forced = insertTask(db, { status: 'todo', forceSchedule: 1 });
    expect(isTaskInScope(forced, settings, false)).toBe(true);
    const dated = insertTask(db, { status: 'todo', dueDate: '2026-01-01' });
    expect(isTaskInScope(dated, settings, false)).toBe(true);
  });
});
