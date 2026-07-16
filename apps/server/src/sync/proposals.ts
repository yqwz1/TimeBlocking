import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { CandidateReason, ProposalDTO, ProposalItemChange, ProposalItemDTO, ProposalRefineInput, Settings } from '@timeblock/shared';
import { blocks, habits, planProposals, scheduleRuns, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { logSync } from '../log.js';
import { diffBlocks, type BlockOp, type CurrentBlockLite } from '../scheduler/diff.js';
import { plan } from '../scheduler/engine.js';
import { scoreTask } from '../scheduler/score.js';
import { reason } from '../scheduler/slotScore.js';
import type { DesiredBlock, PlanInput, PlanTaskInput } from '../scheduler/types.js';
import type { TaskRisk } from '../scheduler/feasibility.js';
import { Gcal } from '../integrations/google/client.js';
import {
  addMinutesIso,
  applyOps,
  buildPlanInput,
  dateOf,
  persistAnnotations,
  planOnly,
  titleFor,
  type RunSummary,
} from './reconciler.js';

const ACTIVE_STATUSES: string[] = ['draft'];
const MAX_SUGGESTED_CANDIDATES = 10;

type ProposalRow = typeof planProposals.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

function parseKey(key: string): { taskId?: string; habitId?: string } {
  const parts = key.split(':');
  if (parts[0] === 'task') return { taskId: parts[1] };
  if (parts[0] === 'habit') return { habitId: parts[1] };
  return {};
}

function removedTitle(db: DB, key: string): string {
  const { taskId, habitId } = parseKey(key);
  if (taskId) return db.select().from(tasks).where(eq(tasks.id, taskId)).get()?.content ?? 'Task';
  if (habitId) return db.select().from(habits).where(eq(habits.id, habitId)).get()?.name ?? 'Habit';
  return 'Block';
}

function toItem(db: DB, d: DesiredBlock, change: ProposalItemChange, tz: string, prev?: CurrentBlockLite): ProposalItemDTO {
  return {
    key: d.key,
    taskId: d.taskId,
    habitId: d.habitId,
    title: titleFor(db, d),
    start: d.startUtc,
    end: d.endUtc,
    ...(prev ? { prevStart: prev.startUtc, prevEnd: prev.endUtc } : {}),
    change,
    reasons: d.reasons,
    chunk: d.chunk,
    date: dateOf(d.startUtc, tz),
  };
}

function toRemovedItem(db: DB, c: CurrentBlockLite, tz: string): ProposalItemDTO {
  const { taskId, habitId } = parseKey(c.key);
  return {
    key: c.key,
    taskId,
    habitId,
    title: removedTitle(db, c.key),
    start: c.startUtc,
    end: c.endUtc,
    change: 'removed',
    reasons: [],
    date: dateOf(c.startUtc, tz),
  };
}

/** Classify a diff into review-friendly items (new/moved/removed/unchanged), oldest-first. */
function classify(
  db: DB,
  tz: string,
  ops: BlockOp[],
  desired: DesiredBlock[],
  current: CurrentBlockLite[],
): { items: ProposalItemDTO[]; summary: { created: number; moved: number; deleted: number; unchanged: number } } {
  const desiredByKey = new Map(desired.map((d) => [d.key, d]));
  const currentByKey = new Map(current.map((c) => [c.key, c]));
  const currentById = new Map(current.map((c) => [c.id, c]));
  const changedKeys = new Set<string>();
  const items: ProposalItemDTO[] = [];
  let created = 0;
  let moved = 0;
  let deleted = 0;

  for (const op of ops) {
    if (op.type === 'create') {
      created++;
      changedKeys.add(op.desired.key);
      items.push(toItem(db, op.desired, 'new', tz));
    } else if (op.type === 'move') {
      moved++;
      changedKeys.add(op.desired.key);
      items.push(toItem(db, op.desired, 'moved', tz, currentById.get(op.blockId)));
    } else {
      deleted++;
      const c = currentById.get(op.blockId);
      if (c) {
        changedKeys.add(c.key);
        items.push(toRemovedItem(db, c, tz));
      }
    }
  }

  let unchanged = 0;
  for (const [key, d] of desiredByKey) {
    if (changedKeys.has(key) || !currentByKey.has(key)) continue;
    unchanged++;
    items.push(toItem(db, d, 'unchanged', tz));
  }

  items.sort((a, b) => a.start.localeCompare(b.start));
  return { items, summary: { created, moved, deleted, unchanged } };
}

/**
 * Recompute a draft's review items against the *current* DB/calendar state.
 * Never writes anything — safe to call on every GET, and reused by applyProposal
 * right before it writes so staleness (an intervening Google change, a task that
 * became locked) is always caught against fresh state rather than a stale cache.
 */
function computeItemsForDraft(
  db: DB,
  settings: Settings,
  nowIso: string,
  externalBusy: { startUtc: string; endUtc: string }[],
  storedDesired: DesiredBlock[],
  rejectedTaskIds: string[],
): {
  items: ProposalItemDTO[];
  summary: { created: number; moved: number; deleted: number; unchanged: number };
  ops: BlockOp[];
  freshCurrent: CurrentBlockLite[];
  freshBusy: { startUtc: string; endUtc: string }[];
  filteredDesired: DesiredBlock[];
} {
  const { current, input, fixedTaskIds } = buildPlanInput(db, settings, nowIso, externalBusy, {
    sticky: true,
    allowMissedReplan: true,
  });
  const rejected = new Set(rejectedTaskIds);
  const filteredDesired = storedDesired.filter((d) => !(d.taskId && (rejected.has(d.taskId) || fixedTaskIds.has(d.taskId))));
  const ops = diffBlocks(current, filteredDesired);
  const { items, summary } = classify(db, settings.timezone, ops, filteredDesired, current);
  return { items, summary, ops, freshCurrent: current, freshBusy: input.busy, filteredDesired };
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function violatesBusy(startUtc: string, endUtc: string, busy: { startUtc: string; endUtc: string }[]): boolean {
  const s = Date.parse(startUtc);
  const e = Date.parse(endUtc);
  return busy.some((b) => overlaps(s, e, Date.parse(b.startUtc), Date.parse(b.endUtc)));
}

function notScheduledFrom(db: DB, risks: TaskRisk[]): ProposalDTO['notScheduled'] {
  return risks
    .filter((r) => r.kind === 'unplaceable' || r.kind === 'capacity_shortfall')
    .map((r) => ({ taskId: r.taskId, content: db.select().from(tasks).where(eq(tasks.id, r.taskId)).get()?.content, kind: r.kind }));
}

function warningsFrom(risks: TaskRisk[]): ProposalDTO['warnings'] {
  return risks.map((r) => ({
    kind: r.kind,
    taskId: r.taskId,
    deadline: r.deadlineUtc,
    shortfallMin: r.shortfallMin,
    date: r.date,
  }));
}

function rowToDTO(
  row: ProposalRow,
  items: ProposalItemDTO[],
  summary: ProposalDTO['summary'],
  notScheduled: ProposalDTO['notScheduled'],
  candidates: ProposalDTO['candidates'],
): ProposalDTO {
  const risks: TaskRisk[] = JSON.parse(row.risks);
  return {
    id: row.id,
    createdAt: row.createdAtUtc,
    status: row.status as ProposalDTO['status'],
    scopeDate: row.scopeDate,
    summary,
    items,
    notScheduled,
    warnings: warningsFrom(risks),
    dayLoads: JSON.parse(row.dayLoads),
    candidates,
  };
}

function localDueDate(t: TaskRow, tz: string): string | null {
  if (t.dueDate) return t.dueDate;
  if (t.dueDatetimeUtc) return dateOf(t.dueDatetimeUtc, tz);
  return null;
}

function toPlanTaskInputLite(t: TaskRow): PlanTaskInput {
  return {
    id: t.id,
    priority: t.priority,
    dueDate: t.dueDate,
    dueDatetimeUtc: t.dueDatetimeUtc,
    plannedForDate: t.plannedForDate,
    durationMin: t.durationMin ?? 30,
    difficulty: null,
    createdAtUtc: t.createdAtUtc,
    labels: [],
    projectId: t.projectId,
    objectiveBoost: 0,
    currentChunks: [],
  };
}

/**
 * The Plan Day triage pool for scopeDate: anything missed/due/overdue/already-picked,
 * plus the top-scored backlog so undated work has a way onto the calendar without
 * flipping schedulePolicy to 'all' (which would flood the day with the whole backlog).
 */
function buildCandidates(db: DB, settings: Settings, nowIso: string, scopeDate: string): ProposalDTO['candidates'] {
  const tz = settings.timezone;
  const nowMs = Date.parse(nowIso);
  const allTasks = db.select().from(tasks).all();

  const openChildParents = new Set<string>();
  for (const t of allTasks) {
    if (t.parentId && !t.isDeleted && t.status !== 'done' && t.status !== 'cancelled') openChildParents.add(t.parentId);
  }
  const missedTaskIds = new Set(
    db
      .select({ taskId: blocks.taskId })
      .from(blocks)
      .where(eq(blocks.status, 'missed'))
      .all()
      .map((r) => r.taskId)
      .filter((id): id is string => !!id),
  );

  const open = allTasks.filter(
    (t) => !t.isDeleted && !t.skipScheduling && (t.status === 'todo' || t.status === 'in_progress') && !openChildParents.has(t.id),
  );

  const primaryReason = (t: TaskRow): CandidateReason | null => {
    if (missedTaskIds.has(t.id)) return 'missed';
    const due = localDueDate(t, tz);
    if (due === scopeDate) return 'due_today';
    if (due != null && due < scopeDate) return 'overdue';
    if (t.plannedForDate === scopeDate) return 'picked';
    return null;
  };

  const withReason = open.map((t) => ({ t, taskReason: primaryReason(t) }));
  const surfaced = withReason.filter((x) => x.taskReason != null) as { t: TaskRow; taskReason: CandidateReason }[];

  const suggested = withReason
    .filter((x) => x.taskReason == null)
    .map((x) => ({ t: x.t, score: scoreTask(toPlanTaskInputLite(x.t), nowMs, tz) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTED_CANDIDATES)
    .map((x) => ({ t: x.t, taskReason: 'suggested' as CandidateReason }));

  return [...surfaced, ...suggested].map(({ t, taskReason }) => ({
    taskId: t.id,
    content: t.content,
    priority: t.priority,
    dueDate: t.dueDate,
    durationMin: t.durationMin ?? settings.defaultDurationMin,
    reason: taskReason,
    picked: t.plannedForDate === scopeDate,
  }));
}

/**
 * When a proposal is drafted, pre-pick missed tasks for the scope day if
 * settings.autoRescheduleMissed is on — this replaces the old behavior of
 * silently replanning missed tasks in the background. A task that's already
 * picked for some other day is left alone.
 */
function autoPickMissed(db: DB, nowIso: string, scopeDate: string): void {
  const missedTaskIds = [
    ...new Set(
      db
        .select({ taskId: blocks.taskId })
        .from(blocks)
        .where(eq(blocks.status, 'missed'))
        .all()
        .map((r) => r.taskId)
        .filter((id): id is string => !!id),
    ),
  ];
  if (!missedTaskIds.length) return;
  const rows = db.select().from(tasks).where(inArray(tasks.id, missedTaskIds)).all();
  for (const t of rows) {
    if (t.isDeleted || t.skipScheduling || t.status === 'done' || t.status === 'cancelled' || t.plannedForDate) continue;
    db.update(tasks).set({ plannedForDate: scopeDate, updatedAtUtc: nowIso }).where(eq(tasks.id, t.id)).run();
  }
}

/** Lightweight lookup for the sync status/SSE surface — no recomputation. */
export function getDraftProposalId(db: DB): string | null {
  const row = db
    .select({ id: planProposals.id })
    .from(planProposals)
    .where(eq(planProposals.status, 'draft'))
    .orderBy(desc(planProposals.createdAtUtc))
    .get();
  return row?.id ?? null;
}

/** Discard any currently-live draft (there is only ever one at a time — D2). */
function discardExistingDrafts(db: DB): void {
  db.update(planProposals).set({ status: 'discarded' }).where(inArray(planProposals.status, ACTIVE_STATUSES)).run();
}

/**
 * Draft a fresh proposal: run the pure planner + diff (clean repack, not sticky)
 * and persist the desired blocks for review. Nothing is written to Google/DB
 * blocks here — only the planProposals row.
 */
export function createProposal(
  db: DB,
  settings: Settings,
  externalBusy: { startUtc: string; endUtc: string }[],
  nowIso: string,
  scopeDate: string,
): ProposalDTO {
  discardExistingDrafts(db);
  if (settings.autoRescheduleMissed) autoPickMissed(db, nowIso, scopeDate);
  const { current, result, ops } = planOnly(db, settings, nowIso, externalBusy, { sticky: false, allowMissedReplan: true });
  const { items, summary } = classify(db, settings.timezone, ops, result.blocks, current);
  const notScheduled = notScheduledFrom(db, result.risks);

  const id = randomUUID();
  db.insert(planProposals)
    .values({
      id,
      createdAtUtc: nowIso,
      status: 'draft',
      scopeDate,
      desired: JSON.stringify(result.blocks),
      pins: '[]',
      rejectedTaskIds: '[]',
      summary: JSON.stringify(summary),
      risks: JSON.stringify(result.risks),
      dayLoads: JSON.stringify(result.dayLoads),
    })
    .run();

  const row = db.select().from(planProposals).where(eq(planProposals.id, id)).get()!;
  return rowToDTO(row, items, summary, notScheduled, buildCandidates(db, settings, nowIso, scopeDate));
}

/** Fetch the current live draft (if any), with items recomputed against fresh state. */
export function getCurrentProposal(db: DB, settings: Settings, externalBusy: { startUtc: string; endUtc: string }[], nowIso: string): ProposalDTO | null {
  const row = db.select().from(planProposals).where(eq(planProposals.status, 'draft')).orderBy(desc(planProposals.createdAtUtc)).get();
  if (!row) return null;
  const storedDesired: DesiredBlock[] = JSON.parse(row.desired);
  const rejectedTaskIds: string[] = JSON.parse(row.rejectedTaskIds);
  const { items, summary } = computeItemsForDraft(db, settings, nowIso, externalBusy, storedDesired, rejectedTaskIds);
  const risks: TaskRisk[] = JSON.parse(row.risks);
  return rowToDTO(row, items, summary, notScheduledFrom(db, risks), buildCandidates(db, settings, nowIso, row.scopeDate));
}

export function discardProposal(db: DB, proposalId: string): boolean {
  const row = db.select().from(planProposals).where(eq(planProposals.id, proposalId)).get();
  if (!row || row.status !== 'draft') return false;
  db.update(planProposals).set({ status: 'discarded' }).where(eq(planProposals.id, proposalId)).run();
  return true;
}

export type RefineProposalResult = { ok: true; proposal: ProposalDTO } | { ok: false; reason: 'not_found' | 'not_draft' };

/**
 * Refine a draft from the Plan Day ritual: persist picks/unpicks, then re-plan
 * with pinned placements frozen into busy (same mechanism buildPlanInput uses
 * for locked blocks) and rejected/pinned tasks excluded from the input — so a
 * pin is a constraint on *this draft*, never a lock on the calendar itself.
 */
export function refineProposal(
  db: DB,
  settings: Settings,
  externalBusy: { startUtc: string; endUtc: string }[],
  nowIso: string,
  proposalId: string,
  opts: ProposalRefineInput,
): RefineProposalResult {
  const row = db.select().from(planProposals).where(eq(planProposals.id, proposalId)).get();
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status !== 'draft') return { ok: false, reason: 'not_draft' };

  for (const taskId of opts.pickTaskIds ?? []) {
    db.update(tasks).set({ plannedForDate: row.scopeDate, updatedAtUtc: nowIso }).where(eq(tasks.id, taskId)).run();
  }
  for (const taskId of opts.unpickTaskIds ?? []) {
    db.update(tasks)
      .set({ plannedForDate: null, updatedAtUtc: nowIso })
      .where(and(eq(tasks.id, taskId), eq(tasks.plannedForDate, row.scopeDate)))
      .run();
  }

  const nextRejected = new Set([...(JSON.parse(row.rejectedTaskIds) as string[]), ...(opts.rejectTaskIds ?? [])]);
  const nextPins = new Set([...(JSON.parse(row.pins) as string[]), ...(opts.pins ?? [])]);

  const storedDesired: DesiredBlock[] = JSON.parse(row.desired);
  const pinnedDesired = storedDesired.filter((d) => nextPins.has(d.key) && !(d.taskId && nextRejected.has(d.taskId)));
  const pinnedTaskIds = new Set(pinnedDesired.map((d) => d.taskId).filter((id): id is string => !!id));
  const pinnedWithReason = pinnedDesired.map((d) => ({
    ...d,
    reasons: [reason('pinned'), ...d.reasons.filter((r) => r.code !== 'pinned' && r.code !== 'sticky')],
  }));

  const { input, current } = buildPlanInput(db, settings, nowIso, externalBusy, { sticky: false, allowMissedReplan: true });
  const frozenBusy = pinnedDesired.map((d) => ({ startUtc: d.startUtc, endUtc: addMinutesIso(d.endUtc, settings.bufferMin) }));
  const replanInput: PlanInput = {
    ...input,
    busy: [...input.busy, ...frozenBusy],
    tasks: input.tasks.filter((t) => !pinnedTaskIds.has(t.id) && !nextRejected.has(t.id)),
  };
  const result = plan(replanInput);
  const desired = [...result.blocks, ...pinnedWithReason];

  const ops = diffBlocks(current, desired);
  const { items, summary } = classify(db, settings.timezone, ops, desired, current);
  const notScheduled = notScheduledFrom(db, result.risks);

  db.update(planProposals)
    .set({
      desired: JSON.stringify(desired),
      pins: JSON.stringify([...nextPins]),
      rejectedTaskIds: JSON.stringify([...nextRejected]),
      summary: JSON.stringify(summary),
      risks: JSON.stringify(result.risks),
      dayLoads: JSON.stringify(result.dayLoads),
    })
    .where(eq(planProposals.id, proposalId))
    .run();

  const updatedRow = db.select().from(planProposals).where(eq(planProposals.id, proposalId)).get()!;
  const candidates = buildCandidates(db, settings, nowIso, row.scopeDate);
  return { ok: true, proposal: rowToDTO(updatedRow, items, summary, notScheduled, candidates) };
}

export type ApplyProposalResult =
  | { ok: true; summary: RunSummary }
  | { ok: false; reason: 'not_found' | 'not_draft' | 'no_calendar' }
  | { ok: false; reason: 'conflict'; conflicts: ProposalItemDTO[] };

/**
 * Apply a draft: recompute the diff against fresh DB/Google state (never the
 * stale stored ops) and validate every new/moved placement still fits before
 * writing anything. Any conflict aborts the whole apply — the caller re-drafts.
 */
export async function applyProposal(
  db: DB,
  gcal: Gcal,
  settings: Settings,
  externalBusy: { startUtc: string; endUtc: string }[],
  nowIso: string,
  proposalId: string,
): Promise<ApplyProposalResult> {
  const row = db.select().from(planProposals).where(eq(planProposals.id, proposalId)).get();
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status !== 'draft') return { ok: false, reason: 'not_draft' };
  if (!settings.appCalendarId) return { ok: false, reason: 'no_calendar' };

  const storedDesired: DesiredBlock[] = JSON.parse(row.desired);
  const rejectedTaskIds: string[] = JSON.parse(row.rejectedTaskIds);
  const { items, ops, freshCurrent, freshBusy, filteredDesired } = computeItemsForDraft(
    db,
    settings,
    nowIso,
    externalBusy,
    storedDesired,
    rejectedTaskIds,
  );

  const now = Date.parse(nowIso);
  const conflicts = items.filter((item) => {
    if (item.change !== 'new' && item.change !== 'moved') return false;
    if (Date.parse(item.start) < now) return true;
    return violatesBusy(item.start, item.end, freshBusy);
  });
  if (conflicts.length) return { ok: false, reason: 'conflict', conflicts };

  const { created, moved, deleted } = await applyOps(db, gcal, settings.appCalendarId, settings.timezone, ops);
  persistAnnotations(db, filteredDesired, freshCurrent, nowIso);

  const risks: TaskRisk[] = JSON.parse(row.risks);
  const atRisk = risks.filter((r) => r.kind === 'past_deadline' || r.kind === 'placed_after_deadline').map((r) => r.taskId);
  const unplaceable = risks.filter((r) => r.kind === 'unplaceable').map((r) => r.taskId);
  const dayLoads = JSON.parse(row.dayLoads);

  if (created || moved || deleted) {
    logSync(db, 'scheduler', 'info', `proposal applied: +${created} ~${moved} -${deleted}`);
  }
  db.insert(scheduleRuns)
    .values({
      ranAtUtc: nowIso,
      trigger: 'proposal-apply',
      created,
      moved,
      deleted,
      atRisk: JSON.stringify(atRisk),
      unplaceable: JSON.stringify(unplaceable),
      risks: JSON.stringify(risks),
      dayLoads: JSON.stringify(dayLoads),
    })
    .run();
  db.update(planProposals).set({ status: 'applied', appliedAtUtc: nowIso }).where(eq(planProposals.id, proposalId)).run();

  return { ok: true, summary: { created, moved, deleted, atRisk, unplaceable, risks, dayLoads } };
}

/** Latest apply-trigger scheduleRuns timestamp, for SyncStatusDTO.schedule.lastAppliedAt. */
export function lastAppliedAt(db: DB): string | null {
  const row = db
    .select()
    .from(scheduleRuns)
    .where(eq(scheduleRuns.trigger, 'proposal-apply'))
    .orderBy(desc(scheduleRuns.id))
    .get();
  return row?.ranAtUtc ?? null;
}
