import Graph from 'graphology';
import { dijkstra, unweighted } from 'graphology-shortest-path';
import { and, eq, inArray } from 'drizzle-orm';
import type { GraphPathStepDTO, GraphWhyDTO, NoteGraphEdgeType } from '@timeblock/shared';
import { conceptMentions, concepts, graphEdges, noteChunks, noteLinks, notes } from '../../db/schema.js';
import type { DB } from '../../db/client.js';
import { cosineSimilarity } from '../embeddings.js';

/**
 * The Graph — G6 §6 (connection explorer). Builds the combined note+concept graph on demand and finds the
 * shortest (fewest hops) and strongest (weighted) paths between two nodes, plus "why related?" evidence for a
 * pair. Pure DB reads.
 */

interface Combined {
  graph: Graph;
  titleOf: (id: string) => string;
  kindOf: (id: string) => 'note' | 'concept';
}

// Higher = stronger pull; strongest-path cost is 1/strength so strong edges are "cheaper" to traverse.
function edgeStrength(type: NoteGraphEdgeType, weight: number): number {
  const base = type === 'explicit' ? 3 : type === 'concept' ? 2 : 1;
  return base * Math.max(weight, 0.1);
}

function buildCombinedGraph(db: DB): Combined {
  const g = new Graph({ type: 'undirected' });
  const noteTitle = new Map(db.select({ id: notes.id, title: notes.title }).from(notes).all().map((r) => [r.id, r.title]));
  for (const [id, title] of noteTitle) g.addNode(id, { kind: 'note', title });

  // Cached note↔note typed edges (explicit/semantic/tag).
  for (const e of db.select().from(graphEdges).all()) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target) || g.hasEdge(e.source, e.target)) continue;
    g.addEdge(e.source, e.target, { type: e.type as NoteGraphEdgeType, weight: e.weight });
  }

  // Concept bridges (concepts mentioned by ≥2 notes) as diamond nodes.
  const conceptName = new Map(db.select({ id: concepts.id, name: concepts.name }).from(concepts).all().map((c) => [c.id, c.name]));
  const byConcept = new Map<string, { noteId: string; count: number }[]>();
  for (const m of db.select().from(conceptMentions).all()) {
    if (!g.hasNode(m.noteId)) continue;
    (byConcept.get(m.conceptId) ?? byConcept.set(m.conceptId, []).get(m.conceptId)!).push({ noteId: m.noteId, count: m.count });
  }
  for (const [cid, list] of byConcept) {
    if (list.length < 2) continue;
    const node = `concept:${cid}`;
    g.addNode(node, { kind: 'concept', title: conceptName.get(cid) ?? 'concept' });
    for (const m of list) if (!g.hasEdge(node, m.noteId)) g.addEdge(node, m.noteId, { type: 'concept', weight: m.count });
  }

  return {
    graph: g,
    titleOf: (id) => (g.hasNode(id) ? (g.getNodeAttribute(id, 'title') as string) : id),
    kindOf: (id) => (g.hasNode(id) && g.getNodeAttribute(id, 'kind') === 'concept' ? 'concept' : 'note'),
  };
}

function toSteps(c: Combined, nodePath: string[]): GraphPathStepDTO[] {
  return nodePath.map((id, i) => {
    let viaType: NoteGraphEdgeType | null = null;
    if (i > 0 && c.graph.hasEdge(nodePath[i - 1], id)) viaType = c.graph.getEdgeAttribute(nodePath[i - 1], id, 'type') as NoteGraphEdgeType;
    return { id, title: c.titleOf(id), kind: c.kindOf(id), viaType };
  });
}

export interface PathResult {
  shortest: GraphPathStepDTO[];
  strongest: GraphPathStepDTO[];
}

/** Shortest (fewest hops) and strongest (weighted) paths between two node ids over the combined graph. */
export function findPaths(db: DB, source: string, target: string): PathResult {
  const c = buildCombinedGraph(db);
  if (!c.graph.hasNode(source) || !c.graph.hasNode(target) || source === target) return { shortest: [], strongest: [] };
  const shortest = (unweighted.bidirectional(c.graph, source, target) as string[] | null) ?? [];
  const strongest =
    (dijkstra.bidirectional(c.graph, source, target, (_e, attr) => 1 / edgeStrength((attr.type as NoteGraphEdgeType) ?? 'semantic', (attr.weight as number) ?? 1)) as
      | string[]
      | null) ?? [];
  return { shortest: toSteps(c, shortest), strongest: toSteps(c, strongest) };
}

/** Deterministic one-line narration of a path, used when AI is off. */
export function fallbackNarration(steps: GraphPathStepDTO[]): string {
  if (steps.length === 0) return 'No connection found between these two notes.';
  if (steps.length === 1) return steps[0].title;
  const verb: Record<string, string> = { explicit: 'links to', semantic: 'is similar to', tag: 'shares tags with', concept: 'shares a concept with', suggested: 'may link to' };
  let out = `"${steps[0].title}"`;
  for (let i = 1; i < steps.length; i++) {
    const s = steps[i];
    out += ` ${verb[s.viaType ?? 'semantic'] ?? 'connects to'} ${s.kind === 'concept' ? `the concept "${s.title}"` : `"${s.title}"`}`;
  }
  return `${out}.`;
}

function noteTags(db: DB, id: string): string[] {
  const row = db.select({ tags: notes.tags }).from(notes).where(eq(notes.id, id)).get();
  try {
    return row ? (JSON.parse(row.tags) as string[]) : [];
  } catch {
    return [];
  }
}

/** "Why related?" evidence for a note pair (G6 §6): best-matching passages + shared tags/concepts. */
export function whyRelated(db: DB, source: string, target: string): GraphWhyDTO {
  const shared: string[] = [];

  // Shared concepts.
  const srcConcepts = db.select({ conceptId: conceptMentions.conceptId }).from(conceptMentions).where(eq(conceptMentions.noteId, source)).all().map((r) => r.conceptId);
  const tgtConcepts = new Set(db.select({ conceptId: conceptMentions.conceptId }).from(conceptMentions).where(eq(conceptMentions.noteId, target)).all().map((r) => r.conceptId));
  const sharedConceptIds = srcConcepts.filter((id) => tgtConcepts.has(id));
  if (sharedConceptIds.length) {
    const names = db.select({ id: concepts.id, name: concepts.name }).from(concepts).where(inArray(concepts.id, sharedConceptIds)).all();
    for (const n of names) shared.push(n.name);
  }

  // Shared tags.
  const tgtTags = new Set(noteTags(db, target));
  for (const t of noteTags(db, source)) if (tgtTags.has(t)) shared.push(`#${t}`);

  // Best-matching passage pair (the black-box-buster for semantic/ghost edges).
  const srcChunks = db.select({ text: noteChunks.text, embedding: noteChunks.embedding }).from(noteChunks).where(eq(noteChunks.noteId, source)).all();
  const tgtChunks = db.select({ text: noteChunks.text, embedding: noteChunks.embedding }).from(noteChunks).where(eq(noteChunks.noteId, target)).all();
  let best: { s: string; t: string; score: number } | null = null;
  for (const a of srcChunks) {
    let va: number[];
    try {
      va = JSON.parse(a.embedding);
    } catch {
      continue;
    }
    for (const b of tgtChunks) {
      let vb: number[];
      try {
        vb = JSON.parse(b.embedding);
      } catch {
        continue;
      }
      const score = cosineSimilarity(va, vb);
      if (!best || score > best.score) best = { s: a.text, t: b.text, score };
    }
  }

  const linked = !!db
    .select({ id: noteLinks.id })
    .from(noteLinks)
    .where(and(eq(noteLinks.sourceId, source), eq(noteLinks.targetId, target)))
    .get();

  const kind: GraphWhyDTO['kind'] = best ? 'semantic' : sharedConceptIds.length ? 'concept' : shared.length ? 'tag' : linked ? 'explicit' : 'none';
  return {
    kind,
    sourcePassage: best ? best.s.slice(0, 500) : null,
    targetPassage: best ? best.t.slice(0, 500) : null,
    score: best ? best.score : null,
    shared,
  };
}
