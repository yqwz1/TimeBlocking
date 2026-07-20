import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import matter from 'gray-matter';
import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import { asc, eq, gte, isNotNull } from 'drizzle-orm';
import {
  NoteChatSchema,
  NoteCreateSchema,
  NoteFromTemplateSchema,
  NoteMoveSchema,
  NoteSaveSchema,
  type NoteChatResponseDTO,
  type NoteConflictDTO,
  type NoteDetailDTO,
  type NoteDTO,
  type NoteGraphDTO,
  type NoteGraphEdgeDTO,
  type NoteGraphEdgeType,
  type NoteGraphNodeDTO,
  type NoteSearchResultDTO,
  type NoteSuggestionsDTO,
  type NoteSummaryDTO,
  type NoteTrashEntryDTO,
  type RelatedNoteDTO,
  type TemplateSummaryDTO,
} from '@timeblock/shared';
import { conceptMentions, concepts, graphEdges, nodeMetrics, noteChunks, noteLinks, notes } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { recomputeGraph, triggerGraphRecompute } from '../notes/graph/recompute.js';
import {
  blacklistConcept,
  getConceptStatus,
  listConcepts,
  mergeConcepts,
  renameConcept,
  startConceptBackfill,
  triggerConceptExtraction,
} from '../notes/concepts/recompute.js';
import type { ConceptDTO, ConceptStatusDTO } from '@timeblock/shared';
import { getSettings } from '../settings.js';
import { listTemplates, renderTemplate } from '../notes/templates.js';
import { aiConfigured } from '../ai/client.js';
import { answerGraphChat, compileGraphQuery, generateWeeklyDigest, narratePath, suggestLinksAndTags } from '../ai/notesAi.js';
import { coarseCommunitySummaries } from '../notes/graph/communities.js';
import { classifyQuestion, expandNeighbors, noteExcerpt } from '../notes/graph/retrieval.js';
import { fallbackNarration, findPaths, whyRelated } from '../notes/graph/paths.js';
import { acceptSuggestion, computeSuggestions, dismissSuggestion } from '../notes/graph/suggestions.js';
import { computeInsights } from '../notes/graph/insights.js';
import { communities as communitiesTable } from '../db/schema.js';
import {
  GraphPathSchema,
  GraphQuerySchema,
  GraphWhySchema,
  SuggestedEdgeActionSchema,
  type GraphPathResultDTO,
  type GraphQueryFilterDTO,
  type GraphQueryResponseDTO,
  type GraphWhyDTO,
  type GraphInsightsDTO,
  type SuggestedEdgeDTO,
} from '@timeblock/shared';
import {
  chunkCount,
  embedNoteIfStale,
  embedQuery,
  reembedAllNotes,
  relatedNotes,
  retrieveChunksForChat,
  semanticSearch,
} from '../notes/embeddings.js';
import {
  createNoteFile,
  getVaultRoot,
  listTrash,
  moveNoteFile,
  normalizeNotePath,
  purgeExpiredTrash,
  purgeTrashEntry,
  readNoteFile,
  restoreFromTrash,
  safeResolve,
  trashNoteFile,
  VaultConflictError,
  VaultPathError,
  writeNoteFile,
} from '../notes/vault.js';

const ASSET_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};
import { getBacklinks, getOutgoingLinks, getUnlinkedMentions, indexNote, reindexAll, removeNoteFromIndex, searchNotes } from '../notes/indexer.js';

type NoteRow = typeof notes.$inferSelect;

function getNoteRow(db: DB, id: string): NoteRow | undefined {
  return db.select().from(notes).where(eq(notes.id, id)).get();
}

function toSummaryDTO(row: NoteRow): NoteSummaryDTO {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags);
  } catch {
    tags = [];
  }
  let pinned = false;
  try {
    pinned = (JSON.parse(row.frontmatter) as Record<string, unknown>)?.pinned === true;
  } catch {
    pinned = false;
  }
  return { id: row.id, title: row.title, tags, pinned, createdAt: row.createdAtUtc, updatedAt: row.updatedAtUtc };
}

/** Fire-and-forget: never blocks the save response on a paid embedding call, and quietly no-ops when AI is off/unconfigured. */
function triggerEmbed(db: DB, root: string, id: string): void {
  const settings = getSettings(db);
  void embedNoteIfStale(db, root, id, settings.aiEnabled && aiConfigured(), settings.aiEmbeddingModel).catch(() => {});
  // Any content change also invalidates the graph cache (links/metrics/tags/open-tasks). Debounced,
  // never blocks the save. Semantic edges pick up the fresh embeddings on a later recompute.
  triggerGraphRecompute(db);
  // Concept re-extraction is incremental (only this note's body-hash changed) and AI-gated. Debounced.
  triggerConceptExtraction(db, root);
}

export function registerNoteRoutes(app: FastifyInstance, db: DB) {
  app.get('/notes/tree', async (): Promise<NoteSummaryDTO[]> => {
    return db.select().from(notes).orderBy(asc(notes.id)).all().map(toSummaryDTO);
  });

  app.get<{ Querystring: { q?: string } }>('/notes/search', async (req): Promise<NoteSearchResultDTO[]> => {
    const q = (req.query.q ?? '').trim();
    if (!q) return [];
    const settings = getSettings(db);
    const merged = new Map<string, NoteSearchResultDTO>();
    for (const r of searchNotes(db, q)) merged.set(r.id, { id: r.id, title: r.title, snippet: r.snip, matchType: 'keyword' });

    if (settings.aiEnabled && aiConfigured()) {
      try {
        const queryVector = await embedQuery(settings.aiEmbeddingModel, q);
        if (queryVector.length) {
          for (const hit of semanticSearch(db, queryVector, 15).filter((h) => h.score > 0.5)) {
            const existing = merged.get(hit.id);
            if (existing) existing.matchType = 'both';
            else {
              const row = getNoteRow(db, hit.id);
              if (row) merged.set(hit.id, { id: hit.id, title: row.title, snippet: hit.snippet, matchType: 'semantic' });
            }
          }
        }
      } catch {
        // Semantic search layers on top of keyword search — never fail the whole request over it (e.g. offline).
      }
    }
    return Array.from(merged.values()).slice(0, 30);
  });

  app.get<{ Params: { '*': string } }>('/notes/related/*', async (req): Promise<RelatedNoteDTO[]> => {
    const settings = getSettings(db);
    if (!settings.aiEnabled || !aiConfigured()) return [];
    const relPath = normalizeNotePath(req.params['*']);
    return relatedNotes(db, relPath, 5);
  });

  // The Graph (G2): metrics-encoded nodes + typed (explicit/semantic/tag) edges from the cache.
  app.get('/notes/graph', async (): Promise<NoteGraphDTO> => {
    const rows = db.select().from(notes).orderBy(asc(notes.id)).all();
    const metricRows = db.select().from(nodeMetrics).all();
    const metricById = new Map(metricRows.map((m) => [m.noteId, m]));
    const communityLabelById = new Map(db.select({ id: communitiesTable.id, label: communitiesTable.label }).from(communitiesTable).all().map((c) => [c.id, c.label]));
    const indexReady = metricRows.length > 0;
    const now = DateTime.now();

    const nodes: NoteGraphNodeDTO[] = rows.map((row) => {
      const summary = toSummaryDTO(row);
      const folder = row.id.includes('/') ? row.id.slice(0, row.id.lastIndexOf('/')) : '';
      const m = metricById.get(row.id);
      const freshnessDays = row.updatedAtUtc
        ? Math.max(0, Math.floor(now.diff(DateTime.fromISO(row.updatedAtUtc), 'days').days))
        : 0;
      return {
        id: row.id,
        title: summary.title,
        tags: summary.tags,
        folder,
        pinned: summary.pinned,
        degree: m?.degree ?? 0,
        pagerank: m?.pagerank ?? 0,
        betweenness: m?.betweenness ?? 0,
        openTasks: m?.openTasks ?? 0,
        freshnessDays,
        kind: 'note',
        conceptType: null,
        communityId: m?.communityId ?? null,
        communityLabel: m?.communityId ? communityLabelById.get(m.communityId) ?? null : null,
      };
    });
    const nodeIds = new Set(nodes.map((n) => n.id));
    let edges: NoteGraphEdgeDTO[];
    if (indexReady) {
      edges = db
        .select()
        .from(graphEdges)
        .all()
        .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
        .map((e) => ({ source: e.source, target: e.target, type: e.type as NoteGraphEdgeType, weight: e.weight }));
    } else {
      // Cold cache — return live explicit edges (G1 parity) and kick off a background rebuild.
      const linkRows = db
        .select({ sourceId: noteLinks.sourceId, targetId: noteLinks.targetId })
        .from(noteLinks)
        .where(isNotNull(noteLinks.targetId))
        .all();
      const seen = new Set<string>();
      edges = [];
      for (const r of linkRows) {
        if (!r.targetId || r.sourceId === r.targetId) continue;
        const key = [r.sourceId, r.targetId].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ source: r.sourceId, target: r.targetId, type: 'explicit', weight: 1 });
      }
      triggerGraphRecompute(db);
    }

    // Concept layer (G3): a diamond node per concept mentioned by ≥2 visible notes (a genuine bridge),
    // with note↔concept edges. Grouped from concept_mentions.
    const mentionRows = db.select().from(conceptMentions).all().filter((m) => nodeIds.has(m.noteId));
    const byConcept = new Map<string, { noteId: string; count: number }[]>();
    for (const m of mentionRows) {
      const list = byConcept.get(m.conceptId) ?? [];
      list.push({ noteId: m.noteId, count: m.count });
      byConcept.set(m.conceptId, list);
    }
    const conceptRows = new Map(db.select().from(concepts).all().map((c) => [c.id, c]));
    for (const [conceptId, mentions] of byConcept) {
      if (mentions.length < 2) continue; // only bridges (spec §0)
      const c = conceptRows.get(conceptId);
      if (!c) continue;
      const nodeId = `concept:${conceptId}`;
      nodes.push({
        id: nodeId,
        title: c.name,
        tags: [],
        folder: '',
        pinned: false,
        degree: mentions.length,
        pagerank: 0,
        betweenness: 0,
        openTasks: 0,
        freshnessDays: 0,
        kind: 'concept',
        conceptType: c.type as ConceptDTO['type'],
        communityId: null,
        communityLabel: null,
      });
      for (const m of mentions) edges.push({ source: m.noteId, target: nodeId, type: 'concept', weight: m.count });
    }

    return { nodes, edges, indexReady };
  });

  // Manual full rebuild of the graph cache (Settings button). Synchronous — the caller waits.
  app.post('/notes/graph/rebuild', async () => {
    recomputeGraph(db);
    return { ok: true };
  });

  // ── G6 §5 — Ask the graph in natural language → compiled filter chips ─────────
  app.post<{ Body: unknown }>('/notes/graph/query', async (req, reply): Promise<GraphQueryResponseDTO | { error: string }> => {
    const parsed = GraphQuerySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const settings = getSettings(db);
    if (!settings.aiEnabled || !aiConfigured()) return reply.code(501).send({ error: 'AI is not enabled' });

    // Real facets the model must choose from — anything it invents is clamped away below.
    const allTags = new Set<string>();
    const allFolders = new Set<string>();
    for (const row of db.select({ id: notes.id, tags: notes.tags }).from(notes).all()) {
      allFolders.add(row.id.includes('/') ? row.id.slice(0, row.id.lastIndexOf('/')) : '');
      try {
        for (const t of JSON.parse(row.tags) as string[]) allTags.add(t);
      } catch {
        /* skip */
      }
    }
    const communityLabels = db.select({ label: communitiesTable.label }).from(communitiesTable).all().map((c) => c.label);
    const edgeTypes: NoteGraphEdgeType[] = ['explicit', 'semantic', 'tag', 'concept', 'suggested'];

    let compiled;
    try {
      compiled = await compileGraphQuery(settings.aiModel, parsed.data.message, {
        tags: [...allTags],
        folders: [...allFolders],
        communityLabels,
        edgeTypes,
      });
    } catch {
      return reply.code(503).send({ error: 'AI unavailable (offline?)' });
    }

    // Clamp every field back to real facets / sane ranges (case-insensitive membership).
    const keepFrom = (values: string[], allowed: Iterable<string>): string[] => {
      const byLower = new Map([...allowed].map((v) => [v.toLowerCase(), v]));
      return [...new Set(values.map((v) => byLower.get((v ?? '').toLowerCase())).filter((v): v is string => v !== undefined))];
    };
    const clampNum = (n: number | null, min: number, max: number): number | null => (typeof n === 'number' && isFinite(n) ? Math.min(max, Math.max(min, n)) : null);
    const filter: GraphQueryFilterDTO = {
      tags: keepFrom(compiled.tags, allTags),
      folders: keepFrom(compiled.folders, allFolders),
      communityLabels: keepFrom(compiled.communityLabels, communityLabels),
      edgeTypes: keepFrom(compiled.edgeTypes, edgeTypes) as NoteGraphEdgeType[],
      untouchedMinDays: clampNum(compiled.untouchedMinDays, 0, 3650),
      minPagerank: clampNum(compiled.minPagerank, 0, 1),
      minDegree: clampNum(compiled.minDegree, 0, 100000),
      minBetweenness: clampNum(compiled.minBetweenness, 0, 1),
      hasOpenTasks: compiled.hasOpenTasks === true,
      text: compiled.text && compiled.text.trim() ? compiled.text.trim() : null,
    };
    return { filter, interpretation: compiled.interpretation };
  });

  // ── G6 §6 — Connection explorer: shortest + strongest path, narrated ─────────
  app.post<{ Body: unknown }>('/notes/graph/path', async (req, reply): Promise<GraphPathResultDTO | { error: string }> => {
    const parsed = GraphPathSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const { shortest, strongest } = findPaths(db, parsed.data.source, parsed.data.target);
    const narratePathSteps = strongest.length ? strongest : shortest;
    let narration = fallbackNarration(narratePathSteps);
    const settings = getSettings(db);
    if (narratePathSteps.length > 1 && settings.aiEnabled && aiConfigured()) {
      try {
        const ai = await narratePath(settings.aiModel, narratePathSteps.map((s) => ({ title: s.title, kind: s.kind, viaType: s.viaType })));
        if (ai) narration = ai;
      } catch {
        // keep the deterministic fallback narration
      }
    }
    return { shortest, strongest, narration };
  });

  // "Why related?" evidence for a note pair (side-by-side passages + shared tags/concepts).
  app.post<{ Body: unknown }>('/notes/graph/why', async (req, reply): Promise<GraphWhyDTO | { error: string }> => {
    const parsed = GraphWhySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return whyRelated(db, parsed.data.source, parsed.data.target);
  });

  // ── G6 §7 — Suggested edges (ghost layer) + accept/dismiss ───────────────────
  app.get('/notes/graph/suggestions', async (): Promise<SuggestedEdgeDTO[]> => {
    return computeSuggestions(db, getSettings(db));
  });

  app.post<{ Body: unknown }>('/notes/graph/suggestions/accept', async (req, reply) => {
    const parsed = SuggestedEdgeActionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const result = await acceptSuggestion(db, getVaultRoot(db), parsed.data.source, parsed.data.target);
    if (!result.ok) return reply.code(404).send({ error: result.error });
    return { ok: true };
  });

  app.post<{ Body: unknown }>('/notes/graph/suggestions/dismiss', async (req, reply) => {
    const parsed = SuggestedEdgeActionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    dismissSuggestion(db, parsed.data.source, parsed.data.target);
    return { ok: true };
  });

  // ── G6 §8 — Insights panel (orphans · blind spots · bridges · stale-central · duplicates) ──
  app.get('/notes/graph/insights', async (): Promise<GraphInsightsDTO> => computeInsights(db, getSettings(db)));

  // ── Concepts (G3) ──────────────────────────────────────────────────────────
  app.get('/notes/concepts', async (): Promise<ConceptDTO[]> => listConcepts(db));

  app.get('/notes/concepts/status', async (): Promise<ConceptStatusDTO> => getConceptStatus(db));

  // Kicks a full backfill pass (extracts every note whose concepts are stale). Fire-and-forget.
  app.post('/notes/concepts/extract', async () => {
    const running = startConceptBackfill(db, getVaultRoot(db));
    return { ok: true, running };
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/notes/concepts/:id/rename', async (req, reply) => {
    const name = (req.body as { name?: string })?.name?.trim();
    if (!name) return reply.code(400).send({ error: 'name is required' });
    const result = renameConcept(db, req.params.id, name);
    if (!result.ok) return reply.code(409).send({ error: result.error });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/notes/concepts/:id/merge', async (req, reply) => {
    const intoId = (req.body as { intoId?: string })?.intoId;
    if (!intoId) return reply.code(400).send({ error: 'intoId is required' });
    const result = mergeConcepts(db, req.params.id, intoId);
    if (!result.ok) return reply.code(409).send({ error: result.error });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/notes/concepts/:id/blacklist', async (req, reply) => {
    const result = blacklistConcept(db, req.params.id);
    if (!result.ok) return reply.code(404).send({ error: result.error });
    return { ok: true };
  });

  app.get('/notes/templates', async (): Promise<TemplateSummaryDTO[]> => {
    const root = getVaultRoot(db);
    const settings = getSettings(db);
    return listTemplates(root, settings.notesTemplatesFolder);
  });

  app.get<{ Params: { '*': string } }>('/notes/file/*', async (req, reply): Promise<NoteDetailDTO | { error: string }> => {
    const root = getVaultRoot(db);
    const relPath = normalizeNotePath(req.params['*']);
    const file = await readNoteFile(root, relPath);
    if (!file) return reply.code(404).send({ error: 'not found' });
    const row = getNoteRow(db, relPath);
    const summary = row ?? { id: relPath, title: relPath, tags: '[]', frontmatter: '{}', contentHash: '', createdAtUtc: file.createdAtUtc, updatedAtUtc: file.updatedAtUtc };
    return {
      ...toSummaryDTO(summary),
      content: file.content,
      backlinks: getBacklinks(db, relPath),
      unlinkedMentions: getUnlinkedMentions(db, relPath, summary.title),
      outgoingLinks: getOutgoingLinks(db, relPath),
    };
  });

  app.post<{ Body: unknown }>('/notes/file', async (req, reply): Promise<NoteDTO | { error: string }> => {
    const parsed = NoteCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const root = getVaultRoot(db);
    const relPath = normalizeNotePath(parsed.data.path);
    const content = parsed.data.content ?? `# ${relPath.replace(/\.md$/i, '').split('/').pop()}\n\n`;
    try {
      await createNoteFile(root, relPath, content);
    } catch (err) {
      if (err instanceof VaultConflictError || err instanceof VaultPathError) return reply.code(409).send({ error: err.message });
      throw err;
    }
    await indexNote(db, root, relPath);
    triggerEmbed(db, root, relPath);
    const row = getNoteRow(db, relPath);
    return reply.code(201).send({ ...toSummaryDTO(row!), content });
  });

  app.put<{ Params: { '*': string }; Body: unknown }>('/notes/file/*', async (req, reply): Promise<NoteDTO | NoteConflictDTO | { error: string }> => {
    const parsed = NoteSaveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const root = getVaultRoot(db);
    const relPath = normalizeNotePath(req.params['*']);
    const current = await readNoteFile(root, relPath);
    if (current && parsed.data.expectedUpdatedAt && parsed.data.expectedUpdatedAt !== current.updatedAtUtc) {
      return reply.code(409).send({ error: 'conflict', serverContent: current.content, serverUpdatedAt: current.updatedAtUtc });
    }
    const settings = getSettings(db);
    await writeNoteFile(root, relPath, parsed.data.content, settings.notesSnapshotRetention);
    await indexNote(db, root, relPath);
    triggerEmbed(db, root, relPath);
    const row = getNoteRow(db, relPath);
    return { ...toSummaryDTO(row!), content: parsed.data.content };
  });

  app.delete<{ Params: { '*': string } }>('/notes/file/*', async (req, reply) => {
    const root = getVaultRoot(db);
    const relPath = normalizeNotePath(req.params['*']);
    let trashId: string;
    try {
      trashId = await trashNoteFile(root, relPath);
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
    removeNoteFromIndex(db, relPath);
    triggerGraphRecompute(db);
    triggerConceptExtraction(db, root);
    return { ok: true, trashId };
  });

  app.post<{ Body: unknown }>('/notes/move', async (req, reply): Promise<NoteDTO | { error: string }> => {
    const parsed = NoteMoveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const body = req.body as { from?: string };
    if (!body.from) return reply.code(400).send({ error: 'from is required' });
    const root = getVaultRoot(db);
    const fromRel = normalizeNotePath(body.from);
    const toRel = normalizeNotePath(parsed.data.path);
    try {
      await moveNoteFile(root, fromRel, toRel);
    } catch (err) {
      if (err instanceof VaultConflictError || err instanceof VaultPathError) return reply.code(409).send({ error: err.message });
      throw err;
    }
    // Rekey embeddings before removeNoteFromIndex clears fromRel's chunks — content (and thus the
    // embedding) is unchanged by a pure move, so this avoids paying for a needless re-embed.
    db.update(noteChunks).set({ noteId: toRel }).where(eq(noteChunks.noteId, fromRel)).run();
    removeNoteFromIndex(db, fromRel);
    await indexNote(db, root, toRel);
    triggerEmbed(db, root, toRel);
    const file = await readNoteFile(root, toRel);
    const row = getNoteRow(db, toRel);
    return { ...toSummaryDTO(row!), content: file?.content ?? '' };
  });

  // Opens (creating if needed) today's daily note, rendered from Templates/Daily.md if present.
  app.post('/notes/daily', async (): Promise<NoteDTO> => {
    const root = getVaultRoot(db);
    const settings = getSettings(db);
    const now = DateTime.now().setZone(settings.timezone);
    const dateStr = now.toISODate()!;
    const relPath = normalizeNotePath(`${settings.notesDailyFolder}/${dateStr}`);
    let file = await readNoteFile(root, relPath);
    if (!file) {
      const templates = await listTemplates(root, settings.notesTemplatesFolder);
      const dailyTemplate = templates.find((t) => path.basename(t.id).replace(/\.md$/i, '').toLowerCase() === 'daily');
      const templateContent = dailyTemplate ? ((await readNoteFile(root, dailyTemplate.id))?.content ?? '') : '# {{date}}\n\n';
      const content = renderTemplate(templateContent, { date: dateStr, time: now.toFormat('HH:mm'), title: dateStr });
      await createNoteFile(root, relPath, content);
      file = await readNoteFile(root, relPath);
    }
    await indexNote(db, root, relPath);
    triggerEmbed(db, root, relPath);
    const row = getNoteRow(db, relPath);
    return { ...toSummaryDTO(row!), content: file!.content };
  });

  app.post<{ Body: unknown }>('/notes/from-template', async (req, reply): Promise<NoteDTO | { error: string }> => {
    const parsed = NoteFromTemplateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const root = getVaultRoot(db);
    const settings = getSettings(db);
    const relPath = normalizeNotePath(parsed.data.path);
    const templateFile = await readNoteFile(root, normalizeNotePath(parsed.data.templateId));
    if (!templateFile) return reply.code(404).send({ error: 'template not found' });
    const now = DateTime.now().setZone(settings.timezone);
    const title = path.basename(relPath).replace(/\.md$/i, '');
    const content = renderTemplate(templateFile.content, { date: now.toISODate()!, time: now.toFormat('HH:mm'), title });
    try {
      await createNoteFile(root, relPath, content);
    } catch (err) {
      if (err instanceof VaultConflictError || err instanceof VaultPathError) return reply.code(409).send({ error: err.message });
      throw err;
    }
    await indexNote(db, root, relPath);
    triggerEmbed(db, root, relPath);
    const row = getNoteRow(db, relPath);
    return reply.code(201).send({ ...toSummaryDTO(row!), content });
  });

  // Toggles `pinned: true` in the note's own YAML frontmatter — no DB-only state, per files-first.
  app.post<{ Body: unknown }>('/notes/pin', async (req, reply): Promise<NoteDTO | { error: string }> => {
    const body = req.body as { id?: string };
    if (!body.id) return reply.code(400).send({ error: 'id is required' });
    const root = getVaultRoot(db);
    const relPath = normalizeNotePath(body.id);
    const file = await readNoteFile(root, relPath);
    if (!file) return reply.code(404).send({ error: 'not found' });
    const parsedNote = matter(file.content);
    const nextPinned = parsedNote.data?.pinned !== true;
    const nextData: Record<string, unknown> = { ...parsedNote.data };
    if (nextPinned) nextData.pinned = true;
    else delete nextData.pinned;
    const nextContent = Object.keys(nextData).length > 0 ? matter.stringify(parsedNote.content, nextData) : parsedNote.content;
    const settings = getSettings(db);
    await writeNoteFile(root, relPath, nextContent, settings.notesSnapshotRetention);
    await indexNote(db, root, relPath);
    const row = getNoteRow(db, relPath);
    return { ...toSummaryDTO(row!), content: nextContent };
  });

  app.post<{ Body: unknown }>('/notes/chat', async (req, reply): Promise<NoteChatResponseDTO | { error: string }> => {
    const parsed = NoteChatSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const settings = getSettings(db);
    if (!settings.aiEnabled || !aiConfigured()) return reply.code(501).send({ error: 'AI is not enabled' });

    let queryVector: number[];
    try {
      queryVector = await embedQuery(settings.aiEmbeddingModel, parsed.data.message);
    } catch {
      return reply.code(503).send({ error: 'AI unavailable (offline?)' });
    }

    // GraphRAG (G4): route to the local (specific) or global (themes/overview) retrieval path.
    const scope = classifyQuestion(parsed.data.message);
    const titleById = new Map(db.select({ id: notes.id, title: notes.title }).from(notes).all().map((r) => [r.id, r.title]));

    const context: { noteId: string; title: string; text: string }[] = [];
    const contextIds = new Set<string>();
    const addContext = (noteId: string, text: string) => {
      if (contextIds.has(noteId) || !text) return;
      contextIds.add(noteId);
      context.push({ noteId, title: titleById.get(noteId) ?? noteId, text });
    };

    // Seeds: the top semantic chunks (drive both scopes).
    const seedChunks = queryVector.length ? retrieveChunksForChat(db, queryVector, scope === 'global' ? 4 : 8) : [];
    for (const c of seedChunks) addContext(c.noteId, c.text);
    const seedIds = [...contextIds];

    // Local: expand seeds to their 1-hop graph neighbourhood (linked/semantic/tag + shared-concept notes).
    if (scope === 'local') {
      for (const neighbourId of expandNeighbors(db, seedIds, 6)) addContext(neighbourId, noteExcerpt(db, neighbourId, 600));
    }

    // Global: bring in the coarse community summaries as the primary source.
    let communityContext: { label: string; summary: string; memberTitles: string[] }[] = [];
    const focusIds = new Set<string>(contextIds);
    if (scope === 'global') {
      const summaries = coarseCommunitySummaries(db).slice(0, 12);
      communityContext = summaries.map((c) => ({ label: c.label, summary: c.summary, memberTitles: c.memberTitles }));
      for (const c of summaries) for (const id of c.memberIds.slice(0, 8)) focusIds.add(id);
    }

    let result;
    try {
      result = await answerGraphChat(settings.aiModel, settings.aiAboutMe, parsed.data.message, parsed.data.history ?? [], scope, context, communityContext);
    } catch {
      return reply.code(503).send({ error: 'AI unavailable (offline?)' });
    }

    const citations = result.citedNoteIds.filter((id) => titleById.has(id)).map((id) => ({ id, title: titleById.get(id)! }));
    for (const cit of citations) focusIds.add(cit.id);
    return { answer: result.answer, citations, scope, focusNoteIds: [...focusIds].slice(0, 80) };
  });

  app.post<{ Body: unknown }>('/notes/suggest', async (req, reply): Promise<NoteSuggestionsDTO | { error: string }> => {
    const body = req.body as { id?: string };
    if (!body.id) return reply.code(400).send({ error: 'id is required' });
    const settings = getSettings(db);
    if (!settings.aiEnabled || !aiConfigured()) return reply.code(501).send({ error: 'AI is not enabled' });
    const root = getVaultRoot(db);
    const relPath = normalizeNotePath(body.id);
    const file = await readNoteFile(root, relPath);
    if (!file) return reply.code(404).send({ error: 'not found' });
    const row = getNoteRow(db, relPath);
    const title = row?.title ?? relPath;
    const existingTitles = db.select({ title: notes.title }).from(notes).all().map((r) => r.title);
    try {
      return await suggestLinksAndTags(settings.aiModel, title, file.content, existingTitles);
    } catch {
      return reply.code(503).send({ error: 'AI unavailable (offline?)' });
    }
  });

  app.post('/notes/digest', async (_req, reply): Promise<NoteDTO | { error: string }> => {
    const settings = getSettings(db);
    if (!settings.aiEnabled || !aiConfigured()) return reply.code(501).send({ error: 'AI is not enabled' });
    const root = getVaultRoot(db);
    const now = DateTime.now().setZone(settings.timezone);
    const weekAgo = now.minus({ days: 7 });
    const touched = db
      .select()
      .from(notes)
      .where(gte(notes.updatedAtUtc, weekAgo.toISO()!))
      .all()
      .filter((r) => !r.id.startsWith(`${settings.notesDigestFolder}/`));

    const sourceNotes = [];
    for (const row of touched) {
      const file = await readNoteFile(root, row.id);
      if (!file) continue;
      const openTasks = Array.from(file.content.matchAll(/^\s*[-*]\s+\[ \]\s+(.+)$/gm)).map((m) => m[1].trim());
      sourceNotes.push({ id: row.id, title: row.title, excerpt: file.content.slice(0, 500), openTasks });
    }

    const weekLabel = `${now.toFormat('kkkk-\'W\'WW')}`;
    let digestBody: string;
    try {
      digestBody = await generateWeeklyDigest(settings.aiModel, settings.aiAboutMe, weekLabel, sourceNotes);
    } catch {
      return reply.code(503).send({ error: 'AI unavailable (offline?)' });
    }

    const relPath = normalizeNotePath(`${settings.notesDigestFolder}/${weekLabel}`);
    const content = `# Weekly digest — ${weekLabel}\n\n${digestBody}\n`;
    try {
      await createNoteFile(root, relPath, content);
    } catch (err) {
      if (err instanceof VaultConflictError || err instanceof VaultPathError) return reply.code(409).send({ error: err.message });
      throw err;
    }
    await indexNote(db, root, relPath);
    const row = getNoteRow(db, relPath);
    return reply.code(201).send({ ...toSummaryDTO(row!), content });
  });

  app.post('/notes/embeddings/reindex', async () => {
    const root = getVaultRoot(db);
    const settings = getSettings(db);
    const count = await reembedAllNotes(db, root, settings.aiEnabled && aiConfigured(), settings.aiEmbeddingModel);
    return { ok: true, count };
  });

  app.get('/notes/embeddings/status', async () => {
    return { count: chunkCount(db), aiEnabled: getSettings(db).aiEnabled && aiConfigured() };
  });

  app.get('/notes/trash', async (): Promise<NoteTrashEntryDTO[]> => {
    const root = getVaultRoot(db);
    const settings = getSettings(db);
    await purgeExpiredTrash(root, settings.notesTrashRetentionDays);
    return listTrash(root);
  });

  app.post<{ Params: { trashId: string } }>('/notes/trash/:trashId/restore', async (req, reply) => {
    const root = getVaultRoot(db);
    try {
      const relPath = await restoreFromTrash(root, req.params.trashId);
      await indexNote(db, root, relPath);
      triggerGraphRecompute(db);
      triggerConceptExtraction(db, root);
      return { ok: true, path: relPath };
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });

  app.delete<{ Params: { trashId: string } }>('/notes/trash/:trashId', async (req) => {
    await purgeTrashEntry(getVaultRoot(db), req.params.trashId);
    return { ok: true };
  });

  app.post('/notes/reindex', async () => {
    const count = await reindexAll(db, getVaultRoot(db));
    return { ok: true, count };
  });

  app.get<{ Params: { '*': string } }>('/notes/asset/*', async (req, reply) => {
    const root = getVaultRoot(db);
    let abs: string;
    try {
      abs = safeResolve(root, decodeURIComponent(req.params['*']));
    } catch {
      return reply.code(400).send({ error: 'invalid path' });
    }
    if (!fs.existsSync(abs)) return reply.code(404).send({ error: 'not found' });
    const mime = ASSET_MIME_TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    reply.header('Content-Type', mime);
    return reply.send(fs.createReadStream(abs));
  });

  app.get('/notes/vault.zip', async (req, reply) => {
    const root = getVaultRoot(db);
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', 'attachment; filename="vault.zip"');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.directory(root, false, (entry) => {
      if (/^(\.trash|\.snapshots)(\/|$)/.test(entry.name)) return false;
      return entry;
    });
    void archive.finalize();
    return reply.send(archive);
  });
}
