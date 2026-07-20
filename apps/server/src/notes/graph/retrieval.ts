import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { conceptMentions, graphEdges, noteChunks } from '../../db/schema.js';
import type { DB } from '../../db/client.js';

/**
 * GraphRAG retrieval (G4). Local questions expand seed notes to their 1-hop graph neighbourhood (linked +
 * semantically/tag-connected notes, plus notes sharing an extracted concept). Global questions are routed to
 * the community-summary path instead. Pure DB reads — no API calls.
 */

// Heuristic classifier: broad "map of the vault" questions → global (answered from community summaries).
const GLOBAL_PATTERNS =
  /\b(themes?|topics?|overview|summar(y|ise|ize|ies)|main (ideas?|things?|areas?)|big picture|what am i (working|thinking|focus|neglect)|neglect|forgot|ignoring|across (my|the|all)|in general|overall|what have i been|clusters?|categories)\b/i;

export function classifyQuestion(message: string): 'local' | 'global' {
  return GLOBAL_PATTERNS.test(message) ? 'global' : 'local';
}

/**
 * The 1-hop neighbours of `seedIds`: notes joined by a cached graph edge, plus notes sharing an extracted
 * concept. Excludes the seeds themselves and caps the result so context stays bounded.
 */
export function expandNeighbors(db: DB, seedIds: string[], max: number): string[] {
  if (seedIds.length === 0) return [];
  const seedSet = new Set(seedIds);
  const score = new Map<string, number>();
  const bump = (id: string, by: number) => {
    if (seedSet.has(id)) return;
    score.set(id, (score.get(id) ?? 0) + by);
  };

  // Cached typed edges (explicit/semantic/tag) — both directions.
  const edgeRows = db
    .select({ source: graphEdges.source, target: graphEdges.target, type: graphEdges.type, weight: graphEdges.weight })
    .from(graphEdges)
    .where(or(inArray(graphEdges.source, seedIds), inArray(graphEdges.target, seedIds)))
    .all();
  for (const e of edgeRows) {
    const other = seedSet.has(e.source) ? e.target : e.source;
    bump(other, e.type === 'explicit' ? 3 : e.type === 'semantic' ? 2 : 1);
  }

  // Shared extracted concepts (the concept bridge — notes about the same thing even if never linked).
  const seedConcepts = db
    .select({ conceptId: conceptMentions.conceptId })
    .from(conceptMentions)
    .where(inArray(conceptMentions.noteId, seedIds))
    .all()
    .map((r) => r.conceptId);
  if (seedConcepts.length) {
    const uniqueConcepts = [...new Set(seedConcepts)];
    const coMentions = db
      .select({ noteId: conceptMentions.noteId })
      .from(conceptMentions)
      .where(inArray(conceptMentions.conceptId, uniqueConcepts))
      .all();
    for (const r of coMentions) bump(r.noteId, 2);
  }

  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([id]) => id);
}

/** A short representative excerpt for a note — its first embedded chunk, else its FTS body — for neighbour context. */
export function noteExcerpt(db: DB, noteId: string, maxChars: number): string {
  const chunk = db
    .select({ text: noteChunks.text })
    .from(noteChunks)
    .where(and(eq(noteChunks.noteId, noteId), eq(noteChunks.chunkIndex, 0)))
    .get();
  if (chunk?.text) return chunk.text.slice(0, maxChars);
  const row = db.get<{ body: string }>(sql`SELECT body FROM notes_fts WHERE id = ${noteId} LIMIT 1`);
  return row?.body ? row.body.slice(0, maxChars) : '';
}
