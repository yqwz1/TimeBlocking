import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type {
  EvidenceRef,
  KnowledgeRecord,
  KnowledgeSourceType,
  MemoryClaim,
  MemoryClaimInput,
  MemoryClaimPatch,
  MemoryClass,
  MemoryStatus,
} from '@timeblock/shared';
import type { DB } from '../db/client.js';
import {
  dailyPlans,
  concepts,
  domainEvents,
  events,
  goals,
  habits,
  knowledgeRecords,
  knowledgeEntities,
  memoryClaims,
  memoryEvidence,
  notes,
  tasks,
  weeklyReviews,
} from '../db/schema.js';
import { nowUtcIso } from '../config.js';

function jsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeClaim(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function recordDomainEvent(
  db: DB,
  type: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown> = {},
) {
  db.insert(domainEvents)
    .values({ type, aggregateType, aggregateId, payload: JSON.stringify(payload), occurredAtUtc: nowUtcIso() })
    .run();
}

function recordId(sourceType: KnowledgeSourceType, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

export function sourceDeepLink(sourceType: KnowledgeSourceType, sourceId: string): string | null {
  if (sourceType === 'note') return `/second-brain?note=${encodeURIComponent(sourceId)}`;
  if (sourceType === 'task') return `/tasks?task=${encodeURIComponent(sourceId)}`;
  if (sourceType === 'goal') return '/goals';
  if (sourceType === 'habit') return '/habits';
  if (sourceType === 'calendar') return '/calendar';
  if (sourceType === 'reflection') return '/today';
  if (sourceType === 'weekly_review') return '/weekly-review';
  return null;
}

export function upsertKnowledgeRecord(
  db: DB,
  input: {
    sourceType: KnowledgeSourceType;
    sourceId: string;
    sourceVersion?: string;
    title: string;
    excerpt: string;
    occurredAt?: string | null;
    sensitivity?: 'normal' | 'sensitive';
    contentHash?: string | null;
  },
): string {
  const now = nowUtcIso();
  const id = recordId(input.sourceType, input.sourceId);
  const excerpt = input.excerpt.slice(0, 4_000);
  db.insert(knowledgeRecords)
    .values({
      id,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceVersion: input.sourceVersion ?? input.contentHash ?? hash(`${input.title}\n${excerpt}`),
      title: input.title.slice(0, 500),
      excerpt,
      contentHash: input.contentHash ?? hash(`${input.title}\n${excerpt}`),
      occurredAtUtc: input.occurredAt ?? null,
      sensitivity: input.sensitivity ?? 'normal',
      createdAtUtc: now,
      updatedAtUtc: now,
      deletedAtUtc: null,
    })
    .onConflictDoUpdate({
      target: [knowledgeRecords.sourceType, knowledgeRecords.sourceId],
      set: {
        sourceVersion: input.sourceVersion ?? input.contentHash ?? hash(`${input.title}\n${excerpt}`),
        title: input.title.slice(0, 500),
        excerpt,
        contentHash: input.contentHash ?? hash(`${input.title}\n${excerpt}`),
        occurredAtUtc: input.occurredAt ?? null,
        sensitivity: input.sensitivity ?? 'normal',
        updatedAtUtc: now,
        deletedAtUtc: null,
      },
    })
    .run();
  return id;
}

/** Incremental and idempotent: native records stay the source of truth; this only refreshes bounded source cards. */
export function backfillKnowledgeRecords(db: DB): number {
  let count = 0;
  const live = new Set<string>();
  const add = (input: Parameters<typeof upsertKnowledgeRecord>[1]) => {
    const id = upsertKnowledgeRecord(db, input);
    live.add(id);
    count++;
    return id;
  };

  const noteBodies = new Map(
    db.all<{ id: string; body: string }>(sql`SELECT id, body FROM notes_fts`).map((row) => [row.id, row.body]),
  );
  for (const row of db.select().from(notes).all()) {
    const id = add({
      sourceType: 'note',
      sourceId: row.id,
      sourceVersion: row.contentHash,
      title: row.title,
      excerpt: (noteBodies.get(row.id) ?? '').slice(0, 4_000),
      occurredAt: row.updatedAtUtc ?? row.createdAtUtc,
      contentHash: row.contentHash,
    });
    const source = evidenceByIds(db, [id])[0];
    if (source) extractHeuristicMemoryCandidates(db, source);
  }
  for (const row of db.select().from(tasks).where(eq(tasks.isDeleted, 0)).all()) {
    add({
      sourceType: 'task',
      sourceId: row.id,
      title: row.content,
      excerpt: [row.description, row.projectName, row.dueDate ? `Due ${row.dueDate}` : '', `Status ${row.status}`].filter(Boolean).join('\n'),
      occurredAt: row.updatedAtUtc ?? row.createdAtUtc,
    });
  }
  for (const row of db.select().from(goals).all()) {
    add({
      sourceType: 'goal',
      sourceId: row.id,
      title: row.title,
      excerpt: [row.description, row.relevance, `Status ${row.status}`, `Q${row.quarter} ${row.year}`].filter(Boolean).join('\n'),
      occurredAt: row.createdAtUtc,
    });
  }
  for (const row of db.select().from(habits).where(eq(habits.active, 1)).all()) {
    add({
      sourceType: 'habit',
      sourceId: row.id,
      title: row.name,
      excerpt: [row.notes, `${row.durationMin} minutes`, row.rrule].filter(Boolean).join('\n'),
      occurredAt: row.createdAtUtc,
    });
  }
  for (const row of db.select().from(events).all()) {
    add({
      sourceType: 'calendar',
      sourceId: row.id,
      title: row.title,
      excerpt: [row.description, row.location, `${row.startUtc} – ${row.endUtc}`].filter(Boolean).join('\n'),
      occurredAt: row.startUtc,
    });
  }
  for (const row of db.select().from(dailyPlans).all()) {
    if (!row.reflection && !row.intention && !row.highlight) continue;
    const id = add({
      sourceType: 'reflection',
      sourceId: row.date,
      title: `Daily reflection · ${row.date}`,
      excerpt: [row.highlight && `Highlight: ${row.highlight}`, row.reflection, row.intention && `Next: ${row.intention}`].filter(Boolean).join('\n'),
      occurredAt: row.updatedAtUtc ?? row.createdAtUtc,
    });
    const source = evidenceByIds(db, [id])[0];
    if (source) extractHeuristicMemoryCandidates(db, source);
  }
  for (const row of db.select().from(weeklyReviews).all()) {
    const id = add({
      sourceType: 'weekly_review',
      sourceId: row.weekStart,
      title: `Weekly review · ${row.weekStart}`,
      excerpt: [row.wins && `Wins: ${row.wins}`, row.challenges && `Challenges: ${row.challenges}`, row.nextWeekFocus && `Next: ${row.nextWeekFocus}`]
        .filter(Boolean)
        .join('\n'),
      occurredAt: row.reviewedAtUtc ?? row.updatedAtUtc ?? row.createdAtUtc,
    });
    const source = evidenceByIds(db, [id])[0];
    if (source) extractHeuristicMemoryCandidates(db, source);
  }

  const now = nowUtcIso();
  for (const row of db.select({ id: knowledgeRecords.id }).from(knowledgeRecords).where(isNull(knowledgeRecords.deletedAtUtc)).all()) {
    if (!live.has(row.id) && !row.id.startsWith('assistant:') && !row.id.startsWith('communication:') && !row.id.startsWith('manual:')) {
      db.update(knowledgeRecords).set({ deletedAtUtc: now, updatedAtUtc: now }).where(eq(knowledgeRecords.id, row.id)).run();
    }
  }
  return count;
}

/** Rebuildable note concepts become reviewable durable candidates; this never auto-confirms them. */
export function promoteConceptCandidates(db: DB): number {
  const now = nowUtcIso();
  let created = 0;
  for (const concept of db.select().from(concepts).all()) {
    const id = `concept:${concept.id}`;
    const kind =
      concept.type === 'person'
        ? 'person'
        : concept.type === 'project'
          ? 'project'
          : concept.type === 'organization'
            ? 'organization'
            : 'topic';
    const existing = db.select().from(knowledgeEntities).where(eq(knowledgeEntities.id, id)).get();
    db.insert(knowledgeEntities)
      .values({
        id,
        kind,
        canonicalName: concept.name,
        aliases: concept.aliases,
        description: 'Promoted from the rebuildable note concept index.',
        status: 'candidate',
        sensitivity: 'normal',
        createdAtUtc: concept.createdAtUtc ?? now,
        updatedAtUtc: now,
      })
      .onConflictDoUpdate({
        target: knowledgeEntities.id,
        set: {
          canonicalName: concept.name,
          aliases: concept.aliases,
          updatedAtUtc: now,
        },
      })
      .run();
    if (!existing) created++;
  }
  return created;
}

function rowToEvidence(row: typeof knowledgeRecords.$inferSelect, excerptOverride?: string): EvidenceRef {
  return {
    id: row.id,
    sourceType: row.sourceType as KnowledgeSourceType,
    sourceId: row.sourceId,
    title: row.title,
    excerpt: (excerptOverride || row.excerpt).slice(0, 1_200),
    occurredAt: row.occurredAtUtc,
    deepLink: sourceDeepLink(row.sourceType as KnowledgeSourceType, row.sourceId),
    contentHash: row.contentHash,
  };
}

export function evidenceByIds(db: DB, ids: string[]): EvidenceRef[] {
  if (!ids.length) return [];
  const wanted = [...new Set(ids)];
  const rows = db.select().from(knowledgeRecords).where(and(inArray(knowledgeRecords.id, wanted), isNull(knowledgeRecords.deletedAtUtc))).all();
  const byId = new Map(rows.map((row) => [row.id, rowToEvidence(row)]));
  return wanted.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

export function knowledgeRecordBySource(db: DB, sourceType: KnowledgeSourceType, sourceId: string): KnowledgeRecord | null {
  const row = db
    .select()
    .from(knowledgeRecords)
    .where(and(eq(knowledgeRecords.sourceType, sourceType), eq(knowledgeRecords.sourceId, sourceId), isNull(knowledgeRecords.deletedAtUtc)))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    sourceType: row.sourceType as KnowledgeSourceType,
    sourceId: row.sourceId,
    sourceVersion: row.sourceVersion,
    title: row.title,
    excerpt: row.excerpt,
    occurredAt: row.occurredAtUtc,
    sensitivity: row.sensitivity as 'normal' | 'sensitive',
    createdAt: row.createdAtUtc,
    updatedAt: row.updatedAtUtc,
    deletedAt: row.deletedAtUtc,
  };
}

function memoryEvidenceFor(db: DB, memoryId: string): EvidenceRef[] {
  const links = db.select().from(memoryEvidence).where(eq(memoryEvidence.memoryId, memoryId)).all();
  const records = evidenceByIds(db, links.map((link) => link.knowledgeRecordId));
  const excerpts = new Map(links.map((link) => [link.knowledgeRecordId, link.excerpt]));
  return records.map((record) => ({ ...record, excerpt: excerpts.get(record.id) || record.excerpt }));
}

export function memoryToDto(db: DB, row: typeof memoryClaims.$inferSelect): MemoryClaim {
  return {
    id: row.id,
    memoryClass: row.memoryClass as MemoryClass,
    claim: row.claim,
    status: row.status as MemoryStatus,
    confidence: row.confidence,
    sensitivity: row.sensitivity as 'normal' | 'sensitive',
    validFrom: row.validFromUtc,
    validTo: row.validToUtc,
    expiresAt: row.expiresAtUtc,
    lastUsedAt: row.lastUsedAtUtc,
    supersedesId: row.supersedesId,
    contradictedById: row.contradictedById,
    evidence: memoryEvidenceFor(db, row.id),
    createdAt: row.createdAtUtc,
    updatedAt: row.updatedAtUtc,
  };
}

export function listMemories(db: DB, status?: MemoryStatus): MemoryClaim[] {
  expireMemories(db);
  const rows = status
    ? db.select().from(memoryClaims).where(eq(memoryClaims.status, status)).all()
    : db.select().from(memoryClaims).where(ne(memoryClaims.status, 'forgotten')).all();
  return rows.sort((a, b) => b.updatedAtUtc.localeCompare(a.updatedAtUtc)).map((row) => memoryToDto(db, row));
}

function ensureEvidenceRecord(db: DB, evidence: NonNullable<MemoryClaimInput['evidence']>[number]): string {
  return upsertKnowledgeRecord(db, {
    sourceType: evidence.sourceType,
    sourceId: evidence.sourceId,
    title: evidence.title,
    excerpt: evidence.excerpt,
    occurredAt: evidence.occurredAt ?? null,
    contentHash: evidence.contentHash ?? null,
    sensitivity: 'normal',
  });
}

export function createMemory(
  db: DB,
  input: MemoryClaimInput,
  options: { status?: MemoryStatus; confidence?: number; supersedesId?: string | null } = {},
): MemoryClaim {
  const normalized = normalizeClaim(input.claim);
  const existing = db
    .select()
    .from(memoryClaims)
    .where(and(eq(memoryClaims.normalizedClaim, normalized), ne(memoryClaims.status, 'forgotten')))
    .get();
  if (existing) return memoryToDto(db, existing);

  const now = nowUtcIso();
  const id = randomUUID();
  const status: MemoryStatus = input.sensitivity === 'sensitive' && options.status !== 'confirmed' ? 'candidate' : (options.status ?? 'candidate');
  db.insert(memoryClaims)
    .values({
      id,
      memoryClass: input.memoryClass,
      claim: input.claim.trim(),
      normalizedClaim: normalized,
      status,
      confidence: options.confidence ?? (status === 'confirmed' ? 1 : 0.65),
      sensitivity: input.sensitivity,
      validFromUtc: now,
      expiresAtUtc: input.expiresAt ?? null,
      supersedesId: options.supersedesId ?? null,
      createdAtUtc: now,
      updatedAtUtc: now,
    })
    .run();
  for (const evidence of input.evidence ?? []) {
    const knowledgeRecordId = ensureEvidenceRecord(db, evidence);
    db.insert(memoryEvidence).values({ memoryId: id, knowledgeRecordId, excerpt: evidence.excerpt.slice(0, 2_000), createdAtUtc: now }).onConflictDoNothing().run();
  }
  if (options.supersedesId) {
    db.update(memoryClaims)
      .set({ status: 'contradicted', contradictedById: id, validToUtc: now, updatedAtUtc: now })
      .where(eq(memoryClaims.id, options.supersedesId))
      .run();
  }
  recordDomainEvent(db, 'memory.created', 'memory', id, { status, memoryClass: input.memoryClass });
  return memoryToDto(db, db.select().from(memoryClaims).where(eq(memoryClaims.id, id)).get()!);
}

export function updateMemory(db: DB, id: string, patch: MemoryClaimPatch): MemoryClaim | null {
  const current = db.select().from(memoryClaims).where(eq(memoryClaims.id, id)).get();
  if (!current) return null;
  const now = nowUtcIso();
  const claim = patch.claim?.trim() ?? current.claim;
  const status = patch.status ?? current.status;
  db.update(memoryClaims)
    .set({
      memoryClass: patch.memoryClass ?? current.memoryClass,
      claim,
      normalizedClaim: normalizeClaim(claim),
      status,
      confidence: patch.confidence ?? (status === 'confirmed' ? Math.max(current.confidence, 0.9) : current.confidence),
      sensitivity: patch.sensitivity ?? current.sensitivity,
      expiresAtUtc: patch.expiresAt === undefined ? current.expiresAtUtc : patch.expiresAt,
      validToUtc: ['rejected', 'contradicted', 'expired', 'forgotten'].includes(status) ? now : current.validToUtc,
      updatedAtUtc: now,
    })
    .where(eq(memoryClaims.id, id))
    .run();
  if (patch.evidence) {
    db.delete(memoryEvidence).where(eq(memoryEvidence.memoryId, id)).run();
    for (const evidence of patch.evidence) {
      db.insert(memoryEvidence)
        .values({ memoryId: id, knowledgeRecordId: ensureEvidenceRecord(db, evidence), excerpt: evidence.excerpt.slice(0, 2_000), createdAtUtc: now })
        .run();
    }
  }
  recordDomainEvent(db, 'memory.updated', 'memory', id, { status });
  return memoryToDto(db, db.select().from(memoryClaims).where(eq(memoryClaims.id, id)).get()!);
}

export function forgetMemory(db: DB, id: string): boolean {
  const now = nowUtcIso();
  const result = db.update(memoryClaims).set({ status: 'forgotten', validToUtc: now, updatedAtUtc: now }).where(eq(memoryClaims.id, id)).run();
  if (result.changes > 0) recordDomainEvent(db, 'memory.forgotten', 'memory', id);
  return result.changes > 0;
}

export function expireMemories(db: DB, at = nowUtcIso()): number {
  return db
    .update(memoryClaims)
    .set({ status: 'expired', validToUtc: at, updatedAtUtc: at })
    .where(and(eq(memoryClaims.status, 'confirmed'), sql`${memoryClaims.expiresAtUtc} IS NOT NULL AND ${memoryClaims.expiresAtUtc} <= ${at}`))
    .run().changes;
}

export function ensureProfileMemory(db: DB, aboutMe: string): MemoryClaim | null {
  const claim = aboutMe.trim();
  if (!claim) return null;
  return createMemory(
    db,
    {
      memoryClass: 'identity_fact',
      claim,
      sensitivity: 'normal',
      evidence: [
        {
          sourceType: 'manual',
          sourceId: 'settings:aiAboutMe',
          title: 'Imported profile summary',
          excerpt: claim,
          deepLink: '/settings',
        },
      ],
    },
    { status: 'confirmed', confidence: 1 },
  );
}

const SENSITIVE_PATTERN = /\b(health|medical|diagnos|religion|politic|sexual|password|credential|bank|salary|trauma)\b|(?:صح[ةي]|مرض|دين|سياس|راتب|بنك)/iu;

export function inferExplicitMemory(message: string): { action: 'remember' | 'forget'; claim: string; memoryClass: MemoryClass; sensitive: boolean } | null {
  const remember = message.match(/^\s*(?:remember(?:\s+that|\s+this)?|تذكّر(?:\s+أن)?|تذكر(?:\s+أن)?)\s*[:,-]?\s*(.+)$/iu);
  const forget = message.match(/^\s*(?:forget(?:\s+that|\s+this)?|انسَ|انسى)\s*[:,-]?\s*(.+)$/iu);
  const match = remember ?? forget;
  if (!match?.[1]?.trim()) return null;
  const claim = match[1].trim();
  const lower = claim.toLocaleLowerCase();
  const memoryClass: MemoryClass =
    /\bprefer|like|أفضل|افضل|أحب|احب/u.test(lower)
      ? 'preference'
      : /\bgoal|هدفي|هدف/u.test(lower)
        ? 'active_goal'
        : /\broutine|every day|عادة|يومي/u.test(lower)
          ? 'routine'
          : /\bdecid|قررت|قرار/u.test(lower)
            ? 'decision'
            : 'identity_fact';
  return { action: remember ? 'remember' : 'forget', claim, memoryClass, sensitive: SENSITIVE_PATTERN.test(claim) };
}

/** Conservative automatic candidates: only first-person statements, never silently confirmed. */
export function extractHeuristicMemoryCandidates(db: DB, source: EvidenceRef): MemoryClaim[] {
  const sentences = source.excerpt
    .split(/(?<=[.!؟\n])\s+/u)
    .map((value) => value.trim())
    .filter((value) => value.length >= 12 && value.length <= 320);
  const pattern = /^(?:i (?:am|prefer|value|need|cannot|can't|always|usually|want to)|my (?:goal|priority|routine)|أنا |انا |أفضّل|أفضل|احب|أحب|هدفي|أحتاج|احتاج)/iu;
  return sentences
    .filter((sentence) => pattern.test(sentence))
    .slice(0, 5)
    .map((claim) =>
      createMemory(
        db,
        {
          memoryClass: /\bprefer|أفضّل|أفضل|احب|أحب/iu.test(claim) ? 'preference' : /\bgoal|هدفي/iu.test(claim) ? 'active_goal' : 'identity_fact',
          claim,
          sensitivity: SENSITIVE_PATTERN.test(claim) ? 'sensitive' : 'normal',
          evidence: [source],
        },
        { status: 'candidate', confidence: 0.62 },
      ),
    );
}

export function activeMemoryRows(db: DB): Array<typeof memoryClaims.$inferSelect> {
  expireMemories(db);
  return db
    .select()
    .from(memoryClaims)
    .where(orStatus(memoryClaims.status, ['confirmed', 'candidate']))
    .all();
}

function orStatus(column: typeof memoryClaims.status, statuses: string[]) {
  return inArray(column, statuses);
}

export function parseStringArray(value: string | null | undefined): string[] {
  return jsonArray(value);
}
