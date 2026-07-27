import { inArray, isNull } from 'drizzle-orm';
import type { ContextPack, EvidenceRef, KnowledgeRecord, KnowledgeSourceType, MemoryClaim } from '@timeblock/shared';
import type { DB } from '../db/client.js';
import { knowledgeRecords, memoryClaims, notes } from '../db/schema.js';
import { aiConfigured } from '../ai/client.js';
import { embedQuery, retrieveChunksForChat } from '../notes/embeddings.js';
import { expandNeighbors, noteExcerpt } from '../notes/graph/retrieval.js';
import { evidenceByIds, memoryToDto, sourceDeepLink } from './foundation.js';
import { nowUtcIso } from '../config.js';
import { semanticKnowledgeScores } from './indexing.js';

function tokens(value: string): string[] {
  return [
    ...new Set(
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}]{2,}/gu) ?? [],
    ),
  ];
}

function lexicalScore(queryTokens: string[], title: string, excerpt: string): number {
  if (!queryTokens.length) return 0;
  const titleLower = title.toLocaleLowerCase();
  const excerptLower = excerpt.toLocaleLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (titleLower.includes(token)) score += 4;
    if (excerptLower.includes(token)) score += 1;
  }
  return score / Math.max(1, queryTokens.length);
}

function recencyScore(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const ageDays = Math.max(0, (now - Date.parse(value)) / 86_400_000);
  return Math.exp(-ageDays / 90);
}

function sourceDiversityCap(records: Array<{ row: typeof knowledgeRecords.$inferSelect; score: number }>, limit: number) {
  const counts = new Map<string, number>();
  const selected: typeof records = [];
  for (const candidate of records) {
    const count = counts.get(candidate.row.sourceType) ?? 0;
    if (count >= 5) continue;
    selected.push(candidate);
    counts.set(candidate.row.sourceType, count + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

function toRecord(row: typeof knowledgeRecords.$inferSelect): KnowledgeRecord {
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

function recordToEvidence(record: KnowledgeRecord): EvidenceRef {
  return {
    id: record.id,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    title: record.title,
    excerpt: record.excerpt.slice(0, 1_200),
    occurredAt: record.occurredAt,
    deepLink: sourceDeepLink(record.sourceType, record.sourceId),
    contentHash: record.sourceVersion,
  };
}

export async function buildContextPack(
  db: DB,
  query: string,
  options: { embeddingModel: string; focusNoteIds?: string[]; maxRecords?: number },
): Promise<ContextPack> {
  const maxRecords = options.maxRecords ?? 18;
  const queryTokens = tokens(query);
  const rows = db.select().from(knowledgeRecords).where(isNull(knowledgeRecords.deletedAtUtc)).all();
  const scoreById = new Map<string, number>();
  const now = Date.now();
  for (const row of rows) {
    const score = lexicalScore(queryTokens, row.title, row.excerpt) * 2 + recencyScore(row.occurredAtUtc ?? row.updatedAtUtc, now);
    scoreById.set(row.id, score);
  }

  for (const id of options.focusNoteIds ?? []) scoreById.set(`note:${id}`, (scoreById.get(`note:${id}`) ?? 0) + 20);

  if (aiConfigured() && !(options.focusNoteIds?.length)) {
    try {
      const vector = await embedQuery(db, options.embeddingModel, query);
      for (const [recordId, score] of semanticKnowledgeScores(db, vector, 30)) {
        scoreById.set(recordId, (scoreById.get(recordId) ?? 0) + score * 8);
      }
      const semantic = retrieveChunksForChat(db, vector, 10);
      for (const hit of semantic) scoreById.set(`note:${hit.noteId}`, (scoreById.get(`note:${hit.noteId}`) ?? 0) + hit.score * 8);
      const neighbours = expandNeighbors(
        db,
        semantic.slice(0, 4).map((hit) => hit.noteId),
        6,
      );
      for (const noteId of neighbours) scoreById.set(`note:${noteId}`, (scoreById.get(`note:${noteId}`) ?? 0) + 1.5);
    } catch {
      // Semantic retrieval is an optional layer. Structured and lexical retrieval remain available offline.
    }
  }

  const ranked = sourceDiversityCap(
    rows
      .map((row) => ({ row, score: scoreById.get(row.id) ?? 0 }))
      .filter(({ score }) => score > 0.15)
      .sort((a, b) => b.score - a.score),
    maxRecords,
  );
  const records = ranked.map(({ row }) => toRecord(row));
  const evidence = records.map(recordToEvidence);

  const memoryRows = db
    .select()
    .from(memoryClaims)
    .where(inArray(memoryClaims.status, ['confirmed', 'candidate']))
    .all()
    .map((row) => ({ row, score: lexicalScore(queryTokens, row.claim, '') + recencyScore(row.updatedAtUtc, now) * 0.25 }))
    .sort((a, b) => b.score - a.score);
  const confirmedMemories: MemoryClaim[] = [];
  const candidateMemories: MemoryClaim[] = [];
  for (const item of memoryRows) {
    if (item.score <= 0.05 && memoryRows.length > 8) continue;
    const dto = memoryToDto(db, item.row);
    if (dto.status === 'confirmed') confirmedMemories.push(dto);
    else candidateMemories.push(dto);
    if (confirmedMemories.length >= 8 && candidateMemories.length >= 4) break;
  }

  return {
    query,
    records,
    evidence,
    confirmedMemories: confirmedMemories.slice(0, 8),
    candidateMemories: candidateMemories.slice(0, 4),
    generatedAt: nowUtcIso(),
  };
}

export function refreshFocusedNoteEvidence(db: DB, ids: string[]): EvidenceRef[] {
  if (!ids.length) return [];
  const titleById = new Map(
    db
      .select({ id: notes.id, title: notes.title })
      .from(notes)
      .where(inArray(notes.id, ids))
      .all()
      .map((row) => [row.id, row.title]),
  );
  return ids.flatMap((id) => {
    if (!titleById.has(id)) return [];
    const evidence = evidenceByIds(db, [`note:${id}`])[0];
    return [
      evidence ?? {
        id: `note:${id}`,
        sourceType: 'note' as const,
        sourceId: id,
        title: titleById.get(id)!,
        excerpt: noteExcerpt(db, id, 1_200),
        occurredAt: null,
        deepLink: sourceDeepLink('note', id),
        contentHash: null,
      },
    ];
  });
}
