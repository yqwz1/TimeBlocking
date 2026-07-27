import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import pagerank from 'graphology-metrics/centrality/pagerank.js';
import betweenness from 'graphology-metrics/centrality/betweenness.js';
import type { GraphEraDTO, GraphTimelineDTO, NoteGraphDTO, NoteGraphEdgeDTO, NoteGraphNodeDTO } from '@timeblock/shared';
import { notes } from '../../db/schema.js';
import type { DB } from '../../db/client.js';
import { parseNote } from '../parser.js';
import { readNoteFile } from '../vault.js';
import { graphIndexFreshness } from './jobs.js';

const SNAPSHOTS_DIRNAME = '.snapshots';
const DAY_MS = 86_400_000;

export interface HistoricalNoteInput {
  id: string;
  content: string;
  createdAt: string | null;
  updatedAt: string | null;
}

interface SnapshotEntry {
  noteId: string;
  at: string;
  absPath: string;
}

function weekStartIso(value: Date | string): string {
  const d = new Date(value);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function parseSnapshotTimestamp(filename: string): string | null {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.md$/);
  if (!m) return null;
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

async function collectSnapshots(root: string): Promise<SnapshotEntry[]> {
  const base = path.join(root, SNAPSHOTS_DIRNAME);
  if (!fs.existsSync(base)) return [];
  const out: SnapshotEntry[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childAbs = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(childAbs, childRel);
      else if (entry.isFile()) {
        const at = parseSnapshotTimestamp(entry.name);
        if (!at) continue;
        const noteId = rel.replace(/\\/g, '/');
        if (noteId.toLowerCase().endsWith('.md')) out.push({ noteId, at, absPath: childAbs });
      }
    }
  }
  await walk(base, '');
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function folderOf(id: string): string {
  return id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';
}

function stemOf(id: string): string {
  return id.split('/').pop()!.replace(/\.md$/i, '');
}

function communityLabel(memberIds: string[], parsed: Map<string, ReturnType<typeof parseNote>>): string {
  const tags = new Map<string, number>();
  const folders = new Map<string, number>();
  for (const id of memberIds) {
    for (const tag of parsed.get(id)?.tags ?? []) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    const folder = folderOf(id);
    if (folder) folders.set(folder, (folders.get(folder) ?? 0) + 1);
  }
  const best = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const tag = best(tags);
  if (tag) return `#${tag}`;
  const folder = best(folders);
  if (folder) return folder.split('/').pop()!;
  return parsed.get([...memberIds].sort()[0])?.title ?? 'Independent notes';
}

/** Pure historical graph builder, separated for the 1,000-note acceptance harness. */
export function buildEraGraphFromNotes(inputs: HistoricalNoteInput[], atIso: string): NoteGraphDTO {
  const atMs = Date.parse(atIso);
  const parsed = new Map(inputs.map((n) => [n.id, parseNote(n.id, n.content)]));
  const byStem = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const [id, note] of parsed) {
    byStem.set(stemOf(id).toLowerCase(), id);
    byTitle.set(note.title.toLowerCase(), id);
  }

  const graph = new Graph({ type: 'undirected' });
  for (const n of inputs) graph.addNode(n.id);
  const weights = new Map<string, { source: string; target: string; weight: number }>();
  for (const source of inputs) {
    for (const targetTitle of parsed.get(source.id)!.wikilinks) {
      const target = byStem.get(targetTitle.toLowerCase()) ?? byTitle.get(targetTitle.toLowerCase());
      if (!target || target === source.id) continue;
      const [a, b] = source.id < target ? [source.id, target] : [target, source.id];
      const key = `${a}|${b}`;
      const prior = weights.get(key);
      if (prior) prior.weight++;
      else weights.set(key, { source: a, target: b, weight: 1 });
    }
  }
  for (const edge of weights.values()) graph.addEdge(edge.source, edge.target, { weight: edge.weight });

  const pr: Record<string, number> = graph.order ? pagerank(graph) : {};
  const bt: Record<string, number> = graph.size ? betweenness(graph) : {};
  const maxPr = Math.max(1e-9, ...Object.values(pr));
  const partition: Record<string, number> = graph.size ? louvain(graph, { resolution: 0.6, getEdgeWeight: 'weight', rng: seededRng(0x9e3779b9) }) : {};
  const groups = new Map<number, string[]>();
  for (const id of graph.nodes()) {
    const group = partition[id] ?? graph.nodes().indexOf(id);
    (groups.get(group) ?? groups.set(group, []).get(group)!).push(id);
  }
  const communityByNode = new Map<string, { id: string; label: string }>();
  for (const members of groups.values()) {
    const id = `era-${createHash('sha1').update([...members].sort().join('\n')).digest('hex').slice(0, 12)}`;
    const label = communityLabel(members, parsed);
    for (const member of members) communityByNode.set(member, { id, label });
  }

  const nodes: NoteGraphNodeDTO[] = inputs.map((input) => {
    const note = parsed.get(input.id)!;
    const community = communityByNode.get(input.id);
    return {
      id: input.id,
      title: note.title,
      tags: note.tags,
      folder: folderOf(input.id),
      pinned: note.frontmatter.pinned === true,
      degree: graph.degree(input.id),
      pagerank: (pr[input.id] ?? 0) / maxPr,
      betweenness: bt[input.id] ?? 0,
      openTasks: note.body.match(/^\s*[-*]\s+\[ \]/gm)?.length ?? 0,
      timeSpentMin: 0,
      freshnessDays: input.updatedAt ? Math.max(0, Math.floor((atMs - Date.parse(input.updatedAt)) / DAY_MS)) : 0,
      kind: 'note',
      conceptType: null,
      communityId: community?.id ?? null,
      communityLabel: community?.label ?? null,
      preview: note.body.replace(/\s+/g, ' ').trim().slice(0, 280),
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    };
  });
  const edges: NoteGraphEdgeDTO[] = [...weights.values()].map((edge) => ({ ...edge, type: 'explicit' }));
  const labels = [...new Set(nodes.map((node) => node.communityLabel).filter((label): label is string => !!label))];
  const weekStart = weekStartIso(atIso);
  const era: GraphEraDTO = {
    at: atIso,
    weekStart,
    label: new Date(weekStart).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
    noteCount: nodes.length,
    communityLabels: labels,
  };
  return {
    nodes,
    edges,
    indexReady: true,
    layout: {},
    freshness: { status: 'fresh', indexedAt: atIso, staleSince: null, jobs: [] },
    era,
  };
}

export async function graphTimeline(db: DB, root: string): Promise<GraphTimelineDTO> {
  const rows = db.select({ createdAt: notes.createdAtUtc }).from(notes).all();
  const snapshots = await collectSnapshots(root);
  const dates = [...rows.map((row) => row.createdAt), ...snapshots.map((snap) => snap.at)].filter((value): value is string => !!value && Number.isFinite(Date.parse(value)));
  const currentWeek = weekStartIso(new Date());
  const firstWeek = dates.length ? weekStartIso(dates.sort()[0]) : currentWeek;
  const weeks: GraphEraDTO[] = [];
  for (let t = Date.parse(firstWeek); t <= Date.parse(currentWeek); t += 7 * DAY_MS) {
    const start = new Date(t).toISOString();
    const end = new Date(t + 7 * DAY_MS - 1).toISOString();
    const noteCount = rows.filter((row) => !!row.createdAt && row.createdAt <= end).length;
    weeks.push({
      at: end,
      weekStart: start,
      label: new Date(start).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
      noteCount,
      communityLabels: [],
    });
  }
  return { weeks, currentWeek };
}

export async function historicalGraph(db: DB, root: string, atIso: string): Promise<NoteGraphDTO> {
  const atMs = Date.parse(atIso);
  if (!Number.isFinite(atMs)) throw new Error('invalid era timestamp');
  const snapshots = await collectSnapshots(root);
  const byNote = new Map<string, SnapshotEntry[]>();
  for (const snap of snapshots) (byNote.get(snap.noteId) ?? byNote.set(snap.noteId, []).get(snap.noteId)!).push(snap);
  const inputs: HistoricalNoteInput[] = [];
  for (const row of db.select().from(notes).all()) {
    if (row.createdAtUtc && Date.parse(row.createdAtUtc) > atMs) continue;
    let content: string | null = null;
    let effectiveUpdated = row.updatedAtUtc;
    if (!row.updatedAtUtc || Date.parse(row.updatedAtUtc) <= atMs) {
      content = (await readNoteFile(root, row.id))?.content ?? null;
    } else {
      const nextSnapshot = (byNote.get(row.id) ?? []).find((snap) => Date.parse(snap.at) > atMs);
      if (nextSnapshot) {
        content = await fsp.readFile(nextSnapshot.absPath, 'utf8');
        const previousSave = [...(byNote.get(row.id) ?? [])].reverse().find((snap) => Date.parse(snap.at) <= atMs);
        effectiveUpdated = previousSave?.at ?? row.createdAtUtc;
      }
    }
    if (content == null) continue;
    inputs.push({ id: row.id, content, createdAt: row.createdAtUtc, updatedAt: effectiveUpdated });
  }
  const result = buildEraGraphFromNotes(inputs, atIso);
  result.freshness = graphIndexFreshness(db);
  return result;
}

export const timeTravelInternals = { parseSnapshotTimestamp, weekStartIso };
