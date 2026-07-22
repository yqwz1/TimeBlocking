import { eq, sql } from 'drizzle-orm';
import type { RelatedNoteDTO } from '@timeblock/shared';
import { noteChunks, notes } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { embedContent } from '../ai/client.js';
import { readNoteFile } from './vault.js';
import { hashContent, parseNote } from './parser.js';

const MAX_CHUNK_CHARS = 1000;

/** Groups paragraphs into ~1000-char chunks, hard-splitting any single paragraph that's still too long. */
export function chunkText(body: string): string[] {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if (current && current.length + p.length + 2 > MAX_CHUNK_CHARS) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${p}` : p;
    while (current.length > MAX_CHUNK_CHARS * 1.5) {
      chunks.push(current.slice(0, MAX_CHUNK_CHARS));
      current = current.slice(MAX_CHUNK_CHARS);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// Truncated via Gemini's Matryoshka representation learning support — keeps chunk storage and
// brute-force cosine cost small without a meaningful quality hit at this vault's scale.
const EMBEDDING_DIMENSIONS = 768;

/** Embeds a batch of texts in one call. `title` gives each chunk surrounding context for a better vector. */
async function embedTexts(model: string, title: string, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  return embedContent(
    model,
    texts.map((t) => `Note: ${title}\n\n${t}`),
    EMBEDDING_DIMENSIONS,
  );
}

/** Embeds a bare query string (no note-title context to prepend). */
export async function embedQuery(model: string, query: string): Promise<number[]> {
  return (await embedContent(model, [query], EMBEDDING_DIMENSIONS))[0] ?? [];
}

function existingChunkHash(db: DB, noteId: string): string | null {
  const row = db.select({ contentHash: noteChunks.contentHash }).from(noteChunks).where(eq(noteChunks.noteId, noteId)).limit(1).get();
  return row?.contentHash ?? null;
}

/** Re-chunks and re-embeds a note only if its BODY changed since the last embed — a paid API call, so this must
 *  stay a no-op both on repeat saves of unchanged content and on frontmatter-only edits (e.g. pinning), which
 *  is why this hashes the parsed body rather than reusing the whole-file hash the FTS index tracks.
 *  Silently does nothing if AI isn't enabled/configured. */
export async function embedNoteIfStale(db: DB, root: string, id: string, aiEnabled: boolean, embeddingModel: string): Promise<void> {
  if (!aiEnabled) return;
  const file = await readNoteFile(root, id);
  if (!file) return;
  const parsed = parseNote(id, file.content);
  const bodyHash = hashContent(parsed.body);
  if (existingChunkHash(db, id) === bodyHash) return;

  const pieces = chunkText(parsed.body);
  db.delete(noteChunks).where(eq(noteChunks.noteId, id)).run();
  if (pieces.length === 0) return;

  let vectors: number[][];
  try {
    vectors = await embedTexts(embeddingModel, parsed.title, pieces);
  } catch {
    // Offline or API error — leave the note unembedded; it'll retry on the next save/reindex.
    return;
  }
  for (let i = 0; i < pieces.length; i++) {
    if (!vectors[i]?.length) continue;
    db.insert(noteChunks)
      .values({ noteId: id, chunkIndex: i, text: pieces[i], embedding: JSON.stringify(vectors[i]), contentHash: bodyHash })
      .run();
  }
}

/** Full rebuild of the embedding cache — ignores the staleness check, so use sparingly (costs one API call per note). */
export async function reembedAllNotes(db: DB, root: string, aiEnabled: boolean, embeddingModel: string): Promise<number> {
  if (!aiEnabled) return 0;
  db.delete(noteChunks).run();
  const rows = db.select({ id: notes.id }).from(notes).all();
  let count = 0;
  for (const row of rows) {
    // Force re-embedding: the chunk table was just wiped, so the staleness check inside will always miss.
    await embedNoteIfStale(db, root, row.id, aiEnabled, embeddingModel);
    count++;
  }
  return count;
}

interface ChunkRow {
  noteId: string;
  text: string;
  embedding: string;
}

function allChunks(db: DB): ChunkRow[] {
  return db.select({ noteId: noteChunks.noteId, text: noteChunks.text, embedding: noteChunks.embedding }).from(noteChunks).all();
}

export interface SemanticHit {
  id: string;
  score: number;
  snippet: string;
}

/** Best-chunk semantic match per note, ranked descending. */
export function semanticSearch(db: DB, queryVector: number[], limit: number): SemanticHit[] {
  const best = new Map<string, SemanticHit>();
  for (const row of allChunks(db)) {
    let vec: number[];
    try {
      vec = JSON.parse(row.embedding);
    } catch {
      continue;
    }
    const score = cosineSimilarity(queryVector, vec);
    const existing = best.get(row.noteId);
    if (!existing || score > existing.score) best.set(row.noteId, { id: row.noteId, score, snippet: row.text.slice(0, 160) });
  }
  return Array.from(best.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Top-N notes whose closest chunk best matches any chunk of `noteId` — excludes the note itself. */
export function relatedNotes(db: DB, noteId: string, limit: number): RelatedNoteDTO[] {
  const ownChunks = db.select({ embedding: noteChunks.embedding }).from(noteChunks).where(eq(noteChunks.noteId, noteId)).all();
  if (ownChunks.length === 0) return [];
  const ownVectors: number[][] = [];
  for (const c of ownChunks) {
    try {
      ownVectors.push(JSON.parse(c.embedding));
    } catch {
      // skip corrupt row
    }
  }
  if (ownVectors.length === 0) return [];

  const best = new Map<string, number>();
  for (const row of allChunks(db)) {
    if (row.noteId === noteId) continue;
    let vec: number[];
    try {
      vec = JSON.parse(row.embedding);
    } catch {
      continue;
    }
    let maxScore = 0;
    for (const ownVec of ownVectors) maxScore = Math.max(maxScore, cosineSimilarity(ownVec, vec));
    const existing = best.get(row.noteId);
    if (existing === undefined || maxScore > existing) best.set(row.noteId, maxScore);
  }

  const titleById = new Map(db.select({ id: notes.id, title: notes.title }).from(notes).all().map((r) => [r.id, r.title]));
  return Array.from(best.entries())
    .map(([id, score]) => ({ id, title: titleById.get(id) ?? id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Top-K chunks for a query, each labeled with its note — the retrieval step for Vault Chat. */
export function retrieveChunksForChat(db: DB, queryVector: number[], limit: number): { noteId: string; title: string; text: string; score: number }[] {
  const titleById = new Map(db.select({ id: notes.id, title: notes.title }).from(notes).all().map((r) => [r.id, r.title]));
  const scored = allChunks(db)
    .map((row) => {
      let vec: number[];
      try {
        vec = JSON.parse(row.embedding);
      } catch {
        return null;
      }
      return { noteId: row.noteId, title: titleById.get(row.noteId) ?? row.noteId, text: row.text, score: cosineSimilarity(queryVector, vec) };
    })
    .filter((v): v is { noteId: string; title: string; text: string; score: number } => v !== null);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Row count, exposed for the Settings "index freshness" indicator. */
export function chunkCount(db: DB): number {
  return db.get<{ n: number }>(sql`SELECT COUNT(*) as n FROM note_chunks`)?.n ?? 0;
}
