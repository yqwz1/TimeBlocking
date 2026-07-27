import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import matter from 'gray-matter';
import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import { asc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import {
  sanitizeVoiceNoteTitle,
  NoteDraftLinkedInSchema,
  type NoteExportFormat,
  type NoteExportKind,
  NoteExportSchema,
  NoteChatSchema,
  QuickCaptureSchema,
  ClipUrlSchema,
  InboxTriageApplySchema,
  NoteCreateSchema,
  NoteFromTemplateSchema,
  NoteMoveSchema,
  NoteQuerySchema,
  NoteRestoreSnapshotSchema,
  NoteSaveSchema,
  GraphLayoutSaveSchema,
  StudyReviewBlockSchema,
  StudyReviewSchema,
  VaultTaskToggleSchema,
  type InboxNoteDTO,
  type InboxTriageSuggestionDTO,
  type NoteAssetUploadDTO,
  type NoteChatResponseDTO,
  type NoteConflictDTO,
  type NoteDetailDTO,
  type NoteDTO,
  type NoteGraphDTO,
  type NoteGraphEdgeDTO,
  type NoteGraphEdgeType,
  type NoteGraphNodeDTO,
  type NoteQueryResultDTO,
  type NoteSearchResultDTO,
  type NoteShareDTO,
  type NoteSnapshotDTO,
  type NoteSnapshotDetailDTO,
  type NoteSuggestionsDTO,
  type NoteSummaryDTO,
  type NoteTrashEntryDTO,
  type OnThisDayDTO,
  type PublicNoteDTO,
  type RelatedNoteDTO,
  type StudyQueueDTO,
  type StudyReviewBlockDTO,
  type StudyReviewResultDTO,
  type TemplateSummaryDTO,
  type VaultTaskHubDTO,
} from '@timeblock/shared';
import { conceptMentions, concepts, graphEdges, layoutCache, nodeMetrics, noteChunks, noteLinks, notes, noteShares, tasks as nativeTasks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { triggerGraphRecompute } from '../notes/graph/recompute.js';
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
import { ModelGateway } from '../assistant/modelGateway.js';
import { runAssistantChat } from '../assistant/runtime.js';
import { answerGraphChat, compileGraphQuery, generateWeeklyDigest, narratePath, suggestInboxTriage, suggestLinksAndTags } from '../ai/notesAi.js';
import { coarseCommunitySummaries } from '../notes/graph/communities.js';
import { classifyQuestion, expandNeighbors, noteExcerpt } from '../notes/graph/retrieval.js';
import { fallbackNarration, findPaths, whyRelated } from '../notes/graph/paths.js';
import { acceptSuggestion, computeSuggestions, dismissSuggestion } from '../notes/graph/suggestions.js';
import { computeInsights } from '../notes/graph/insights.js';
import { graphIndexFreshness, completeGraphJob, failGraphJob, queueGraphJob, startGraphJob } from '../notes/graph/jobs.js';
import { graphTimeline, historicalGraph } from '../notes/graph/timeTravel.js';
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
import { exportNotes } from '../notes/export.js';
import {
  createNoteFile,
  getVaultRoot,
  listNoteSnapshots,
  listTrash,
  moveNoteFile,
  normalizeNotePath,
  purgeExpiredTrash,
  purgeTrashEntry,
  readNoteFile,
  readNoteSnapshot,
  restoreFromTrash,
  restoreNoteSnapshot,
  safeResolve,
  trashNoteFile,
  VaultConflictError,
  VaultPathError,
  writeNoteFile,
} from '../notes/vault.js';
import { getOnThisDay } from '../notes/onThisDay.js';
import { runNoteQuery } from '../notes/queryBlocks.js';
import { dueStudyCards, reviewStudyCard, syncStudyCardsForNote } from '../notes/study.js';
import { ensureTodaysBlocksSection } from '../integrations/secondBrain/dailyNotes.js';
import { encodeIntegrationNoteId } from '../integrations/secondBrain/ids.js';
import { completeMarkdownTask, extractMarkdownTasks } from '../integrations/secondBrain/tasks.js';
import { appendInboxTriage, buildInboxCaptureContent, capturePath, normalizeVaultFolder, saveNoteAsset, simpleHtmlToMarkdown } from '../notes/inbox.js';
import { env, nowUtcIso } from '../config.js';
import type { SyncManager } from '../sync/manager.js';

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

function buildPublicShareUrl(req: { headers: Record<string, unknown> }, token: string): string {
  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : null;
  if (originHeader) return `${originHeader.replace(/\/$/, '')}/share/${encodeURIComponent(token)}`;
  const forwardedProto = typeof req.headers['x-forwarded-proto'] === 'string' ? req.headers['x-forwarded-proto'].split(',')[0]?.trim() : null;
  const protocol = forwardedProto || 'http';
  const host = typeof req.headers.host === 'string' ? req.headers.host : '127.0.0.1';
  return `${protocol}://${host}/share/${encodeURIComponent(token)}`;
}

function toNoteShareDTO(req: { headers: Record<string, unknown> }, noteId: string, row?: typeof noteShares.$inferSelect | null): NoteShareDTO {
  const active = !!row && !row.revokedAtUtc;
  return {
    noteId,
    token: active ? row!.token : null,
    shareUrl: active ? buildPublicShareUrl(req, row!.token) : null,
    createdAt: row?.createdAtUtc ?? null,
    revokedAt: row?.revokedAtUtc ?? null,
    active,
  };
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

function frontmatterOf(row: NoteRow): Record<string, unknown> {
  try {
    return JSON.parse(row.frontmatter) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toInboxDTO(row: NoteRow): InboxNoteDTO {
  const summary = toSummaryDTO(row);
  const fm = frontmatterOf(row);
  return {
    ...summary,
    captureType: typeof fm.capture === 'string' ? fm.capture : null,
    capturedAt: typeof fm.capturedAt === 'string' ? fm.capturedAt : null,
    source: typeof fm.source === 'string' ? fm.source : null,
    processed: fm.processed === true,
  };
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function collectVaultTasks(db: DB, root: string, filters?: { tag?: string; folder?: string; status?: 'open' | 'done' | 'all'; due?: string }): Promise<VaultTaskHubDTO> {
  const tasks: VaultTaskHubDTO['tasks'] = [];
  for (const row of db.select().from(notes).orderBy(asc(notes.id)).all()) {
    if (filters?.folder) {
      const folder = row.id.includes('/') ? row.id.slice(0, row.id.lastIndexOf('/')) : '';
      if (!folder.toLowerCase().startsWith(filters.folder.toLowerCase())) continue;
    }
    const file = await readNoteFile(root, row.id);
    if (!file) continue;
    const noteTags = (() => {
      try {
        return JSON.parse(row.tags) as string[];
      } catch {
        return [];
      }
    })();
    for (const task of extractMarkdownTasks(row.id, row.title, noteTags, file.content)) {
      if (filters?.status === 'open' && task.completed) continue;
      if (filters?.status === 'done' && !task.completed) continue;
      if (filters?.tag && !task.tags.some((tag) => tag.toLowerCase() === filters.tag!.toLowerCase())) continue;
      if (filters?.due && task.due !== filters.due) continue;
      tasks.push({
        id: task.id,
        noteId: row.id,
        noteTitle: row.title,
        notePath: row.id,
        line: task.line,
        text: task.text,
        completed: task.completed,
        tags: task.tags,
        due: task.due,
        estimateMinutes: task.estimateMinutes,
        status: task.status,
      });
    }
  }

  const groups = Array.from(
    tasks.reduce((map, task) => {
      const existing = map.get(task.noteId) ?? { noteId: task.noteId, noteTitle: task.noteTitle, notePath: task.notePath, tasks: [] as typeof tasks };
      existing.tasks.push(task);
      map.set(task.noteId, existing);
      return map;
    }, new Map<string, { noteId: string; noteTitle: string; notePath: string; tasks: typeof tasks }>()),
  )
    .map(([, group]) => ({ ...group, tasks: group.tasks.sort((a, b) => a.line - b.line) }))
    .sort((a, b) => a.noteTitle.localeCompare(b.noteTitle));

  const boardBuckets = new Map<string, { status: string; label: string; tasks: typeof tasks }>();
  const boardStatus = (task: (typeof tasks)[number]) => task.status ?? (task.completed ? 'done' : 'todo');
  const boardLabel = (status: string) => status.replace(/_/g, ' ');
  for (const task of tasks) {
    const status = boardStatus(task);
    const bucket = boardBuckets.get(status) ?? { status, label: boardLabel(status), tasks: [] as typeof tasks };
    bucket.tasks.push(task);
    boardBuckets.set(status, bucket);
  }

  return {
    tasks: tasks.sort((a, b) => (a.completed === b.completed ? a.noteTitle.localeCompare(b.noteTitle) || a.line - b.line : Number(a.completed) - Number(b.completed))),
    groups,
    board: Array.from(boardBuckets.values()).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

const pendingEmbeds = new Set<string>();
let embedTimer: ReturnType<typeof setTimeout> | null = null;
let embeddingsRunning = false;

async function drainEmbeddings(db: DB, root: string): Promise<void> {
  if (embeddingsRunning) return;
  embeddingsRunning = true;
  startGraphJob(db, 'embeddings');
  try {
    while (pendingEmbeds.size) {
      const batch = [...pendingEmbeds];
      pendingEmbeds.clear();
      const settings = getSettings(db);
      for (const id of batch) await embedNoteIfStale(db, root, id, settings.aiEnabled && aiConfigured(), settings.aiEmbeddingModel);
    }
    completeGraphJob(db, 'embeddings');
  } catch (error) {
    failGraphJob(db, 'embeddings', error);
  } finally {
    embeddingsRunning = false;
    if (pendingEmbeds.size) {
      embedTimer = setTimeout(() => {
        embedTimer = null;
        void drainEmbeddings(db, root);
      }, 1_000);
    }
  }
}

/** Debounced, incremental, single-flight embedding queue. A save only records work and returns. */
export function notifyNoteChanged(db: DB, root: string, id: string): void {
  pendingEmbeds.add(id);
  queueGraphJob(db, 'embeddings');
  if (embedTimer) clearTimeout(embedTimer);
  embedTimer = setTimeout(() => {
    embedTimer = null;
    void drainEmbeddings(db, root);
  }, 1_000);
  // Any content change also invalidates the graph cache (links/metrics/tags/open-tasks). Debounced,
  // never blocks the save. Semantic edges pick up the fresh embeddings on a later recompute.
  triggerGraphRecompute(db);
  // Concept re-extraction is incremental (only this note's body-hash changed) and AI-gated. Debounced.
  triggerConceptExtraction(db, root);
  const timezone = getSettings(db).timezone;
  void syncStudyCardsForNote(db, root, id, timezone);
}

export function registerNoteRoutes(app: FastifyInstance, db: DB, manager: SyncManager) {
  const gateway = new ModelGateway(db);
  app.get('/notes/tree', async (): Promise<NoteSummaryDTO[]> => {
    return db.select().from(notes).orderBy(asc(notes.id)).all().map(toSummaryDTO);
  });

  app.get('/notes/inbox', async (): Promise<InboxNoteDTO[]> => {
    const settings = getSettings(db);
    const prefix = `${normalizeVaultFolder(settings.notesInboxFolder, 'Inbox')}/`;
    return db
      .select()
      .from(notes)
      .where(sql`${notes.id} LIKE ${`${prefix}%`}`)
      .orderBy(sql`${notes.updatedAtUtc} DESC`)
      .all()
      .map(toInboxDTO);
  });

  app.post<{ Body: unknown }>('/notes/capture', async (req, reply): Promise<NoteDTO | { error: string }> => {
    const parsed = QuickCaptureSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const settings = getSettings(db);
    const root = getVaultRoot(db);
    const now = DateTime.now().setZone(settings.timezone);
    const existingIds = db.select({ id: notes.id }).from(notes).all().map((row) => row.id);
    const title = (parsed.data.title?.trim() || parsed.data.text.trim().split(/\r?\n/, 1)[0] || 'Quick capture').slice(0, 120);
    const relPath = capturePath(settings, parsed.data.folder || `${settings.notesInboxFolder}/Quick`, title, existingIds, now);
    const content = buildInboxCaptureContent({
      kind: 'quick',
      title,
      body: parsed.data.text.trim(),
      capturedAt: now.toUTC().toISO()!,
      source: parsed.data.sourceUrl ?? null,
      tags: ['quick-capture'],
    });
    try {
      await createNoteFile(root, relPath, content);
    } catch (err) {
      if (err instanceof VaultConflictError || err instanceof VaultPathError) return reply.code(409).send({ error: err.message });
      throw err;
    }
    await indexNote(db, root, relPath);
    notifyNoteChanged(db, root, relPath);
    const row = getNoteRow(db, relPath);
    return reply.code(201).send({ ...toSummaryDTO(row!), content });
  });

  app.post<{ Body: unknown }>('/notes/clip-url', async (req, reply): Promise<NoteDTO | { error: string }> => {
    const parsed = ClipUrlSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const settings = getSettings(db);
    const root = getVaultRoot(db);
    let response: Response;
    try {
      response = await fetch(parsed.data.url, { redirect: 'follow' });
    } catch {
      return reply.code(502).send({ error: 'Could not fetch that URL.' });
    }
    if (!response.ok) return reply.code(502).send({ error: `Could not fetch that URL (${response.status}).` });
    const html = await response.text();
    const readable = simpleHtmlToMarkdown(html);
    let summary: string | null = null;
    if (parsed.data.summarize && settings.aiEnabled && aiConfigured()) {
      try {
        summary = (await gateway.generateText({ task: 'vault_synthesis', promptVersion: 'clip-summary-v1', model: settings.aiModel, prompt: [
          'Summarize this clipped article in 2-3 practical sentences for a personal second-brain inbox note.',
          `Title: ${readable.title}`,
          readable.body.slice(0, 6000),
        ].join('\n\n') })).value;
      } catch {
        summary = null;
      }
    }
    const now = DateTime.now().setZone(settings.timezone);
    const existingIds = db.select({ id: notes.id }).from(notes).all().map((row) => row.id);
    const relPath = capturePath(settings, parsed.data.folder || `${settings.notesInboxFolder}/Web`, readable.title, existingIds, now);
    const content = buildInboxCaptureContent({
      kind: 'web-clip',
      title: readable.title,
      body: readable.body,
      capturedAt: now.toUTC().toISO()!,
      source: parsed.data.url,
      sourceTitle: readable.title,
      tags: ['web-capture'],
      summary,
    });
    try {
      await createNoteFile(root, relPath, content);
    } catch (err) {
      if (err instanceof VaultConflictError || err instanceof VaultPathError) return reply.code(409).send({ error: err.message });
      throw err;
    }
    await indexNote(db, root, relPath);
    notifyNoteChanged(db, root, relPath);
    const row = getNoteRow(db, relPath);
    return reply.code(201).send({ ...toSummaryDTO(row!), content });
  });

  app.get<{ Querystring: { q?: string } }>('/notes/search', async (req): Promise<NoteSearchResultDTO[]> => {
    const q = (req.query.q ?? '').trim();
    if (!q) return [];
    const settings = getSettings(db);
    const merged = new Map<string, NoteSearchResultDTO>();
    for (const r of searchNotes(db, q)) merged.set(r.id, { id: r.id, title: r.title, snippet: r.snip, matchType: 'keyword' });

    if (settings.aiEnabled && aiConfigured()) {
      try {
        const queryVector = await embedQuery(db, settings.aiEmbeddingModel, q);
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

  app.post<{ Body: unknown }>('/notes/query', async (req, reply): Promise<NoteQueryResultDTO | { error: string }> => {
    const parsed = NoteQuerySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return runNoteQuery(db, getVaultRoot(db), parsed.data.query, getSettings(db).timezone);
  });

  app.get<{ Querystring: { tag?: string; folder?: string; status?: 'open' | 'done' | 'all'; due?: string } }>('/notes/tasks', async (req): Promise<VaultTaskHubDTO> => {
    return collectVaultTasks(db, getVaultRoot(db), {
      tag: req.query.tag?.trim() || undefined,
      folder: req.query.folder?.trim() || undefined,
      status: req.query.status ?? 'all',
      due: req.query.due?.trim() || undefined,
    });
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/notes/tasks/:id/toggle', async (req, reply) => {
    const parsed = VaultTaskToggleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const root = getVaultRoot(db);
    for (const row of db.select().from(notes).all()) {
      const file = await readNoteFile(root, row.id);
      if (!file) continue;
      const currentTasks = extractMarkdownTasks(row.id, row.title, parseJsonArray(row.tags), file.content);
      const target = currentTasks.find((task) => task.id === req.params.id);
      if (!target) continue;
      if (target.completed === parsed.data.completed) return { ok: true };
      let next: string | null = null;
      if (parsed.data.completed) next = completeMarkdownTask(file.content, req.params.id, row.id, row.title, parseJsonArray(row.tags));
      else {
        const newline = file.content.includes('\r\n') ? '\r\n' : '\n';
        const lines = file.content.split(/\r?\n/);
        lines[target.line - 1] = lines[target.line - 1].replace(/^(\s*[-*+]\s+\[)([ xX])(\]\s+.*)$/, '$1 $3');
        next = lines.join(newline);
      }
      if (next === null) break;
      await writeNoteFile(root, row.id, next, getSettings(db).notesSnapshotRetention);
      await indexNote(db, root, row.id);
      notifyNoteChanged(db, root, row.id);
      return { ok: true };
    }
    return reply.code(404).send({ error: 'task not found; its source line may have changed' });
  });

  app.get<{ Querystring: { date?: string } }>('/notes/study/queue', async (req): Promise<StudyQueueDTO> => {
    const timezone = getSettings(db).timezone;
    const date = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : DateTime.now().setZone(timezone).toISODate()!;
    const dueCards = (await dueStudyCards(db, getVaultRoot(db), timezone)).filter((card) => card.dueDate <= date);
    return { dueToday: dueCards.length, dueCards };
  });

  app.post<{ Body: unknown }>('/notes/study/review', async (req, reply): Promise<StudyReviewResultDTO | { error: string }> => {
    const parsed = StudyReviewSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const result = reviewStudyCard(db, parsed.data.cardId, parsed.data.rating, getSettings(db).timezone);
    if (!result) return reply.code(404).send({ error: 'card not found' });
    return result;
  });

  app.post<{ Body: unknown }>('/notes/study/review-block', async (req, reply): Promise<StudyReviewBlockDTO | { error: string }> => {
    const parsed = StudyReviewBlockSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const timezone = getSettings(db).timezone;
    const today = DateTime.now().setZone(timezone).toISODate()!;
    const noteId = parsed.data.noteId ? normalizeNotePath(parsed.data.noteId) : null;
    const noteTitle = noteId ? getNoteRow(db, noteId)?.title ?? noteId : null;
    const noteUrl = noteId ? `${env.publicAppUrl}/note/${encodeIntegrationNoteId(noteId)}` : undefined;
    const taskId = randomUUID();
    const now = nowUtcIso();
    db.insert(nativeTasks)
      .values({
        id: taskId,
        content: noteTitle ? `Review ${noteTitle}` : 'Flashcard review',
        description: 'Phase 7 study review block',
        dueDate: today,
        plannedForDate: today,
        durationMin: parsed.data.durationMin ?? 15,
        labels: JSON.stringify(['study-review']),
        links: JSON.stringify(noteUrl ? [{ url: noteUrl, title: noteTitle ?? 'Review note' }] : []),
        status: 'todo',
        priority: 2,
        isCompleted: 0,
        isDeleted: 0,
        createdAtUtc: now,
        updatedAtUtc: now,
      })
      .run();
    void manager.forcePlan('notes-study-review');
    return { taskId, content: noteTitle ? `Review ${noteTitle}` : 'Flashcard review', noteId };
  });

  app.get<{ Querystring: { date?: string } }>('/notes/on-this-day', async (req): Promise<OnThisDayDTO> => {
    const timezone = getSettings(db).timezone;
    const date = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : DateTime.now().setZone(timezone).toISODate()!;
    return getOnThisDay(db, date, timezone);
  });

  app.get<{ Querystring: { kind?: NoteExportKind; target?: string; format?: NoteExportFormat } }>('/notes/export', async (req, reply) => {
    const parsed = NoteExportSchema.safeParse({ kind: req.query.kind, target: req.query.target ?? '', format: req.query.format });
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const result = await exportNotes(db, getVaultRoot(db), parsed.data.kind, parsed.data.target, parsed.data.format);
      if (!result) return reply.code(404).send({ error: 'nothing matched that export target' });
      reply.header('Content-Type', result.mimeType);
      reply.header('Content-Disposition', `attachment; filename="${result.fileName}"`);
      return reply.send(result.bytes);
    } catch (error) {
      return reply.code(503).send({ error: (error as Error).message });
    }
  });

  // The Graph (G2): metrics-encoded nodes + typed (explicit/semantic/tag) edges from the cache.
  app.get('/notes/graph', async (): Promise<NoteGraphDTO> => {
    const rows = db.select().from(notes).orderBy(asc(notes.id)).all();
    const metricRows = db.select().from(nodeMetrics).all();
    const metricById = new Map(metricRows.map((m) => [m.noteId, m]));
    const communityLabelById = new Map(db.select({ id: communitiesTable.id, label: communitiesTable.label }).from(communitiesTable).all().map((c) => [c.id, c.label]));
    const indexReady = metricRows.length > 0;
    const now = DateTime.now();
    const previews = new Map(
      db.all<{ id: string; body: string }>(sql`SELECT id, substr(body, 1, 420) AS body FROM notes_fts`).map((row) => [row.id, row.body.replace(/\s+/g, ' ').trim()]),
    );

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
        timeSpentMin: m?.timeSpentMin ?? 0,
        freshnessDays,
        kind: 'note',
        conceptType: null,
        communityId: m?.communityId ?? null,
        communityLabel: m?.communityId ? communityLabelById.get(m.communityId) ?? null : null,
        preview: previews.get(row.id) ?? '',
        createdAt: row.createdAtUtc,
        updatedAt: row.updatedAtUtc,
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
        timeSpentMin: 0,
        freshnessDays: 0,
        kind: 'concept',
        conceptType: c.type as ConceptDTO['type'],
        communityId: null,
        communityLabel: null,
        preview: `${c.type} mentioned in ${mentions.length} notes`,
        createdAt: c.createdAtUtc,
        updatedAt: c.createdAtUtc,
      });
      for (const m of mentions) edges.push({ source: m.noteId, target: nodeId, type: 'concept', weight: m.count });
    }

    const layout = Object.fromEntries(
      db
        .select()
        .from(layoutCache)
        .where(eq(layoutCache.mode, 'connectivity'))
        .all()
        .filter((point) => nodeIds.has(point.nodeId) || point.nodeId.startsWith('concept:'))
        .map((point) => [point.nodeId, { x: point.x, y: point.y, pinned: point.pinned === 1 }]),
    );
    return { nodes, edges, indexReady, layout, freshness: graphIndexFreshness(db), era: null };
  });

  app.get('/notes/graph/timeline', async () => graphTimeline(db, getVaultRoot(db)));

  app.get<{ Querystring: { at?: string } }>('/notes/graph/era', async (req, reply) => {
    if (!req.query.at || !Number.isFinite(Date.parse(req.query.at))) return reply.code(400).send({ error: 'a valid ISO `at` timestamp is required' });
    return historicalGraph(db, getVaultRoot(db), req.query.at);
  });

  app.get('/notes/graph/jobs', async () => graphIndexFreshness(db));

  app.put<{ Body: unknown }>('/notes/graph/layout', async (req, reply) => {
    const parsed = GraphLayoutSaveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const now = new Date().toISOString();
    db.transaction((tx) => {
      for (const point of parsed.data.points) {
        tx.insert(layoutCache)
          .values({ mode: parsed.data.mode, nodeId: point.nodeId, x: point.x, y: point.y, pinned: point.pinned ? 1 : 0, updatedAtUtc: now })
          .onConflictDoUpdate({
            target: [layoutCache.mode, layoutCache.nodeId],
            set: { x: point.x, y: point.y, pinned: point.pinned ? 1 : 0, updatedAtUtc: now },
          })
          .run();
      }
    });
    return { ok: true, count: parsed.data.points.length };
  });

  // Manual full rebuild of the graph cache (Settings button). Synchronous — the caller waits.
  app.post('/notes/graph/rebuild', async () => {
    triggerGraphRecompute(db);
    return { ok: true, queued: true };
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
      compiled = await compileGraphQuery(gateway, settings.aiModel, parsed.data.message, {
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
        const ai = await narratePath(gateway, settings.aiModel, narratePathSteps.map((s) => ({ title: s.title, kind: s.kind, viaType: s.viaType })));
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

  app.get<{ Params: { '*': string } }>('/notes/file-share/*', async (req, reply): Promise<NoteShareDTO | { error: string }> => {
    const relPath = normalizeNotePath(req.params['*']);
    if (!getNoteRow(db, relPath)) return reply.code(404).send({ error: 'not found' });
    const share = db.select().from(noteShares).where(eq(noteShares.noteId, relPath)).get();
    return toNoteShareDTO(req, relPath, share);
  });

  app.post<{ Params: { '*': string } }>('/notes/file-share/*', async (req, reply): Promise<NoteShareDTO | { error: string }> => {
    const relPath = normalizeNotePath(req.params['*']);
    if (!getNoteRow(db, relPath)) return reply.code(404).send({ error: 'not found' });
    const token = randomUUID();
    const now = nowUtcIso();
    db.insert(noteShares)
      .values({ noteId: relPath, token, createdAtUtc: now, revokedAtUtc: null })
      .onConflictDoUpdate({ target: noteShares.noteId, set: { token, createdAtUtc: now, revokedAtUtc: null } })
      .run();
    const share = db.select().from(noteShares).where(eq(noteShares.noteId, relPath)).get();
    return reply.code(201).send(toNoteShareDTO(req, relPath, share));
  });

  app.delete<{ Params: { '*': string } }>('/notes/file-share/*', async (req, reply): Promise<NoteShareDTO | { error: string }> => {
    const relPath = normalizeNotePath(req.params['*']);
    if (!getNoteRow(db, relPath)) return reply.code(404).send({ error: 'not found' });
    db.update(noteShares).set({ revokedAtUtc: nowUtcIso() }).where(eq(noteShares.noteId, relPath)).run();
    const share = db.select().from(noteShares).where(eq(noteShares.noteId, relPath)).get();
    return toNoteShareDTO(req, relPath, share);
  });

  app.get<{ Params: { token: string } }>('/notes/public/:token', async (req, reply): Promise<PublicNoteDTO | { error: string }> => {
    const share = db.select().from(noteShares).where(eq(noteShares.token, req.params.token)).get();
    if (!share || share.revokedAtUtc) return reply.code(404).send({ error: 'share not found' });
    const root = getVaultRoot(db);
    const file = await readNoteFile(root, share.noteId);
    if (!file) return reply.code(404).send({ error: 'share not found' });
    const row = getNoteRow(db, share.noteId);
    return {
      noteId: share.noteId,
      title: row?.title ?? path.basename(share.noteId).replace(/\.md$/i, ''),
      content: file.content,
      publishedAt: share.createdAtUtc,
    };
  });

  app.get<{ Params: { '*': string } }>('/notes/file-snapshots/*', async (req, reply): Promise<NoteSnapshotDTO[] | { error: string }> => {
    const root = getVaultRoot(db);
    const relPath = normalizeNotePath(req.params['*']);
    if (!(await readNoteFile(root, relPath))) return reply.code(404).send({ error: 'not found' });
    return listNoteSnapshots(root, relPath);
  });

  app.get<{ Params: { '*': string; snapshotId: string } }>('/notes/file-snapshot/:snapshotId/*', async (req, reply): Promise<NoteSnapshotDetailDTO | { error: string }> => {
    const root = getVaultRoot(db);
    const relPath = normalizeNotePath(req.params['*']);
    if (!(await readNoteFile(root, relPath))) return reply.code(404).send({ error: 'not found' });
    const snapshot = await readNoteSnapshot(root, relPath, req.params.snapshotId);
    if (!snapshot) return reply.code(404).send({ error: 'snapshot not found' });
    return snapshot;
  });

  app.post<{ Params: { '*': string }; Body: unknown }>('/notes/file-snapshot-restore/*', async (req, reply): Promise<NoteDTO | { error: string }> => {
    const parsed = NoteRestoreSnapshotSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const root = getVaultRoot(db);
    const relPath = normalizeNotePath(req.params['*']);
    if (!(await readNoteFile(root, relPath))) return reply.code(404).send({ error: 'not found' });
    const settings = getSettings(db);
    try {
      await restoreNoteSnapshot(root, relPath, parsed.data.snapshotId, settings.notesSnapshotRetention);
    } catch (error) {
      if (error instanceof VaultPathError) return reply.code(404).send({ error: error.message });
      throw error;
    }
    await indexNote(db, root, relPath);
    notifyNoteChanged(db, root, relPath);
    const file = await readNoteFile(root, relPath);
    const row = getNoteRow(db, relPath);
    return { ...toSummaryDTO(row!), content: file?.content ?? '' };
  });

  app.post<{ Params: { '*': string }; Querystring: { kind?: string; ocr?: string } }>('/notes/file-asset/*', async (req, reply): Promise<NoteAssetUploadDTO | { error: string }> => {
    const root = getVaultRoot(db);
    const relPath = normalizeNotePath(req.params['*']);
    const note = await readNoteFile(root, relPath);
    if (!note) return reply.code(404).send({ error: 'note not found' });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'no file uploaded' });
    const settings = getSettings(db);
    const kind = req.query.kind === 'audio' ? 'audio' : 'image';
    const buffer = await file.toBuffer();
    const assetPath = await saveNoteAsset(root, settings.notesAttachmentsFolder, kind, file.filename || `${kind}-${Date.now()}`, buffer);
    let ocrText: string | null = null;
    if (
      kind === 'image' &&
      req.query.ocr === '1' &&
      settings.notesImageOcrEnabled &&
      settings.aiEnabled &&
      aiConfigured() &&
      file.mimetype.toLowerCase().startsWith('image/')
    ) {
      try {
        ocrText = (await gateway.generateVisionText({ task: 'extraction', promptVersion: 'ocr-v2', model: settings.aiModel, prompt: 'Extract all readable text from this screenshot or image. Return plain text only, preserving Arabic and English exactly as written. If there is no readable text, return an empty string.' }, buffer, file.mimetype)).value
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 4000) || null;
      } catch {
        ocrText = null;
      }
    }
    const baseMarkdown = kind === 'image' ? `![${file.filename || 'Image'}](${assetPath})` : `[${file.filename || 'Audio'}](${assetPath})`;
    return { path: assetPath, markdown: ocrText ? `${baseMarkdown}\n<!-- OCR: ${ocrText.replace(/-->/g, '')} -->` : baseMarkdown, ocrText };
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
    notifyNoteChanged(db, root, relPath);
    const row = getNoteRow(db, relPath);
    return reply.code(201).send({ ...toSummaryDTO(row!), content });
  });

  app.post<{ Body: unknown }>('/notes/draft-linkedin', async (req, reply): Promise<NoteDTO | { error: string }> => {
    const parsed = NoteDraftLinkedInSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const settings = getSettings(db);
    if (!settings.aiEnabled || !aiConfigured()) return reply.code(501).send({ error: 'AI is not enabled' });
    const root = getVaultRoot(db);
    const sourceId = normalizeNotePath(parsed.data.id);
    const source = await readNoteFile(root, sourceId);
    if (!source) return reply.code(404).send({ error: 'not found' });
    const sourceRow = getNoteRow(db, sourceId);
    const title = sourceRow?.title ?? path.basename(sourceId).replace(/\.md$/i, '');
    const prompt = [
      `Draft a LinkedIn post in ${parsed.data.language === 'ar' ? 'Arabic' : 'English'} from the source note below.`,
      'Return markdown only. No explanation before or after the draft.',
      'Keep the voice direct, practical, and human. Do not mention being AI-generated.',
      'Use a concise hook, 2-5 short body paragraphs or bullets, and a natural closing line.',
      settings.aiAboutMe ? `About the user:\n${settings.aiAboutMe}` : '',
      settings.aiWritingSamples.trim() ? `Voice samples to imitate:\n${settings.aiWritingSamples.trim().slice(0, 8000)}` : '',
      `Source note title: ${title}`,
      `Source note markdown:\n${source.content.slice(0, 12_000)}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    let draft: string;
    try {
      draft = (await gateway.generateText({ task: 'draft', promptVersion: 'linkedin-draft-v1', model: settings.aiModel, prompt })).value.trim();
    } catch {
      return reply.code(503).send({ error: 'AI unavailable (offline?)' });
    }

    const folder = normalizeVaultFolder(settings.notesContentDraftsFolder, 'Content/Drafts');
    const stem = sanitizeVoiceNoteTitle(`LinkedIn ${title}`);
    const existingIds = new Set(db.select({ id: notes.id }).from(notes).all().map((row) => row.id.toLowerCase()));
    let relPath = normalizeNotePath(`${folder}/${stem}`);
    let suffix = 2;
    while (existingIds.has(relPath.toLowerCase())) relPath = normalizeNotePath(`${folder}/${stem}-${suffix++}`);
    const content = [
      '---',
      'draft_type: linkedin',
      `language: ${parsed.data.language}`,
      `source_note: "${sourceId.replace(/"/g, '\\"')}"`,
      `created_at: ${nowUtcIso()}`,
      '---',
      '',
      draft,
      '',
    ].join('\n');
    try {
      await createNoteFile(root, relPath, content);
    } catch (error) {
      if (error instanceof VaultConflictError || error instanceof VaultPathError) return reply.code(409).send({ error: error.message });
      throw error;
    }
    await indexNote(db, root, relPath);
    notifyNoteChanged(db, root, relPath);
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
    notifyNoteChanged(db, root, relPath);
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
    void syncStudyCardsForNote(db, root, relPath, getSettings(db).timezone);
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
    void syncStudyCardsForNote(db, root, fromRel, getSettings(db).timezone);
    await indexNote(db, root, toRel);
    notifyNoteChanged(db, root, toRel);
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
      const content = ensureTodaysBlocksSection(renderTemplate(templateContent, { date: dateStr, time: now.toFormat('HH:mm'), title: dateStr }));
      await createNoteFile(root, relPath, content);
      file = await readNoteFile(root, relPath);
    }
    await indexNote(db, root, relPath);
    notifyNoteChanged(db, root, relPath);
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
    notifyNoteChanged(db, root, relPath);
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

  app.post<{ Body: { id?: string } }>('/notes/inbox/triage/suggest', async (req, reply): Promise<InboxTriageSuggestionDTO | { error: string }> => {
    const id = req.body?.id;
    if (!id) return reply.code(400).send({ error: 'id is required' });
    const settings = getSettings(db);
    if (!settings.aiEnabled || !aiConfigured()) return reply.code(501).send({ error: 'AI is not enabled' });
    const relPath = normalizeNotePath(id);
    const file = await readNoteFile(getVaultRoot(db), relPath);
    if (!file) return reply.code(404).send({ error: 'not found' });
    const row = getNoteRow(db, relPath);
    const allRows = db.select().from(notes).all();
    const allowedFolders = [...new Set(allRows.map((note) => (note.id.includes('/') ? note.id.slice(0, note.id.lastIndexOf('/')) : '')).filter((folder) => folder && !folder.startsWith(settings.notesInboxFolder) && !folder.startsWith(settings.notesAttachmentsFolder)))].sort();
    if (!allowedFolders.length) allowedFolders.push(settings.notesInboxFolder);
    try {
      const suggestion = await suggestInboxTriage(gateway, settings.aiModel, settings.aiAboutMe, row?.title ?? relPath, file.content, allowedFolders, allRows.map((note) => note.title));
      const destinationFolder = allowedFolders.find((folder) => folder.toLowerCase() === suggestion.destinationFolder.toLowerCase()) ?? allowedFolders[0];
      const existingTitles = new Set(allRows.map((note) => note.title.toLowerCase()));
      return {
        suggestedTitle: suggestion.suggestedTitle,
        destinationFolder,
        tags: [...new Set(suggestion.tags.map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean))].slice(0, 6),
        links: [...new Set(suggestion.links.filter((title) => existingTitles.has(title.toLowerCase())))].slice(0, 6),
        summary: suggestion.summary,
      };
    } catch {
      return reply.code(503).send({ error: 'AI unavailable (offline?)' });
    }
  });

  app.post<{ Body: unknown }>('/notes/inbox/triage/apply', async (req, reply): Promise<NoteDTO | { error: string }> => {
    const parsed = InboxTriageApplySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const settings = getSettings(db);
    const root = getVaultRoot(db);
    const fromRel = normalizeNotePath(parsed.data.id);
    const current = await readNoteFile(root, fromRel);
    if (!current) return reply.code(404).send({ error: 'not found' });
    const nextContent = appendInboxTriage(current.content, {
      title: parsed.data.title,
      tags: parsed.data.tags,
      links: parsed.data.links,
      processed: true,
    });
    const folder = normalizeVaultFolder(parsed.data.destinationFolder, settings.notesInboxFolder);
    const candidate = normalizeNotePath(`${folder}/${sanitizeVoiceNoteTitle(parsed.data.title)}`);
    const allIds = new Set(db.select({ id: notes.id }).from(notes).all().map((row) => row.id.toLowerCase()));
    let toRel = candidate;
    let suffix = 2;
    while (toRel.toLowerCase() !== fromRel.toLowerCase() && allIds.has(toRel.toLowerCase())) {
      toRel = normalizeNotePath(`${folder}/${sanitizeVoiceNoteTitle(parsed.data.title)}-${suffix++}`);
    }
    if (fromRel.toLowerCase() !== toRel.toLowerCase()) {
      try {
        await moveNoteFile(root, fromRel, toRel);
      } catch (err) {
        if (err instanceof VaultConflictError || err instanceof VaultPathError) return reply.code(409).send({ error: err.message });
        throw err;
      }
      db.update(noteChunks).set({ noteId: toRel }).where(eq(noteChunks.noteId, fromRel)).run();
      removeNoteFromIndex(db, fromRel);
      void syncStudyCardsForNote(db, root, fromRel, settings.timezone);
    }
    await writeNoteFile(root, toRel, nextContent, settings.notesSnapshotRetention);
    await indexNote(db, root, toRel);
    notifyNoteChanged(db, root, toRel);
    const row = getNoteRow(db, toRel);
    return { ...toSummaryDTO(row!), content: nextContent };
  });

  app.post<{ Body: unknown }>('/notes/chat', async (req, reply): Promise<NoteChatResponseDTO | { error: string }> => {
    const parsed = NoteChatSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const settings = getSettings(db);
    if (settings.assistantEnabled) {
      try {
        const result = await runAssistantChat(db, {
          message: parsed.data.message,
          focusNoteIds: parsed.data.focusNoteIds,
        });
        return {
          answer: result.message.content,
          citations: result.citations
            .filter((citation) => citation.sourceType === 'note')
            .map((citation) => ({ id: citation.sourceId, title: citation.title })),
          scope: parsed.data.focusNoteIds?.length ? 'local' : classifyQuestion(parsed.data.message),
          focusNoteIds: result.focusNoteIds,
        };
      } catch (error) {
        return reply.code(503).send({ error: error instanceof Error ? error.message : 'Assistant unavailable' });
      }
    }
    if (!settings.aiEnabled || !aiConfigured()) return reply.code(501).send({ error: 'AI is not enabled' });

    const requestedFocus = parsed.data.focusNoteIds ?? [];
    let queryVector: number[] = [];
    if (requestedFocus.length === 0) {
      try {
        queryVector = await embedQuery(db, settings.aiEmbeddingModel, parsed.data.message);
      } catch {
        return reply.code(503).send({ error: 'AI unavailable (offline?)' });
      }
    }

    // GraphRAG (G4): route to the local (specific) or global (themes/overview) retrieval path.
    const scope = requestedFocus.length ? 'local' : classifyQuestion(parsed.data.message);
    const titleById = new Map(db.select({ id: notes.id, title: notes.title }).from(notes).all().map((r) => [r.id, r.title]));

    const context: { noteId: string; title: string; text: string }[] = [];
    const contextIds = new Set<string>();
    const addContext = (noteId: string, text: string) => {
      if (contextIds.has(noteId) || !text) return;
      contextIds.add(noteId);
      context.push({ noteId, title: titleById.get(noteId) ?? noteId, text });
    };

    for (const noteId of requestedFocus) if (titleById.has(noteId)) addContext(noteId, noteExcerpt(db, noteId, 1_200));

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
      result = await answerGraphChat(gateway, settings.aiModel, settings.aiAboutMe, parsed.data.message, parsed.data.history ?? [], scope, context, communityContext);
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
      return await suggestLinksAndTags(gateway, settings.aiModel, title, file.content, existingTitles);
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
      digestBody = await generateWeeklyDigest(gateway, settings.aiModel, settings.aiAboutMe, weekLabel, sourceNotes);
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
    queueGraphJob(db, 'embeddings');
    setTimeout(() => {
      startGraphJob(db, 'embeddings');
      void reembedAllNotes(db, root, settings.aiEnabled && aiConfigured(), settings.aiEmbeddingModel)
        .then(() => completeGraphJob(db, 'embeddings'))
        .catch((error) => failGraphJob(db, 'embeddings', error));
    }, 0);
    return { ok: true, count: 0, queued: true };
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
