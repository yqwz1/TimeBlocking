import { DateTime } from 'luxon';
import { eq } from 'drizzle-orm';
import type {
  BlindSpotInsightDTO,
  BridgeInsightDTO,
  DuplicateInsightDTO,
  GraphInsightsDTO,
  InsightNeighborDTO,
  OrphanInsightDTO,
  Settings,
  StaleCentralInsightDTO,
} from '@timeblock/shared';
import { communities, conceptMentions, concepts, graphEdges, nodeMetrics, noteChunks, notes } from '../../db/schema.js';
import type { DB } from '../../db/client.js';
import { cosineSimilarity } from '../embeddings.js';

/**
 * The Graph — G6 §8 (Insights panel). Every detector below is a pure DB read over the rebuildable
 * graph/embedding cache — no AI calls — so the panel works even with the AI layer disabled or offline.
 * Actions (link-to, create-note, why, open) are handled by existing endpoints on the UI side.
 */

const MAX_PER_CATEGORY = 12;
const BLIND_SPOT_MIN_NOTES = 3; // a concept in ≥3 notes with no note of its own is a genuine gap
const ORPHAN_SCAN_CAP = 80; // bound worst-case pairwise work when a vault has many unlinked notes
// Link-candidate floor for orphans — deliberately below the graph's semantic-EDGE threshold
// (which is tuned for visual edge density). Orphans want actionable candidates, not just strong ones.
const ORPHAN_MIN_SIMILARITY = 0.4;

/** Parse a JSON string[] embedding column, tolerating corrupt rows. */
function parseVec(json: string): number[] | null {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function computeInsights(db: DB, settings: Settings): GraphInsightsDTO {
  const staleDays = settings.graphFreshnessFadeDays;
  const noteRows = db.select({ id: notes.id, title: notes.title, updatedAtUtc: notes.updatedAtUtc }).from(notes).all();
  const titleById = new Map(noteRows.map((r) => [r.id, r.title] as const));
  const metrics = db.select().from(nodeMetrics).all();
  const metricById = new Map(metrics.map((m) => [m.noteId, m] as const));

  // Chunk vectors grouped per note — one scan, reused by orphans + duplicates.
  const byNote = new Map<string, number[][]>();
  for (const r of db.select({ noteId: noteChunks.noteId, embedding: noteChunks.embedding }).from(noteChunks).all()) {
    const v = parseVec(r.embedding);
    if (!v) continue;
    const list = byNote.get(r.noteId) ?? byNote.set(r.noteId, []).get(r.noteId)!;
    list.push(v);
  }
  const embeddingsReady = byNote.size > 0;

  /** Max cosine over all chunk pairs of two notes (0 if either lacks embeddings). */
  const bestSim = (a: string, b: string): number => {
    const va = byNote.get(a);
    const vb = byNote.get(b);
    if (!va || !vb) return 0;
    let best = 0;
    for (const x of va) for (const y of vb) {
      const s = cosineSimilarity(x, y);
      if (s > best) best = s;
    }
    return best;
  };

  // ── Orphans: degree-0 notes + their top semantic neighbours (link candidates). ──
  const embeddedIds = [...byNote.keys()];
  const orphanIds = noteRows
    .filter((r) => (metricById.get(r.id)?.degree ?? 0) === 0)
    .map((r) => r.id)
    .slice(0, ORPHAN_SCAN_CAP);
  const orphans: OrphanInsightDTO[] = orphanIds.map((id) => {
    const neighbors: InsightNeighborDTO[] = [];
    if (byNote.has(id)) {
      const scored = embeddedIds
        .filter((other) => other !== id)
        .map((other) => ({ id: other, title: titleById.get(other) ?? other, score: bestSim(id, other) }))
        .filter((n) => n.score >= ORPHAN_MIN_SIMILARITY)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      neighbors.push(...scored);
    }
    return { id, title: titleById.get(id) ?? id, neighbors };
  });
  // Show the most-linkable orphans first (those with a strong neighbour), then the rest.
  orphans.sort((a, b) => (b.neighbors[0]?.score ?? -1) - (a.neighbors[0]?.score ?? -1));

  // ── Blind spots: concepts mentioned in many notes but with no dedicated note. ──
  const noteTitlesLower = new Set([...titleById.values()].map((t) => t.toLowerCase()));
  const noteCountByConcept = new Map<string, number>();
  for (const m of db.select({ conceptId: conceptMentions.conceptId }).from(conceptMentions).all()) {
    noteCountByConcept.set(m.conceptId, (noteCountByConcept.get(m.conceptId) ?? 0) + 1);
  }
  const blindSpots: BlindSpotInsightDTO[] = db
    .select()
    .from(concepts)
    .all()
    .map((c) => ({ concept: c, noteCount: noteCountByConcept.get(c.id) ?? 0 }))
    .filter(({ concept, noteCount }) => {
      if (noteCount < BLIND_SPOT_MIN_NOTES) return false;
      // A note titled with the concept name OR any of its aliases counts as "already has a note".
      if (noteTitlesLower.has(concept.name.toLowerCase())) return false;
      let aliases: string[] = [];
      try {
        aliases = JSON.parse(concept.aliases);
      } catch {
        aliases = [];
      }
      return !aliases.some((a) => noteTitlesLower.has(a.toLowerCase()));
    })
    .sort((a, b) => b.noteCount - a.noteCount)
    .slice(0, MAX_PER_CATEGORY)
    .map(({ concept, noteCount }) => ({ conceptId: concept.id, name: concept.name, type: concept.type as BlindSpotInsightDTO['type'], noteCount }));

  // ── Bridges: high-betweenness notes whose explicit links span ≥2 communities. ──
  const communityLabelById = new Map(db.select({ id: communities.id, label: communities.label }).from(communities).all().map((c) => [c.id, c.label] as const));
  const neighborCommunities = new Map<string, Set<string>>(); // noteId → set of neighbour communityIds
  const communityOf = (id: string): string | null => metricById.get(id)?.communityId ?? null;
  const link = (from: string, toCommunity: string | null) => {
    if (!toCommunity) return;
    (neighborCommunities.get(from) ?? neighborCommunities.set(from, new Set()).get(from)!).add(toCommunity);
  };
  for (const e of db.select().from(graphEdges).where(eq(graphEdges.type, 'explicit')).all()) {
    link(e.source, communityOf(e.target));
    link(e.target, communityOf(e.source));
  }
  const bridges: BridgeInsightDTO[] = metrics
    .filter((m) => m.betweenness > 0)
    .map((m) => {
      const commIds = [...(neighborCommunities.get(m.noteId) ?? new Set<string>())];
      const labels = [...new Set(commIds.map((id) => communityLabelById.get(id)).filter((l): l is string => !!l))];
      return { id: m.noteId, title: titleById.get(m.noteId) ?? m.noteId, betweenness: m.betweenness, communities: labels };
    })
    .filter((b) => b.communities.length >= 2)
    .sort((a, b) => b.betweenness - a.betweenness)
    .slice(0, MAX_PER_CATEGORY);

  // ── Stale-but-central: high PageRank, untouched past the staleness cutoff. ──
  const now = DateTime.now();
  const staleCentral: StaleCentralInsightDTO[] = noteRows
    .map((r) => {
      const m = metricById.get(r.id);
      const freshnessDays = r.updatedAtUtc ? Math.max(0, Math.floor(now.diff(DateTime.fromISO(r.updatedAtUtc), 'days').days)) : 0;
      return { id: r.id, title: titleById.get(r.id) ?? r.id, pagerank: m?.pagerank ?? 0, freshnessDays };
    })
    .filter((x) => x.pagerank > 0 && x.freshnessDays >= staleDays)
    .sort((a, b) => b.pagerank - a.pagerank)
    .slice(0, MAX_PER_CATEGORY);

  // ── Duplicate suspects: near-identical embeddings (regardless of links). ──
  const dupThreshold = Math.min(0.99, Math.max(0.85, settings.graphSuggestThreshold + 0.12));
  const dupScored: Array<{ a: string; b: string; score: number }> = [];
  for (let i = 0; i < embeddedIds.length; i++) {
    for (let j = i + 1; j < embeddedIds.length; j++) {
      const score = bestSim(embeddedIds[i], embeddedIds[j]);
      if (score >= dupThreshold) dupScored.push({ a: embeddedIds[i], b: embeddedIds[j], score });
    }
  }
  dupScored.sort((x, y) => y.score - x.score);
  const duplicates: DuplicateInsightDTO[] = dupScored.slice(0, MAX_PER_CATEGORY).map((d) => ({
    source: d.a,
    sourceTitle: titleById.get(d.a) ?? d.a,
    target: d.b,
    targetTitle: titleById.get(d.b) ?? d.b,
    similarity: d.score,
  }));

  return {
    orphans: orphans.slice(0, MAX_PER_CATEGORY),
    blindSpots,
    bridges,
    staleCentral,
    duplicates,
    embeddingsReady,
    staleDays,
  };
}
