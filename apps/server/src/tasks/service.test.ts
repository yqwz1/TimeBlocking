import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@timeblock/shared';
import { createDb, type DB } from '../db/client.js';
import { blocks, labels, taskDependencies, tasks } from '../db/schema.js';
import {
  blockerIdsOf,
  completeTask,
  deleteTask,
  descendantIds,
  dueDatePatchForMove,
  ensureLabelsExist,
  hasIncompleteBlocker,
  hasOpenChildren,
  isSelfOrAncestor,
  setTaskStatus,
  wouldCreateDependencyCycle,
} from './service.js';

function addDependency(db: DB, blockerId: string, blockedId: string) {
  db.insert(taskDependencies).values({ id: randomUUID(), blockerId, blockedId, createdAtUtc: '2026-01-01T00:00:00Z' }).run();
}

function insertTask(db: DB, overrides: Partial<typeof tasks.$inferInsert> = {}) {
  const id = overrides.id ?? randomUUID();
  db.insert(tasks)
    .values({ id, content: 'Task', status: 'todo', createdAtUtc: '2026-01-01T00:00:00Z', ...overrides })
    .run();
  return id;
}

describe('tasks/service', () => {
  let db: DB;
  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('setTaskStatus mirrors isCompleted/completedAtUtc together', () => {
    const id = insertTask(db);
    setTaskStatus(db, id, 'done', '2026-01-02T00:00:00Z');
    const done = db.select().from(tasks).where(eq(tasks.id, id)).get()!;
    expect(done.status).toBe('done');
    expect(done.isCompleted).toBe(1);
    expect(done.completedAtUtc).toBe('2026-01-02T00:00:00Z');

    setTaskStatus(db, id, 'todo', '2026-01-03T00:00:00Z');
    const reopened = db.select().from(tasks).where(eq(tasks.id, id)).get()!;
    expect(reopened.status).toBe('todo');
    expect(reopened.isCompleted).toBe(0);
    expect(reopened.completedAtUtc).toBeNull();
  });

  it('descendantIds walks arbitrary depth (sub-subtasks)', () => {
    const root = insertTask(db);
    const child = insertTask(db, { parentId: root });
    const grandchild = insertTask(db, { parentId: child });
    expect(new Set(descendantIds(db, root))).toEqual(new Set([child, grandchild]));
    expect(descendantIds(db, grandchild)).toEqual([]);
  });

  it('hasOpenChildren flips false once the only child closes', () => {
    const root = insertTask(db);
    expect(hasOpenChildren(db, root)).toBe(false);
    const child = insertTask(db, { parentId: root, status: 'todo' });
    expect(hasOpenChildren(db, root)).toBe(true);
    setTaskStatus(db, child, 'done', '2026-01-01T00:00:00Z');
    expect(hasOpenChildren(db, root)).toBe(false);
  });

  it('completeTask cascades to open descendants and leaves terminal ones alone', async () => {
    const root = insertTask(db);
    const openChild = insertTask(db, { parentId: root, status: 'todo' });
    const cancelledChild = insertTask(db, { parentId: root, status: 'cancelled' });
    const transitioned = await completeTask(db, null, DEFAULT_SETTINGS, root);
    expect(new Set(transitioned)).toEqual(new Set([root, openChild]));
    expect(db.select().from(tasks).where(eq(tasks.id, root)).get()!.status).toBe('done');
    expect(db.select().from(tasks).where(eq(tasks.id, openChild)).get()!.status).toBe('done');
    expect(db.select().from(tasks).where(eq(tasks.id, cancelledChild)).get()!.status).toBe('cancelled');
  });

  it('deleteTask soft-deletes the task + descendants and cancels live blocks', async () => {
    const root = insertTask(db);
    const child = insertTask(db, { parentId: root });
    const blockId = randomUUID();
    db.insert(blocks)
      .values({
        id: blockId,
        taskId: child,
        startUtc: '2026-01-01T00:00:00Z',
        endUtc: '2026-01-01T01:00:00Z',
        status: 'scheduled',
        createdAtUtc: '2026-01-01T00:00:00Z',
      })
      .run();
    await deleteTask(db, null, DEFAULT_SETTINGS, root);
    expect(db.select().from(tasks).where(eq(tasks.id, root)).get()!.isDeleted).toBe(1);
    expect(db.select().from(tasks).where(eq(tasks.id, child)).get()!.isDeleted).toBe(1);
    expect(db.select().from(blocks).where(eq(blocks.id, blockId)).get()!.status).toBe('cancelled');
  });

  it('ensureLabelsExist only inserts names that are missing', () => {
    ensureLabelsExist(db, ['work', 'home']);
    ensureLabelsExist(db, ['work', 'gym']);
    const names = db
      .select()
      .from(labels)
      .all()
      .map((l) => l.name)
      .sort();
    expect(names).toEqual(['gym', 'home', 'work']);
  });

  it('dueDatePatchForMove advances the local due date to the new start', () => {
    const patch = dueDatePatchForMove('America/New_York', '2026-03-10T02:30:00Z', false);
    expect(patch.dueDate).toBe('2026-03-09'); // 02:30 UTC is still 2026-03-09 evening in NY
    expect(patch.dueDatetimeUtc).toBeNull();
  });

  it('dueDatePatchForMove keeps the due time in sync when the task had one', () => {
    const patch = dueDatePatchForMove('UTC', '2026-03-10T14:00:00Z', true);
    expect(patch.dueDate).toBe('2026-03-10');
    expect(patch.dueDatetimeUtc).toBe('2026-03-10T14:00:00Z');
  });

  it('isSelfOrAncestor rejects a task becoming its own descendant', () => {
    const root = insertTask(db);
    const child = insertTask(db, { parentId: root });
    expect(isSelfOrAncestor(db, root, root)).toBe(true);
    expect(isSelfOrAncestor(db, root, child)).toBe(true); // child is a descendant -> can't become root's parent
    const unrelated = insertTask(db);
    expect(isSelfOrAncestor(db, root, unrelated)).toBe(false);
  });

  it('hasIncompleteBlocker is true only while a blocker is open', () => {
    const t3 = insertTask(db, { status: 'todo' });
    const t5 = insertTask(db, { status: 'todo' });
    expect(hasIncompleteBlocker(db, t5)).toBe(false);
    addDependency(db, t3, t5);
    expect(hasIncompleteBlocker(db, t5)).toBe(true);
    expect(blockerIdsOf(db, t5)).toEqual([t3]);
    setTaskStatus(db, t3, 'done', '2026-01-02T00:00:00Z');
    expect(hasIncompleteBlocker(db, t5)).toBe(false);
  });

  it('hasIncompleteBlocker ignores a deleted or cancelled blocker', () => {
    const cancelled = insertTask(db, { status: 'cancelled' });
    const deleted = insertTask(db, { status: 'todo', isDeleted: 1 });
    const t = insertTask(db, { status: 'todo' });
    addDependency(db, cancelled, t);
    addDependency(db, deleted, t);
    expect(hasIncompleteBlocker(db, t)).toBe(false);
  });

  it('wouldCreateDependencyCycle rejects self-deps and transitive cycles', () => {
    const a = insertTask(db);
    const b = insertTask(db);
    const c = insertTask(db);
    expect(wouldCreateDependencyCycle(db, a, a)).toBe(true);
    // a -> b -> c (c depends on b depends on a)
    addDependency(db, a, b);
    addDependency(db, b, c);
    // proposing c -> a (a depends on c) would close the loop
    expect(wouldCreateDependencyCycle(db, c, a)).toBe(true);
    const unrelated = insertTask(db);
    expect(wouldCreateDependencyCycle(db, unrelated, a)).toBe(false);
  });

  it('deleteTask removes dependency edges pointing at the deleted task in either direction', async () => {
    const blocker = insertTask(db);
    const blocked = insertTask(db);
    addDependency(db, blocker, blocked);
    await deleteTask(db, null, DEFAULT_SETTINGS, blocker);
    expect(db.select().from(taskDependencies).all()).toEqual([]);
  });
});
