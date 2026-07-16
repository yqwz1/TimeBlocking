import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@timeblock/shared';
import { createDb, type DB } from '../db/client.js';
import { blocks, planProposals, taskDependencies, tasks } from '../db/schema.js';
import type { Gcal } from '../integrations/google/client.js';
import { applyProposal, createProposal, discardProposal, getCurrentProposal, refineProposal } from './proposals.js';

// Monday 2026-07-06, 08:00 UTC — before the 09:00-17:00 working window.
const NOW = '2026-07-06T08:00:00Z';
const TODAY = '2026-07-06';

const SETTINGS: Settings = { ...DEFAULT_SETTINGS, timezone: 'UTC', appCalendarId: 'app-cal', autoApply: 'off' };

function fakeGcal(): Gcal {
  return {
    insertEvent: async () => 'created',
    patchEvent: async () => undefined,
    deleteEvent: async () => undefined,
    freeBusy: async () => [],
  } as unknown as Gcal;
}

function insertTask(db: DB, overrides: Partial<typeof tasks.$inferInsert> = {}) {
  const id = overrides.id ?? randomUUID();
  db.insert(tasks)
    .values({ id, content: 'Write report', status: 'todo', dueDate: TODAY, durationMin: 60, ...overrides })
    .run();
  return id;
}

describe('proposals', () => {
  let db: DB;
  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('createProposal drafts a placement without writing any blocks', () => {
    insertTask(db);
    const proposal = createProposal(db, SETTINGS, [], NOW, TODAY);

    expect(proposal.status).toBe('draft');
    expect(proposal.summary.created).toBe(1);
    expect(proposal.items).toHaveLength(1);
    expect(proposal.items[0].change).toBe('new');
    expect(proposal.items[0].start).toBe('2026-07-06T09:00:00Z');

    // Nothing should be written to the blocks table yet — that's the whole point.
    expect(db.select().from(blocks).all()).toHaveLength(0);
  });

  it('a task with an incomplete blocker is left out of the draft; unblocking it lets it schedule', () => {
    const t3 = insertTask(db, { content: 'Task 3' });
    const t5 = insertTask(db, { content: 'Task 5' });
    db.insert(taskDependencies).values({ id: randomUUID(), blockerId: t3, blockedId: t5, createdAtUtc: NOW }).run();

    const before = createProposal(db, SETTINGS, [], NOW, TODAY);
    expect(before.items.map((i) => i.taskId)).toEqual([t3]);
    expect(before.notScheduled.find((n) => n.taskId === t5)).toBeUndefined(); // out of scope, not "couldn't place"

    db.update(tasks).set({ status: 'done' }).where(eq(tasks.id, t3)).run();
    const after = createProposal(db, SETTINGS, [], NOW, TODAY);
    expect(after.items.map((i) => i.taskId).sort()).toEqual([t5]);
  });

  it('applyProposal writes exactly what was drafted and marks the proposal applied', async () => {
    insertTask(db);
    const proposal = createProposal(db, SETTINGS, [], NOW, TODAY);

    const outcome = await applyProposal(db, fakeGcal(), SETTINGS, [], NOW, proposal.id);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.summary.created).toBe(1);

    const rows = db.select().from(blocks).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('scheduled');
    expect(rows[0].startUtc).toBe('2026-07-06T09:00:00Z');

    const row = db.select().from(planProposals).where(eq(planProposals.id, proposal.id)).get()!;
    expect(row.status).toBe('applied');
    expect(row.appliedAtUtc).toBe(NOW);
  });

  it('applyProposal rejects with a conflict (and writes nothing) when the slot became busy after the draft', async () => {
    insertTask(db);
    const proposal = createProposal(db, SETTINGS, [], NOW, TODAY);

    // Simulate an external calendar event landing on the exact proposed slot after the draft was made.
    const collidingBusy = [{ startUtc: '2026-07-06T09:00:00Z', endUtc: '2026-07-06T10:00:00Z' }];
    const outcome = await applyProposal(db, fakeGcal(), SETTINGS, collidingBusy, NOW, proposal.id);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.reason).toBe('conflict');
    if (outcome.reason !== 'conflict') throw new Error('unreachable');
    expect(outcome.conflicts.length).toBeGreaterThan(0);

    // A rejected apply must not write anything.
    expect(db.select().from(blocks).all()).toHaveLength(0);
    const row = db.select().from(planProposals).all()[0];
    expect(row.status).toBe('draft');
  });

  it('getCurrentProposal returns null once the draft is discarded', () => {
    insertTask(db);
    const proposal = createProposal(db, SETTINGS, [], NOW, TODAY);
    expect(getCurrentProposal(db, SETTINGS, [], NOW)).not.toBeNull();

    expect(discardProposal(db, proposal.id)).toBe(true);
    expect(getCurrentProposal(db, SETTINGS, [], NOW)).toBeNull();
  });

  it('creating a second proposal discards the first — only one live draft at a time', () => {
    insertTask(db, { content: 'Task A' });
    const first = createProposal(db, SETTINGS, [], NOW, TODAY);
    insertTask(db, { content: 'Task B', dueDate: TODAY });
    const second = createProposal(db, SETTINGS, [], NOW, TODAY);

    expect(second.id).not.toBe(first.id);
    const rows = db.select().from(planProposals).all();
    const firstRow = rows.find((r) => r.id === first.id)!;
    expect(firstRow.status).toBe('discarded');
  });

  it('refineProposal pins a placement so it survives a later refine untouched', () => {
    const pinnedId = insertTask(db, { content: 'Pin me' });
    const proposal = createProposal(db, SETTINGS, [], NOW, TODAY);
    const pinnedItem = proposal.items.find((i) => i.taskId === pinnedId)!;
    expect(pinnedItem.start).toBe('2026-07-06T09:00:00Z');

    const afterPin = refineProposal(db, SETTINGS, [], NOW, proposal.id, { pins: [pinnedItem.key] });
    expect(afterPin.ok).toBe(true);
    if (!afterPin.ok) throw new Error('unreachable');

    // A second, unrelated refine call must not move the pinned placement.
    const otherId = insertTask(db, { content: 'Also today', dueDate: TODAY });
    const afterSecondRefine = refineProposal(db, SETTINGS, [], NOW, proposal.id, { pickTaskIds: [otherId] });
    expect(afterSecondRefine.ok).toBe(true);
    if (!afterSecondRefine.ok) throw new Error('unreachable');

    const stillPinned = afterSecondRefine.proposal.items.find((i) => i.taskId === pinnedId)!;
    expect(stillPinned.start).toBe(pinnedItem.start);
    expect(stillPinned.reasons.some((r) => r.code === 'pinned')).toBe(true);
  });

  it('refineProposal drops a rejected task from the draft entirely', () => {
    const rejectedId = insertTask(db, { content: 'Reject me' });
    const proposal = createProposal(db, SETTINGS, [], NOW, TODAY);
    expect(proposal.items.some((i) => i.taskId === rejectedId)).toBe(true);

    const refined = refineProposal(db, SETTINGS, [], NOW, proposal.id, { rejectTaskIds: [rejectedId] });
    expect(refined.ok).toBe(true);
    if (!refined.ok) throw new Error('unreachable');
    expect(refined.proposal.items.some((i) => i.taskId === rejectedId)).toBe(false);
  });

  it('picking an undated task for the scope day gives it a same-day soft deadline and marks it picked', () => {
    const undatedId = insertTask(db, { content: 'Someday task', dueDate: null });
    const proposal = createProposal(db, SETTINGS, [], NOW, TODAY);
    // Not due, not overdue, not missed — it's undated, so it shouldn't get a block yet.
    expect(proposal.items.some((i) => i.taskId === undatedId)).toBe(false);
    const candidateBefore = proposal.candidates.find((c) => c.taskId === undatedId);
    expect(candidateBefore?.picked).toBe(false);

    const refined = refineProposal(db, SETTINGS, [], NOW, proposal.id, { pickTaskIds: [undatedId] });
    expect(refined.ok).toBe(true);
    if (!refined.ok) throw new Error('unreachable');

    const placed = refined.proposal.items.find((i) => i.taskId === undatedId);
    expect(placed?.date).toBe(TODAY);
    expect(placed?.reasons.some((r) => r.code === 'picked_today')).toBe(true);
    const candidateAfter = refined.proposal.candidates.find((c) => c.taskId === undatedId);
    expect(candidateAfter?.picked).toBe(true);
  });
});
