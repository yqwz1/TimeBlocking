import { createHash } from 'node:crypto';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { asc, eq } from 'drizzle-orm';
import type { Settings } from '@timeblock/shared';
import { communities, conceptMentions, concepts, notes } from '../../db/schema.js';
import type { DB } from '../../db/client.js';
import { getSettings } from '../../settings.js';
import { aiConfigured } from '../../ai/client.js';
import { nameCommunity } from '../../ai/notesAi.js';
import { ModelGateway } from '../../assistant/modelGateway.js';
import type { RawEdge } from './edges.js';
import { completeGraphJob, failGraphJob, queueGraphJob, startGraphJob } from './jobs.js';

/**
 * The Graph — G4. Hierarchical community detection (Louvain at three resolutions) over the combined
 * document + concept graph, plus AI naming/summaries. Communities colour the graph (§3), back the
 * "color by community" mode, and are the retrieval backbone for global GraphRAG questions (§4).
 *
 * graphology ships Louvain, not Leiden (its refinement); Louvain gives the modularity-optimised,
 * weighted, multi-resolution partitions G4 needs. A fixed-seed RNG keeps partitions reproducible so an
 * unchanged vault produces the same community ids (and thus reuses cached AI summaries) run to run.
 */

// Coarse → fine. Lower resolution = fewer, larger communities. Level 0 is the "country" used for node colour.
const RESOLUTIONS = [0.4, 1.0, 1.8];

/** Deterministic PRNG (mulberry32) so Louvain is reproducible across recomputes of an unchanged graph. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Content-addressed community id: identical member sets at a level yield the same id → cached summary reuse. */
function communityId(level: number, members: string[]): string {
  const h = createHash('sha1').update(`${level}\n${[...members].sort().join('\n')}`).digest('hex');
  return `com-${level}-${h.slice(0, 16)}`;
}

export interface ComputedCommunity {
  id: string;
  level: number;
  parentId: string | null;
  members: string[];
  fallbackLabel: string;
}

export interface CommunityComputation {
  /** note id → its level-0 (coarse) community id, for `node_metrics.community_id` colouring. */
  noteToCoarse: Map<string, string>;
  rows: ComputedCommunity[];
}

function mode(values: string[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestN = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestN) {
      bestN = n;
      best = v;
    }
  }
  return best;
}

/**
 * Runs Louvain over notes + bridging concept nodes (all typed note↔note edges plus note↔concept mention
 * edges, weighted) at three resolutions, and derives a nested hierarchy (a finer community's parent is the
 * coarser community holding most of its members). Pure DB read; safe off the request path.
 */
export function computeCommunities(db: DB, noteNoteEdges: RawEdge[]): CommunityComputation {
  const noteIds = db.select({ id: notes.id }).from(notes).all().map((r) => r.id);
  const g = new Graph({ type: 'undirected' });
  for (const id of noteIds) g.addNode(id);

  const addEdge = (a: string, b: string, w: number) => {
    if (a === b || !g.hasNode(a) || !g.hasNode(b)) return;
    if (g.hasEdge(a, b)) g.updateEdgeAttribute(a, b, 'weight', (x) => (typeof x === 'number' ? x : 0) + w);
    else g.addEdge(a, b, { weight: w });
  };

  // note ↔ note (explicit/semantic/tag), weighted so deliberate links pull hardest.
  const TYPE_WEIGHT: Record<string, number> = { explicit: 3, concept: 2, semantic: 1, tag: 1 };
  for (const e of noteNoteEdges) addEdge(e.source, e.target, (TYPE_WEIGHT[e.type] ?? 1) * Math.max(e.weight, 0.1));

  // Concept bridges: a diamond node per concept mentioned by ≥2 notes, linked to each mentioning note.
  const mentions = db.select().from(conceptMentions).all();
  const byConcept = new Map<string, { noteId: string; count: number }[]>();
  const noteConceptIds = new Map<string, string[]>();
  for (const m of mentions) {
    if (!g.hasNode(m.noteId)) continue;
    (byConcept.get(m.conceptId) ?? byConcept.set(m.conceptId, []).get(m.conceptId)!).push({ noteId: m.noteId, count: m.count });
    (noteConceptIds.get(m.noteId) ?? noteConceptIds.set(m.noteId, []).get(m.noteId)!).push(m.conceptId);
  }
  for (const [conceptId, list] of byConcept) {
    if (list.length < 2) continue;
    const cNode = `concept:${conceptId}`;
    g.addNode(cNode);
    for (const m of list) addEdge(cNode, m.noteId, TYPE_WEIGHT.concept * Math.max(Math.min(m.count, 5), 1) * 0.5);
  }

  // Lookups for deterministic fallback labels.
  const titleById = new Map(db.select({ id: notes.id, title: notes.title }).from(notes).all().map((r) => [r.id, r.title]));
  const tagsById = new Map(
    db.select({ id: notes.id, tags: notes.tags }).from(notes).all().map((r) => {
      let t: string[] = [];
      try {
        t = JSON.parse(r.tags);
      } catch {
        t = [];
      }
      return [r.id, t] as const;
    }),
  );
  const conceptNameById = new Map(db.select({ id: concepts.id, name: concepts.name }).from(concepts).all().map((c) => [c.id, c.name]));

  function fallbackLabel(members: string[]): string {
    // 1) the concept mentioned by the most members (a genuine shared theme).
    const conceptFreq = new Map<string, number>();
    for (const n of members) for (const cid of noteConceptIds.get(n) ?? []) conceptFreq.set(cid, (conceptFreq.get(cid) ?? 0) + 1);
    let topConcept: string | null = null;
    let topN = 1;
    for (const [cid, n] of conceptFreq) if (n > topN) ((topN = n), (topConcept = cid));
    if (topConcept) return conceptNameById.get(topConcept) ?? 'Cluster';
    // 2) the most common tag.
    const tagFreq = new Map<string, number>();
    for (const n of members) for (const t of tagsById.get(n) ?? []) tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1);
    const topTag = mode([...tagFreq.entries()].flatMap(([t, n]) => Array<string>(n).fill(t)));
    if (topTag) return `#${topTag}`;
    // 3) the title of a representative member.
    const rep = [...members].sort()[0];
    return rep ? (titleById.get(rep) ?? 'Cluster') : 'Cluster';
  }

  // Partition at each resolution; keep only note members (concept nodes just shape the structure).
  const noteToLocal: Array<Record<string, number>> = RESOLUTIONS.map((resolution) =>
    louvain(g, { resolution, getEdgeWeight: 'weight', rng: seededRng(0x5eed) }),
  );

  const noteToIdByLevel: Array<Map<string, string>> = [];
  const rows: ComputedCommunity[] = [];

  for (let level = 0; level < RESOLUTIONS.length; level++) {
    const groups = new Map<number, string[]>();
    for (const n of noteIds) {
      const c = noteToLocal[level][n];
      if (c === undefined) continue;
      (groups.get(c) ?? groups.set(c, []).get(c)!).push(n);
    }
    const noteToId = new Map<string, string>();
    for (const members of groups.values()) {
      const id = communityId(level, members);
      const parentId = level === 0 ? null : mode(members.map((m) => noteToIdByLevel[level - 1].get(m)).filter((x): x is string => !!x));
      rows.push({ id, level, parentId, members, fallbackLabel: fallbackLabel(members) });
      for (const m of members) noteToId.set(m, id);
    }
    noteToIdByLevel.push(noteToId);
  }

  return { noteToCoarse: noteToIdByLevel[0] ?? new Map(), rows };
}

/**
 * Persists computed communities inside the caller's transaction, reusing the cached AI `label`/`summary`
 * for any community whose id (and thus member set) is unchanged — so a stable community is never re-summarised.
 */
export function persistCommunities(tx: DB, computed: ComputedCommunity[]): void {
  const existing = new Map(
    tx.select().from(communities).all().map((c) => [c.id, { label: c.label, summary: c.summary, aiGenerated: c.aiGenerated }]),
  );
  const nowIso = new Date().toISOString();
  tx.delete(communities).run();
  for (const row of computed) {
    const prior = existing.get(row.id);
    const keepAi = prior && prior.aiGenerated === 1;
    tx.insert(communities)
      .values({
        id: row.id,
        level: row.level,
        parentId: row.parentId,
        label: keepAi ? prior!.label : row.fallbackLabel,
        summary: keepAi ? prior!.summary : '',
        members: JSON.stringify(row.members),
        memberCount: row.members.length,
        aiGenerated: keepAi ? 1 : 0,
        updatedAtUtc: nowIso,
      })
      .run();
  }
}

// ── AI naming (background, cached, AI-off-safe) ───────────────────────────────

interface CommunityRow {
  id: string;
  level: number;
  label: string;
  summary: string;
  members: string;
  memberCount: number;
  aiGenerated: number;
}

const MAX_NAMED_PER_PASS = 80; // bound API spend per pass; the rest keep their fallback label and retry later.

/**
 * Names + summarises every community still on its deterministic fallback (aiGenerated=0), cheapest-first.
 * One AI call per community, cached by the content-addressed id, so an unchanged community is named once.
 * No-op (returns 0) when AI is disabled/unconfigured — communities still have their fallback labels.
 */
export async function nameStaleCommunities(db: DB, settings: Settings): Promise<number> {
  if (!settings.aiEnabled || !aiConfigured()) return 0;
  const titleById = new Map(db.select({ id: notes.id, title: notes.title }).from(notes).all().map((r) => [r.id, r.title]));
  const stale = (db.select().from(communities).where(eq(communities.aiGenerated, 0)).orderBy(asc(communities.level)).all() as CommunityRow[])
    .sort((a, b) => b.memberCount - a.memberCount)
    .slice(0, MAX_NAMED_PER_PASS);

  let named = 0;
  for (const c of stale) {
    let members: string[] = [];
    try {
      members = JSON.parse(c.members);
    } catch {
      members = [];
    }
    if (members.length < 2) continue; // a lone note is not a theme worth an API call
    const memberTitles = members.map((m) => titleById.get(m)).filter((t): t is string => !!t).slice(0, 40);
    let result;
    try {
      result = await nameCommunity(new ModelGateway(db), settings.aiModel, memberTitles);
    } catch {
      break; // offline / quota — stop; the rest keep their fallback and retry on the next pass
    }
    db.update(communities)
      .set({ label: result.label || c.label, summary: result.summary || '', aiGenerated: 1 })
      .where(eq(communities.id, c.id))
      .run();
    named++;
  }
  return named;
}

// ── Background runner (single-flight with a trailing re-run), mirrors concept extraction ──
let running = false;
let pending = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function runNaming(db: DB): Promise<void> {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  startGraphJob(db, 'community-labels');
  try {
    do {
      pending = false;
      await nameStaleCommunities(db, getSettings(db));
    } while (pending);
    completeGraphJob(db, 'community-labels');
  } catch (error) {
    failGraphJob(db, 'community-labels', error);
    // rebuildable cache — swallow
  } finally {
    running = false;
  }
}

/** Debounced, fire-and-forget community naming — fires after the graph recompute has written the communities. */
export function triggerCommunityNaming(db: DB): void {
  queueGraphJob(db, 'community-labels');
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runNaming(db);
  }, 4000);
}

export function isCommunityNamingRunning(): boolean {
  return running;
}

// ── Read helpers for GraphRAG ─────────────────────────────────────────────────

export interface CommunitySummary {
  id: string;
  label: string;
  summary: string;
  memberIds: string[];
  memberTitles: string[];
}

/** Coarse (level-0) communities with their labels/summaries + member titles — context for global questions. */
export function coarseCommunitySummaries(db: DB): CommunitySummary[] {
  const titleById = new Map(db.select({ id: notes.id, title: notes.title }).from(notes).all().map((r) => [r.id, r.title]));
  return (db.select().from(communities).where(eq(communities.level, 0)).all() as CommunityRow[])
    .map((c) => {
      let memberIds: string[] = [];
      try {
        memberIds = JSON.parse(c.members);
      } catch {
        memberIds = [];
      }
      return {
        id: c.id,
        label: c.label,
        summary: c.summary,
        memberIds,
        memberTitles: memberIds.map((m) => titleById.get(m)).filter((t): t is string => !!t),
      };
    })
    .filter((c) => c.memberIds.length >= 2)
    .sort((a, b) => b.memberIds.length - a.memberIds.length);
}
