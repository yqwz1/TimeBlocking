import Graph from 'graphology';
import pagerank from 'graphology-metrics/centrality/pagerank.js';
import betweenness from 'graphology-metrics/centrality/betweenness.js';
import { isNotNull } from 'drizzle-orm';
import { noteLinks, notes } from '../../db/schema.js';
import type { DB } from '../../db/client.js';

export interface NodeMetric {
  noteId: string;
  degree: number;
  /** Normalized so the highest-ranked note ≈ 1 — keeps node-size scaling stable across vault sizes. */
  pagerank: number;
  betweenness: number;
}

/**
 * Degree / PageRank / betweenness over the EXPLICIT-link graph only (resolved `[[wikilinks]]`).
 * Centrality intentionally reflects deliberate links, not semantic/tag similarity — betweenness here
 * is what surfaces true "bridge" notes (spec §8). Pure DB read; safe to run off the request path.
 */
export function computeMetrics(db: DB): Map<string, NodeMetric> {
  const noteIds = db.select({ id: notes.id }).from(notes).all().map((r) => r.id);
  const g = new Graph({ type: 'undirected' });
  for (const id of noteIds) g.addNode(id);

  const links = db
    .select({ s: noteLinks.sourceId, t: noteLinks.targetId })
    .from(noteLinks)
    .where(isNotNull(noteLinks.targetId))
    .all();
  for (const l of links) {
    if (!l.t || l.s === l.t || !g.hasNode(l.s) || !g.hasNode(l.t)) continue;
    if (g.hasEdge(l.s, l.t)) g.updateEdgeAttribute(l.s, l.t, 'weight', (w) => (typeof w === 'number' ? w : 1) + 1);
    else g.addEdge(l.s, l.t, { weight: 1 });
  }

  const pr: Record<string, number> = g.order > 0 ? pagerank(g) : {};
  const bt: Record<string, number> = g.size > 0 ? betweenness(g) : {};
  const maxPr = Math.max(1e-9, ...Object.values(pr));

  const out = new Map<string, NodeMetric>();
  for (const id of noteIds) {
    out.set(id, {
      noteId: id,
      degree: g.hasNode(id) ? g.degree(id) : 0,
      pagerank: (pr[id] ?? 0) / maxPr,
      betweenness: bt[id] ?? 0,
    });
  }
  return out;
}
