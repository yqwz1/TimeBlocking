import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { indexVersions, knowledgeEmbeddings, knowledgeRecords } from '../db/schema.js';
import { ModelGateway } from './modelGateway.js';
import { nowUtcIso } from '../config.js';
import { cosineSimilarity } from '../notes/embeddings.js';

const DIMENSIONS = 768;

export async function buildKnowledgeEmbeddingVersion(
  db: DB,
  model: string,
  onCheckpoint?: (checkpoint: Record<string, unknown>, progress: number) => void,
): Promise<string> {
  const id = randomUUID();
  const now = nowUtcIso();
  db.insert(indexVersions)
    .values({ id, kind: 'personal_knowledge', model, dimensions: DIMENSIONS, status: 'building', recordCount: 0, createdAtUtc: now })
    .run();
  const rows = db.select().from(knowledgeRecords).where(isNull(knowledgeRecords.deletedAtUtc)).all();
  try {
    for (let offset = 0; offset < rows.length; offset += 16) {
      const batch = rows.slice(offset, offset + 16);
      const vectors = (await new ModelGateway(db).embedCached(
        model,
        batch.map((row) => `${row.sourceType}: ${row.title}\n\n${row.excerpt}`),
        DIMENSIONS,
        'embedding',
      )).value;
      for (let index = 0; index < batch.length; index++) {
        const row = batch[index]!;
        const vector = vectors[index];
        if (!vector?.length) continue;
        db.insert(knowledgeEmbeddings)
          .values({
            indexVersionId: id,
            recordId: row.id,
            contentHash: row.contentHash ?? row.sourceVersion,
            vector: JSON.stringify(vector),
            createdAtUtc: nowUtcIso(),
          })
          .run();
      }
      onCheckpoint?.({ offset: offset + batch.length, total: rows.length, indexVersionId: id }, rows.length ? (offset + batch.length) / rows.length : 1);
    }
    const activated = nowUtcIso();
    db.update(indexVersions).set({ status: 'retired' }).where(and(eq(indexVersions.kind, 'personal_knowledge'), eq(indexVersions.status, 'active'))).run();
    db.update(indexVersions)
      .set({ status: 'active', recordCount: rows.length, activatedAtUtc: activated })
      .where(eq(indexVersions.id, id))
      .run();
    return id;
  } catch (error) {
    db.update(indexVersions).set({ status: 'failed' }).where(eq(indexVersions.id, id)).run();
    throw error;
  }
}

export function activeKnowledgeIndex(db: DB) {
  return db
    .select()
    .from(indexVersions)
    .where(and(eq(indexVersions.kind, 'personal_knowledge'), eq(indexVersions.status, 'active')))
    .get();
}

export function semanticKnowledgeScores(db: DB, queryVector: number[], limit = 30): Map<string, number> {
  const active = activeKnowledgeIndex(db);
  if (!active) return new Map();
  const scored = db
    .select()
    .from(knowledgeEmbeddings)
    .where(eq(knowledgeEmbeddings.indexVersionId, active.id))
    .all()
    .flatMap((row) => {
      try {
        const vector = JSON.parse(row.vector) as number[];
        return [{ id: row.recordId, score: cosineSimilarity(queryVector, vector) }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return new Map(scored.map((item) => [item.id, item.score]));
}

export function listKnowledgeIndexes(db: DB) {
  return db.select().from(indexVersions).all().sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc));
}
