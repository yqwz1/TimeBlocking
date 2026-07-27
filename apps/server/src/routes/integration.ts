import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { DateTime } from 'luxon';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { blocks, notes, tasks as nativeTasks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { env } from '../config.js';
import { getSettings } from '../settings.js';
import { indexNote, searchNotes } from '../notes/indexer.js';
import { listTemplates, renderTemplate } from '../notes/templates.js';
import {
  createNoteFile,
  getVaultRoot,
  normalizeNotePath,
  readNoteFile,
  VaultConflictError,
  VaultPathError,
  writeNoteFile,
} from '../notes/vault.js';
import { notifyNoteChanged } from './notes.js';
import { decodeIntegrationNoteId, encodeIntegrationNoteId } from '../integrations/secondBrain/ids.js';
import { completeMarkdownTask, extractMarkdownTasks, type MarkdownTask } from '../integrations/secondBrain/tasks.js';
import { appendDailyReflection, ensureTodaysBlocksSection, syncDailyBlocks, type DailyBlock } from '../integrations/secondBrain/dailyNotes.js';
import { appendIntegrationEvent, readIntegrationEvents } from '../integrations/secondBrain/events.js';

type NoteRow = typeof notes.$inferSelect;

function tokenMatches(actual: string): boolean {
  const expectedHash = createHash('sha256').update(env.integrationToken).digest();
  const actualHash = createHash('sha256').update(actual).digest();
  return timingSafeEqual(expectedHash, actualHash);
}

async function authorize(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin.replace(/\/$/, '') : '';
  if (origin && (!env.integrationOrigin || origin !== env.integrationOrigin.replace(/\/$/, ''))) {
    await reply.code(403).send({ error: 'origin is not allowed' });
    return;
  }
  if (origin) {
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return;
  if (!env.integrationToken) {
    await reply.code(503).send({ error: 'integration API is disabled; set TB_INTEGRATION_TOKEN' });
    return;
  }
  const authorization = req.headers.authorization ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token || !tokenMatches(token)) await reply.code(401).send({ error: 'invalid integration token' });
}

function parseTags(row: NoteRow): string[] {
  try { return JSON.parse(row.tags) as string[]; } catch { return []; }
}

function noteDto(row: NoteRow, content?: string) {
  const id = encodeIntegrationNoteId(row.id);
  return {
    id,
    path: row.id,
    title: row.title,
    tags: parseTags(row),
    createdAt: row.createdAtUtc,
    updatedAt: row.updatedAtUtc,
    url: `${env.publicAppUrl}/note/${id}`,
    ...(content === undefined ? {} : { content }),
  };
}

function rowFor(db: DB, notePath: string): NoteRow | undefined {
  return db.select().from(notes).where(eq(notes.id, notePath)).get();
}

function decodeId(id: string, reply: FastifyReply): string | null {
  try {
    const notePath = normalizeNotePath(decodeIntegrationNoteId(id));
    if (notePath === '..' || notePath.startsWith('../') || notePath.includes('/../')) throw new Error('invalid note id');
    return notePath;
  } catch {
    void reply.code(400).send({ error: 'invalid note id' });
    return null;
  }
}

function blocksForDate(db: DB, date: string, timezone: string): DailyBlock[] {
  const start = DateTime.fromISO(date, { zone: timezone }).startOf('day').toMillis();
  const end = DateTime.fromISO(date, { zone: timezone }).plus({ days: 1 }).startOf('day').toMillis();
  return db
    .select({
      id: blocks.id,
      startUtc: blocks.startUtc,
      endUtc: blocks.endUtc,
      status: blocks.status,
      taskTitle: nativeTasks.content,
    })
    .from(blocks)
    .leftJoin(nativeTasks, eq(blocks.taskId, nativeTasks.id))
    .all()
    .filter((block) => {
      const time = Date.parse(block.startUtc);
      return time >= start && time < end && block.status !== 'cancelled';
    })
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc))
    .map((block) => ({
      id: block.id,
      title: block.taskTitle ?? 'Time block',
      startUtc: block.startUtc,
      endUtc: block.endUtc,
      status: block.status,
      url: `${env.timeblockAppUrl}/plan/${encodeURIComponent(block.id)}`,
    }));
}

async function dailyNote(db: DB, date: string) {
  const settings = getSettings(db);
  const root = getVaultRoot(db);
  const notePath = normalizeNotePath(`${settings.notesDailyFolder}/${date}`);
  let file = await readNoteFile(root, notePath);
  if (!file) {
    const templates = await listTemplates(root, settings.notesTemplatesFolder);
    const template = templates.find((candidate) => path.basename(candidate.id).replace(/\.md$/i, '').toLowerCase() === 'daily');
    const source = template ? (await readNoteFile(root, template.id))?.content ?? '# {{date}}\n\n' : '# {{date}}\n\n';
    const localNow = DateTime.now().setZone(settings.timezone);
    const content = ensureTodaysBlocksSection(renderTemplate(source, { date, time: localNow.toFormat('HH:mm'), title: date }));
    await createNoteFile(root, notePath, content);
    file = await readNoteFile(root, notePath);
  }
  return { settings, root, notePath, file: file! };
}

async function persistExternalNote(db: DB, root: string, notePath: string, content: string): Promise<NoteRow> {
  const settings = getSettings(db);
  await writeNoteFile(root, notePath, content, settings.notesSnapshotRetention);
  await indexNote(db, root, notePath);
  notifyNoteChanged(db, root, notePath);
  return rowFor(db, notePath)!;
}

export function registerIntegrationRoutes(app: FastifyInstance, db: DB): void {
  app.addHook('onRequest', authorize);

  app.get<{ Querystring: { query?: string } }>('/notes', async (req) => {
    const query = (req.query.query ?? '').trim();
    if (!query) return db.select().from(notes).orderBy(asc(notes.id)).all().map((row) => noteDto(row));
    return searchNotes(db, query).map((hit) => ({ ...noteDto(rowFor(db, hit.id)!), snippet: hit.snip }));
  });

  app.get<{ Params: { id: string } }>('/notes/:id', async (req, reply) => {
    const notePath = decodeId(req.params.id, reply);
    if (!notePath) return;
    const file = await readNoteFile(getVaultRoot(db), notePath);
    const row = rowFor(db, notePath);
    if (!file || !row) return reply.code(404).send({ error: 'note not found' });
    return noteDto(row, file.content);
  });

  app.post<{ Body: { path?: string; title?: string; content?: string } }>('/notes', async (req, reply) => {
    const requestedPath = req.body?.path?.trim();
    if (!requestedPath) return reply.code(400).send({ error: 'path is required' });
    const root = getVaultRoot(db);
    let notePath: string;
    try { notePath = normalizeNotePath(requestedPath); } catch { return reply.code(400).send({ error: 'invalid path' }); }
    const title = req.body.title?.trim() || path.basename(notePath).replace(/\.md$/i, '');
    const content = req.body.content ?? `# ${title}\n\n`;
    try {
      await createNoteFile(root, notePath, content);
    } catch (error) {
      if (error instanceof VaultConflictError || error instanceof VaultPathError) return reply.code(409).send({ error: error.message });
      throw error;
    }
    await indexNote(db, root, notePath);
    notifyNoteChanged(db, root, notePath);
    const row = rowFor(db, notePath)!;
    await appendIntegrationEvent('note.created', { noteId: encodeIntegrationNoteId(notePath), path: notePath });
    return reply.code(201).send(noteDto(row, content));
  });

  app.patch<{ Params: { id: string }; Body: { content?: string; expectedUpdatedAt?: string } }>('/notes/:id', async (req, reply) => {
    const notePath = decodeId(req.params.id, reply);
    if (!notePath) return;
    if (typeof req.body?.content !== 'string') return reply.code(400).send({ error: 'content is required' });
    const root = getVaultRoot(db);
    const current = await readNoteFile(root, notePath);
    if (!current) return reply.code(404).send({ error: 'note not found' });
    if (req.body.expectedUpdatedAt && req.body.expectedUpdatedAt !== current.updatedAtUtc) {
      return reply.code(409).send({ error: 'conflict', serverContent: current.content, serverUpdatedAt: current.updatedAtUtc });
    }
    const row = await persistExternalNote(db, root, notePath, req.body.content);
    await appendIntegrationEvent('note.updated', { noteId: req.params.id, path: notePath });
    return noteDto(row, req.body.content);
  });

  app.get<{ Querystring: { status?: 'open' | 'done' | 'all' } }>('/tasks', async (req) => {
    const root = getVaultRoot(db);
    const all: Array<MarkdownTask & { noteId: string; noteUrl: string }> = [];
    for (const row of db.select().from(notes).orderBy(asc(notes.id)).all()) {
      const file = await readNoteFile(root, row.id);
      if (!file) continue;
      const noteId = encodeIntegrationNoteId(row.id);
      for (const task of extractMarkdownTasks(row.id, row.title, parseTags(row), file.content)) {
        if (req.query.status === 'open' && task.completed) continue;
        if (req.query.status === 'done' && !task.completed) continue;
        all.push({ ...task, noteId, noteUrl: `${env.publicAppUrl}/note/${noteId}` });
      }
    }
    return all;
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/complete', async (req, reply) => {
    const root = getVaultRoot(db);
    for (const row of db.select().from(notes).all()) {
      const file = await readNoteFile(root, row.id);
      if (!file) continue;
      const next = completeMarkdownTask(file.content, req.params.id, row.id, row.title, parseTags(row));
      if (next === null) continue;
      const updated = await persistExternalNote(db, root, row.id, next);
      await appendIntegrationEvent('task.completed', { taskId: req.params.id, noteId: encodeIntegrationNoteId(row.id), path: row.id });
      return { ok: true, note: noteDto(updated, next) };
    }
    return reply.code(404).send({ error: 'task not found; the source line may have changed' });
  });

  app.post<{ Params: { date: string } }>('/daily/:date/sync', async (req, reply) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    const { settings, root, notePath, file } = await dailyNote(db, req.params.date);
    const dayBlocks = blocksForDate(db, req.params.date, settings.timezone);
    const content = syncDailyBlocks(file.content, dayBlocks, settings.timezone);
    const row = await persistExternalNote(db, root, notePath, content);
    await appendIntegrationEvent('daily.blocks_synced', { date: req.params.date, noteId: encodeIntegrationNoteId(notePath), blockCount: dayBlocks.length });
    return noteDto(row, content);
  });

  app.post<{ Params: { date: string }; Body: { reflection?: string } }>('/daily/:date/reflection', async (req, reply) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
    const { settings, root, notePath, file } = await dailyNote(db, req.params.date);
    const dayBlocks = blocksForDate(db, req.params.date, settings.timezone);
    const withBlocks = syncDailyBlocks(file.content, dayBlocks, settings.timezone);
    const content = appendDailyReflection(withBlocks, req.body?.reflection ?? '', dayBlocks, settings.timezone);
    const row = await persistExternalNote(db, root, notePath, content);
    await appendIntegrationEvent('daily.reflection_appended', { date: req.params.date, noteId: encodeIntegrationNoteId(notePath) });
    return noteDto(row, content);
  });

  app.get<{ Querystring: { after?: string } }>('/events', async (req) => ({ enabled: env.integrationEventLog, events: await readIntegrationEvents(req.query.after) }));
}
