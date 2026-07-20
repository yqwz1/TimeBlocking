import { isNotNull } from 'drizzle-orm';
import type { NoteGraphEdgeType, Settings } from '@timeblock/shared';
import { noteChunks, noteLinks, notes } from '../../db/schema.js';
import type { DB } from '../../db/client.js';
import { cosineSimilarity } from '../embeddings.js';

export interface RawEdge {
  source: string;
  target: string;
  type: NoteGraphEdgeType;
  weight: number;
}

// Delimiter for the unordered-pair dedup key only (never parsed back). '|' is illegal in a Windows
// file path, so it cannot collide with a note id. Endpoints are always carried alongside the key.
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Keeps only the top-K strongest entries per node, unioned across both endpoints, to bound edge count. */
function topKPerNode(scored: Array<{ a: string; b: string; score: number }>, k: number): Set<string> {
  const perNode = new Map<string, Array<{ score: number; key: string }>>();
  for (const s of scored) {
    const key = pairKey(s.a, s.b);
    for (const self of [s.a, s.b]) {
      const list = perNode.get(self) ?? [];
      list.push({ score: s.score, key });
      perNode.set(self, list);
    }
  }
  const keep = new Set<string>();
  for (const list of perNode.values()) {
    list.sort((x, y) => y.score - x.score);
    for (const item of list.slice(0, k)) keep.add(item.key);
  }
  return keep;
}

const TAG_EDGES_PER_NODE = 6; // cap to stop shared common tags (e.g. #project) forming dense cliques

/**
 * Builds the three G2 edge layers. Pure DB read (semantic uses already-stored chunk vectors, no API call),
 * so it is offline-safe and runs off the request path. Semantic/tag edges are suppressed for any pair that
 * already has an explicit link, so a faint edge never duplicates a solid one.
 */
export function buildTypedEdges(db: DB, settings: Settings): RawEdge[] {
  const edges: RawEdge[] = [];

  // ── Explicit: resolved [[wikilinks]], undirected, weight = link count between the pair. ──
  const links = db
    .select({ s: noteLinks.sourceId, t: noteLinks.targetId })
    .from(noteLinks)
    .where(isNotNull(noteLinks.targetId))
    .all();
  const explicitInfo = new Map<string, { source: string; target: string; weight: number }>();
  for (const l of links) {
    if (!l.t || l.s === l.t) continue;
    const k = pairKey(l.s, l.t);
    const existing = explicitInfo.get(k);
    if (existing) existing.weight += 1;
    else explicitInfo.set(k, { source: l.s, target: l.t, weight: 1 });
  }
  const explicitPairs = new Set(explicitInfo.keys());
  for (const info of explicitInfo.values()) edges.push({ ...info, type: 'explicit' });

  // ── Semantic: best chunk-pair cosine per note pair, above threshold, top-K per node. ──
  if (settings.graphSemanticTopK > 0) {
    const rows = db.select({ noteId: noteChunks.noteId, embedding: noteChunks.embedding }).from(noteChunks).all();
    const byNote = new Map<string, number[][]>();
    for (const r of rows) {
      let v: number[];
      try {
        v = JSON.parse(r.embedding);
      } catch {
        continue;
      }
      if (!Array.isArray(v) || v.length === 0) continue;
      const arr = byNote.get(r.noteId) ?? [];
      arr.push(v);
      byNote.set(r.noteId, arr);
    }
    const ids = [...byNote.keys()];
    const scored: Array<{ a: string; b: string; score: number }> = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const A = byNote.get(ids[i])!;
        const B = byNote.get(ids[j])!;
        let best = 0;
        for (const va of A) for (const vb of B) {
          const s = cosineSimilarity(va, vb);
          if (s > best) best = s;
        }
        if (best >= settings.graphSemanticThreshold) scored.push({ a: ids[i], b: ids[j], score: best });
      }
    }
    const keep = topKPerNode(scored, settings.graphSemanticTopK);
    for (const s of scored) {
      const k = pairKey(s.a, s.b);
      if (!keep.has(k) || explicitPairs.has(k)) continue;
      edges.push({ source: s.a, target: s.b, type: 'semantic', weight: s.score });
    }
  }

  // ── Tag co-occurrence: shared-tag count above the min, capped per node. ──
  const tagRows = db.select({ id: notes.id, tags: notes.tags }).from(notes).all();
  const noteTags = tagRows
    .map((r) => {
      let t: string[] = [];
      try {
        t = JSON.parse(r.tags);
      } catch {
        t = [];
      }
      return { id: r.id, tags: new Set(t) };
    })
    .filter((n) => n.tags.size > 0);
  const tagScored: Array<{ a: string; b: string; score: number }> = [];
  for (let i = 0; i < noteTags.length; i++) {
    for (let j = i + 1; j < noteTags.length; j++) {
      let shared = 0;
      for (const t of noteTags[i].tags) if (noteTags[j].tags.has(t)) shared++;
      if (shared >= settings.graphTagCoocMin) tagScored.push({ a: noteTags[i].id, b: noteTags[j].id, score: shared });
    }
  }
  const tagKeep = topKPerNode(tagScored, TAG_EDGES_PER_NODE);
  for (const s of tagScored) {
    const k = pairKey(s.a, s.b);
    if (!tagKeep.has(k) || explicitPairs.has(k)) continue;
    edges.push({ source: s.a, target: s.b, type: 'tag', weight: s.score });
  }

  return edges;
}
