import { sql } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { getSettings } from '../../settings.js';
import { graphEdges, nodeMetrics } from '../../db/schema.js';
import { computeMetrics } from './metrics.js';
import { buildTypedEdges } from './edges.js';
import { computeCommunities, persistCommunities, triggerCommunityNaming } from './communities.js';

/** Open `- [ ]` checkbox count per note, read from the FTS body (no file IO). */
function countOpenTasks(db: DB): Map<string, number> {
  const rows = db.all<{ id: string; body: string }>(sql`SELECT id, body FROM notes_fts`);
  const out = new Map<string, number>();
  for (const r of rows) {
    const matches = r.body ? r.body.match(/^\s*[-*]\s+\[ \]/gm) : null;
    out.set(r.id, matches ? matches.length : 0);
  }
  return out;
}

/**
 * Full rebuild of the graph cache (`node_metrics` + `graph_edges`) from the index. Cheap and pure-DB
 * (no network, offline-safe). Atomic via a transaction so `/notes/graph` never reads a half-written cache.
 */
export function recomputeGraph(db: DB): void {
  const settings = getSettings(db);
  const metrics = computeMetrics(db);
  const openTasks = countOpenTasks(db);
  const edges = buildTypedEdges(db, settings);
  // G4: hierarchical communities over the combined note+concept graph — colours nodes and backs global GraphRAG.
  const community = computeCommunities(db, edges);
  const nowIso = new Date().toISOString();

  db.transaction((tx) => {
    tx.delete(nodeMetrics).run();
    for (const m of metrics.values()) {
      tx.insert(nodeMetrics)
        .values({
          noteId: m.noteId,
          degree: m.degree,
          pagerank: m.pagerank,
          betweenness: m.betweenness,
          communityId: community.noteToCoarse.get(m.noteId) ?? null,
          openTasks: openTasks.get(m.noteId) ?? 0,
          updatedAtUtc: nowIso,
        })
        .run();
    }
    tx.delete(graphEdges).run();
    for (const e of edges) {
      tx.insert(graphEdges).values({ source: e.source, target: e.target, type: e.type, weight: e.weight, status: 'explicit' }).run();
    }
    persistCommunities(tx as unknown as DB, community.rows);
  });
}

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced, fire-and-forget graph-cache rebuild — mirrors `triggerEmbed`'s never-block-a-save contract.
 * Coalesces bursts of note writes into a single recompute ~1.5s after the last change.
 */
export function triggerGraphRecompute(db: DB): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    try {
      recomputeGraph(db);
      // Communities are now written; name any that are new/changed (AI-gated, debounced, cached). Fire-and-forget.
      triggerCommunityNaming(db);
    } catch {
      // A rebuildable cache — swallow and let the next write (or manual rebuild) retry.
    }
  }, 1500);
}
