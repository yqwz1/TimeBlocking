import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { ActionProposal, ActionProposalType, EvidenceRef } from '@timeblock/shared';
import type { DB } from '../db/client.js';
import {
  actionProposals,
  commitments,
  goals,
  notes,
  planProposals,
  reminders,
  tasks,
} from '../db/schema.js';
import { nowUtcIso } from '../config.js';
import { evidenceByIds, recordDomainEvent } from './foundation.js';
import { getSettings } from '../settings.js';
import { getVaultRoot, normalizeNotePath, writeNoteFile } from '../notes/vault.js';
import { indexNote } from '../notes/indexer.js';
import type { SyncManager } from '../sync/manager.js';

type ProposalRow = typeof actionProposals.$inferSelect;

function jsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function freshnessVersion(db: DB, affectedRecords: string[]): string {
  const snapshot = affectedRecords
    .map((ref) => {
      const [kind, id] = ref.split(':', 2);
      if (kind === 'task') {
        const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
        return row ? `${ref}:${row.updatedAtUtc ?? row.createdAtUtc ?? ''}:${row.status}:${row.isDeleted}` : `${ref}:missing`;
      }
      if (kind === 'goal') {
        const row = db.select().from(goals).where(eq(goals.id, id)).get();
        return row ? `${ref}:${row.status}:${row.currentValue}` : `${ref}:missing`;
      }
      return ref;
    })
    .join('|');
  return createHash('sha256').update(snapshot).digest('hex').slice(0, 24);
}

export function proposalToDto(db: DB, row: ProposalRow): ActionProposal {
  return {
    id: row.id,
    type: row.type as ActionProposalType,
    status: row.status as ActionProposal['status'],
    title: row.title,
    preview: row.preview,
    payload: jsonObject(row.payload),
    reasoning: row.reasoning,
    evidence: evidenceByIds(db, stringArray(row.evidenceIds)),
    riskLevel: row.riskLevel as ActionProposal['riskLevel'],
    expiresAt: row.expiresAtUtc,
    affectedRecords: stringArray(row.affectedRecords),
    freshnessVersion: row.freshnessVersion,
    idempotencyKey: row.idempotencyKey,
    error: row.error,
    createdAt: row.createdAtUtc,
    updatedAt: row.updatedAtUtc,
    executedAt: row.executedAtUtc,
  };
}

export function createActionProposal(
  db: DB,
  input: {
    type: ActionProposalType;
    title: string;
    preview: string;
    payload: Record<string, unknown>;
    reasoning: string;
    evidenceIds?: string[];
    riskLevel?: ActionProposal['riskLevel'];
    affectedRecords?: string[];
    expiresAt?: string;
    idempotencyKey?: string;
  },
): ActionProposal {
  const now = nowUtcIso();
  const affected = input.affectedRecords ?? [];
  const idempotencyKey =
    input.idempotencyKey ??
    createHash('sha256')
      .update(JSON.stringify({ type: input.type, payload: input.payload, affected, date: now.slice(0, 10) }))
      .digest('hex');
  const existing = db.select().from(actionProposals).where(eq(actionProposals.idempotencyKey, idempotencyKey)).get();
  if (existing) return proposalToDto(db, existing);
  const id = randomUUID();
  db.insert(actionProposals)
    .values({
      id,
      type: input.type,
      status: 'draft',
      title: input.title.slice(0, 300),
      preview: input.preview.slice(0, 4_000),
      payload: JSON.stringify(input.payload),
      reasoning: input.reasoning.slice(0, 4_000),
      evidenceIds: JSON.stringify(input.evidenceIds ?? []),
      riskLevel: input.riskLevel ?? 'low',
      expiresAtUtc: input.expiresAt ?? new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      affectedRecords: JSON.stringify(affected),
      freshnessVersion: freshnessVersion(db, affected),
      idempotencyKey,
      createdAtUtc: now,
      updatedAtUtc: now,
    })
    .run();
  recordDomainEvent(db, 'action.proposed', 'action_proposal', id, { type: input.type, riskLevel: input.riskLevel ?? 'low' });
  return proposalToDto(db, db.select().from(actionProposals).where(eq(actionProposals.id, id)).get()!);
}

export function listActionProposals(db: DB, statuses?: ActionProposal['status'][]): ActionProposal[] {
  const rows = statuses?.length
    ? db.select().from(actionProposals).where(inArray(actionProposals.status, statuses)).all()
    : db.select().from(actionProposals).all();
  return rows.sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc)).map((row) => proposalToDto(db, row));
}

export function rejectActionProposal(db: DB, id: string): ActionProposal | null {
  const now = nowUtcIso();
  db.update(actionProposals).set({ status: 'rejected', updatedAtUtc: now }).where(eq(actionProposals.id, id)).run();
  recordDomainEvent(db, 'action.rejected', 'action_proposal', id);
  const row = db.select().from(actionProposals).where(eq(actionProposals.id, id)).get();
  return row ? proposalToDto(db, row) : null;
}

function assertString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}

async function executeProposal(db: DB, manager: SyncManager, row: ProposalRow): Promise<void> {
  const payload = jsonObject(row.payload);
  const now = nowUtcIso();
  if (row.type === 'create_task') {
    const id = typeof payload.id === 'string' ? payload.id : randomUUID();
    db.insert(tasks)
      .values({
        id,
        content: assertString(payload, 'content'),
        description: typeof payload.description === 'string' ? payload.description : '',
        priority: typeof payload.priority === 'number' ? Math.max(1, Math.min(4, Math.round(payload.priority))) : 1,
        dueDate: typeof payload.dueDate === 'string' ? payload.dueDate : null,
        durationMin: typeof payload.durationMin === 'number' ? Math.max(5, Math.round(payload.durationMin)) : null,
        labels: JSON.stringify(Array.isArray(payload.labels) ? payload.labels.filter((item) => typeof item === 'string') : []),
        status: 'todo',
        createdAtUtc: now,
        updatedAtUtc: now,
      })
      .onConflictDoNothing()
      .run();
    void manager.forcePlan('assistant-action');
    return;
  }
  if (row.type === 'update_task') {
    const id = assertString(payload, 'id');
    const current = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!current || current.isDeleted) throw new Error('Task no longer exists');
    db.update(tasks)
      .set({
        content: typeof payload.content === 'string' ? payload.content.trim() : current.content,
        description: typeof payload.description === 'string' ? payload.description : current.description,
        dueDate: payload.dueDate === null || typeof payload.dueDate === 'string' ? payload.dueDate : current.dueDate,
        priority: typeof payload.priority === 'number' ? Math.max(1, Math.min(4, Math.round(payload.priority))) : current.priority,
        updatedAtUtc: now,
      })
      .where(eq(tasks.id, id))
      .run();
    void manager.forcePlan('assistant-action');
    return;
  }
  if (row.type === 'create_reminder') {
    const taskId = assertString(payload, 'taskId');
    if (!db.select().from(tasks).where(eq(tasks.id, taskId)).get()) throw new Error('Task no longer exists');
    db.insert(reminders)
      .values({
        id: randomUUID(),
        taskId,
        remindAtUtc: assertString(payload, 'remindAtUtc'),
        message: typeof payload.message === 'string' ? payload.message : '',
        createdAtUtc: now,
      })
      .run();
    return;
  }
  if (row.type === 'create_note') {
    const path = normalizeNotePath(assertString(payload, 'path'));
    if (db.select({ id: notes.id }).from(notes).where(eq(notes.id, path)).get()) throw new Error('A note already exists at that path');
    const content = typeof payload.content === 'string' ? payload.content : '';
    const settings = getSettings(db);
    const root = getVaultRoot(db);
    await writeNoteFile(root, path, content, settings.notesSnapshotRetention);
    await indexNote(db, root, path);
    return;
  }
  if (row.type === 'create_goal') {
    const date = new Date();
    const month = date.getMonth() + 1;
    db.insert(goals)
      .values({
        id: randomUUID(),
        title: assertString(payload, 'title'),
        description: typeof payload.description === 'string' ? payload.description : '',
        achievable: typeof payload.achievable === 'string' ? payload.achievable : '',
        relevance: typeof payload.relevance === 'string' ? payload.relevance : '',
        year: typeof payload.year === 'number' ? Math.round(payload.year) : date.getFullYear(),
        quarter: typeof payload.quarter === 'number' ? Math.max(1, Math.min(4, Math.round(payload.quarter))) : Math.ceil(month / 3),
        customDeadline: typeof payload.customDeadline === 'string' ? payload.customDeadline : null,
        createdAtUtc: now,
      })
      .run();
    return;
  }
  if (row.type === 'schedule_change') {
    if (!Array.isArray(payload.desired) || payload.desired.length === 0) throw new Error('A schedule proposal must contain at least one desired block');
    db.insert(planProposals)
      .values({
        id: randomUUID(),
        createdAtUtc: now,
        status: 'draft',
        scopeDate: typeof payload.scopeDate === 'string' ? payload.scopeDate : now.slice(0, 10),
        desired: JSON.stringify(Array.isArray(payload.desired) ? payload.desired : []),
        pins: '[]',
        rejectedTaskIds: '[]',
        summary: '{}',
        risks: '[]',
        dayLoads: '[]',
      })
      .run();
    return;
  }
  if (row.type === 'create_commitment') {
    db.insert(commitments)
      .values({
        id: randomUUID(),
        direction: payload.direction === 'to_me' ? 'to_me' : 'by_me',
        title: assertString(payload, 'title'),
        details: typeof payload.details === 'string' ? payload.details : '',
        dueAtUtc: typeof payload.dueAt === 'string' ? payload.dueAt : null,
        status: 'open',
        evidenceIds: row.evidenceIds,
        createdAtUtc: now,
        updatedAtUtc: now,
      })
      .run();
    return;
  }
  if (row.type === 'draft_communication') {
    // The persisted proposal itself is the durable draft and preview. Provider creation remains opt-in.
    return;
  }
  if (row.type === 'send_communication') {
    throw new Error('No connected provider is available for approved sending');
  }
  throw new Error(`Unsupported action type: ${row.type}`);
}

export async function approveAndExecuteActionProposal(
  db: DB,
  manager: SyncManager,
  id: string,
  options: { confirmPreview?: boolean } = {},
): Promise<ActionProposal | null> {
  const row = db.select().from(actionProposals).where(eq(actionProposals.id, id)).get();
  if (!row) return null;
  if (row.status === 'completed') return proposalToDto(db, row);
  if (row.status !== 'draft' && row.status !== 'approved' && row.status !== 'failed') throw new Error(`Proposal is ${row.status}`);
  if (row.expiresAtUtc <= nowUtcIso()) {
    db.update(actionProposals).set({ status: 'expired', updatedAtUtc: nowUtcIso() }).where(eq(actionProposals.id, id)).run();
    return proposalToDto(db, db.select().from(actionProposals).where(eq(actionProposals.id, id)).get()!);
  }
  if ((row.type === 'send_communication' || row.riskLevel === 'critical') && !options.confirmPreview) {
    db.update(actionProposals).set({ status: 'approved', updatedAtUtc: nowUtcIso() }).where(eq(actionProposals.id, id)).run();
    throw new Error('Final preview confirmation is required before this action can execute');
  }
  const affected = stringArray(row.affectedRecords);
  if (freshnessVersion(db, affected) !== row.freshnessVersion) throw new Error('The underlying data changed. Review a refreshed proposal before executing.');

  const now = nowUtcIso();
  const claimed = db
    .update(actionProposals)
    .set({ status: 'executing', error: null, updatedAtUtc: now })
    .where(andStatus(row.id, ['draft', 'approved', 'failed']))
    .run();
  if (!claimed.changes) return proposalToDto(db, db.select().from(actionProposals).where(eq(actionProposals.id, id)).get()!);
  try {
    await executeProposal(db, manager, row);
    const completedAt = nowUtcIso();
    db.update(actionProposals)
      .set({ status: 'completed', executedAtUtc: completedAt, updatedAtUtc: completedAt })
      .where(eq(actionProposals.id, id))
      .run();
    recordDomainEvent(db, 'action.completed', 'action_proposal', id, { type: row.type });
  } catch (error) {
    db.update(actionProposals)
      .set({ status: 'failed', error: error instanceof Error ? error.message : String(error), updatedAtUtc: nowUtcIso() })
      .where(eq(actionProposals.id, id))
      .run();
    recordDomainEvent(db, 'action.failed', 'action_proposal', id, { type: row.type, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  return proposalToDto(db, db.select().from(actionProposals).where(eq(actionProposals.id, id)).get()!);
}

function andStatus(id: string, statuses: string[]) {
  return and(eq(actionProposals.id, id), inArray(actionProposals.status, statuses));
}
