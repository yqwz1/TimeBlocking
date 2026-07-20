import { and, eq, isNotNull, or } from 'drizzle-orm';
import type { Settings, SuggestedEdgeDTO } from '@timeblock/shared';
import { noteChunks, noteLinks, notes, suggestedEdgeDismissals } from '../../db/schema.js';
import type { DB } from '../../db/client.js';
import { getSettings } from '../../settings.js';
import { cosineSimilarity } from '../embeddings.js';
import { readNoteFile, writeNoteFile } from '../vault.js';
import { indexNote } from '../indexer.js';
import { triggerGraphRecompute } from './recompute.js';

/**
 * The Graph — G6 §7 (suggested edges). Proposes high-similarity note pairs that are NOT already linked and
 * NOT dismissed, as ghost edges. Accept writes a real [[wikilink]] into the source note (approval = the click);
 * Dismiss persists so the pair is never re-suggested. The graph never writes to notes without an Accept.
 */

// '|' is illegal in a Windows path, so it can never collide with a note id — safe unordered-pair key.
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const SUGGESTIONS_PER_NODE = 2; // keep the ghost layer legible — only a note's strongest couple of proposals

/** Top embedding-similar note pairs above the suggest threshold that are neither linked nor dismissed. */
export function computeSuggestions(db: DB, settings: Settings): SuggestedEdgeDTO[] {
  const threshold = settings.graphSuggestThreshold;

  // Already-linked pairs (either direction) — never suggest what a wikilink already connects.
  const linked = new Set<string>();
  for (const l of db.select({ s: noteLinks.sourceId, t: noteLinks.targetId }).from(noteLinks).where(isNotNull(noteLinks.targetId)).all()) {
    if (l.t) linked.add(pairKey(l.s, l.t));
  }
  const dismissed = new Set(db.select().from(suggestedEdgeDismissals).all().map((d) => pairKey(d.source, d.target)));

  // Chunk vectors grouped per note.
  const byNote = new Map<string, number[][]>();
  for (const r of db.select({ noteId: noteChunks.noteId, embedding: noteChunks.embedding }).from(noteChunks).all()) {
    let v: number[];
    try {
      v = JSON.parse(r.embedding);
    } catch {
      continue;
    }
    if (!Array.isArray(v) || v.length === 0) continue;
    (byNote.get(r.noteId) ?? byNote.set(r.noteId, []).get(r.noteId)!).push(v);
  }

  const ids = [...byNote.keys()];
  const scored: Array<{ a: string; b: string; score: number }> = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const key = pairKey(ids[i], ids[j]);
      if (linked.has(key) || dismissed.has(key)) continue;
      let best = 0;
      for (const va of byNote.get(ids[i])!) for (const vb of byNote.get(ids[j])!) {
        const s = cosineSimilarity(va, vb);
        if (s > best) best = s;
      }
      if (best >= threshold) scored.push({ a: ids[i], b: ids[j], score: best });
    }
  }

  // Keep only each node's strongest few proposals.
  const perNodeCount = new Map<string, number>();
  scored.sort((x, y) => y.score - x.score);
  const titleById = new Map(db.select({ id: notes.id, title: notes.title }).from(notes).all().map((r) => [r.id, r.title]));
  const out: SuggestedEdgeDTO[] = [];
  for (const s of scored) {
    if ((perNodeCount.get(s.a) ?? 0) >= SUGGESTIONS_PER_NODE || (perNodeCount.get(s.b) ?? 0) >= SUGGESTIONS_PER_NODE) continue;
    perNodeCount.set(s.a, (perNodeCount.get(s.a) ?? 0) + 1);
    perNodeCount.set(s.b, (perNodeCount.get(s.b) ?? 0) + 1);
    out.push({ source: s.a, sourceTitle: titleById.get(s.a) ?? s.a, target: s.b, targetTitle: titleById.get(s.b) ?? s.b, confidence: s.score });
  }
  return out;
}

/** Persists a dismissal (order-independent) so the pair is never re-suggested. */
export function dismissSuggestion(db: DB, source: string, target: string): void {
  const [a, b] = source < target ? [source, target] : [target, source];
  db.insert(suggestedEdgeDismissals)
    .values({ source: a, target: b, dismissedAtUtc: new Date().toISOString() })
    .onConflictDoNothing()
    .run();
}

/**
 * Accept: inserts `[[Target Title]]` into the source note under a `## Related` heading (created if absent),
 * then reindexes so the pair becomes a solid explicit edge. Idempotent — a link already present is a no-op.
 */
export async function acceptSuggestion(db: DB, root: string, source: string, target: string): Promise<{ ok: boolean; error?: string }> {
  const file = await readNoteFile(root, source);
  if (!file) return { ok: false, error: 'source note not found' };
  const targetRow = db.select({ title: notes.title }).from(notes).where(eq(notes.id, target)).get();
  const targetTitle = targetRow?.title ?? target.replace(/\.md$/i, '').split('/').pop() ?? target;
  const link = `[[${targetTitle}]]`;
  if (file.content.includes(link)) return { ok: true }; // already linked — nothing to write

  const trimmed = file.content.replace(/\s+$/, '');
  const relatedHeading = /^##\s+Related\s*$/im;
  let next: string;
  if (relatedHeading.test(trimmed)) {
    // Append a bullet right after the existing "## Related" heading block.
    next = trimmed.replace(relatedHeading, (h) => `${h}\n- ${link}`);
  } else {
    next = `${trimmed}\n\n## Related\n- ${link}\n`;
  }

  const settings = getSettings(db);
  await writeNoteFile(root, source, next, settings.notesSnapshotRetention);
  await indexNote(db, root, source);
  triggerGraphRecompute(db);
  return { ok: true };
}
