import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import {
  BoardFileInputSchema,
  BoardInputSchema,
  BoardPatchSchema,
  BoardSceneInputSchema,
  type BoardDTO,
  type BoardFileDTO,
  type BoardSceneDTO,
} from '@timeblock/shared';
import { whiteboardFiles, whiteboardScenes, whiteboards } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { boardToDTO } from '../plan/mappers.js';
import { DATA_DIR, nowUtcIso } from '../config.js';

const BOARDS_DIR = path.join(DATA_DIR, 'whiteboards');

function boardDir(boardId: string): string {
  return path.join(BOARDS_DIR, boardId);
}

function safeJsonArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function extractTexts(elements: unknown[]): string[] {
  const out: string[] = [];
  for (const el of elements) {
    if (!el || typeof el !== 'object') continue;
    const e = el as Record<string, unknown>;
    if (e.type === 'text' && typeof e.text === 'string' && e.text.trim()) out.push(e.text);
  }
  return out;
}

function snippetAround(text: string, needle: string): string {
  const idx = text.toLowerCase().indexOf(needle);
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + needle.length + 40);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export function registerWhiteboardRoutes(app: FastifyInstance, db: DB) {
  app.get<{ Querystring: { q?: string } }>('/whiteboards', async (req): Promise<BoardDTO[]> => {
    const rows = db.select().from(whiteboards).orderBy(whiteboards.sortOrder, desc(whiteboards.updatedAtUtc)).all();
    const q = (req.query.q ?? '').trim().toLowerCase();
    if (!q) return rows.map(boardToDTO);

    const results: BoardDTO[] = [];
    for (const b of rows) {
      const nameMatch = b.name.toLowerCase().includes(q);
      let matchSnippet: string | null = null;
      const scene = db.select().from(whiteboardScenes).where(eq(whiteboardScenes.boardId, b.id)).get();
      if (scene) {
        const texts = extractTexts(safeJsonArray(scene.elements));
        const hit = texts.find((t) => t.toLowerCase().includes(q));
        if (hit) matchSnippet = snippetAround(hit, q);
      }
      if (nameMatch || matchSnippet) results.push({ ...boardToDTO(b), matchSnippet });
    }
    return results;
  });

  app.post<{ Body: unknown }>('/whiteboards', async (req, reply) => {
    const parsed = BoardInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const maxSort = db.select().from(whiteboards).all().reduce((m, b) => Math.max(m, b.sortOrder), -1);
    const id = randomUUID();
    const now = nowUtcIso();
    db.insert(whiteboards)
      .values({ id, name: parsed.data.name, sortOrder: maxSort + 1, createdAtUtc: now, updatedAtUtc: now })
      .run();
    db.insert(whiteboardScenes).values({ boardId: id, elements: '[]', appState: '{}', updatedAtUtc: now }).run();
    return reply.code(201).send(boardToDTO(db.select().from(whiteboards).where(eq(whiteboards.id, id)).get()!));
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/whiteboards/:id', async (req, reply) => {
    const b = db.select().from(whiteboards).where(eq(whiteboards.id, req.params.id)).get();
    if (!b) return reply.code(404).send({ error: 'not found' });
    const parsed = BoardPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const patch: Partial<typeof whiteboards.$inferInsert> = { updatedAtUtc: nowUtcIso() };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.sortOrder !== undefined) patch.sortOrder = parsed.data.sortOrder;
    db.update(whiteboards).set(patch).where(eq(whiteboards.id, b.id)).run();
    return boardToDTO(db.select().from(whiteboards).where(eq(whiteboards.id, b.id)).get()!);
  });

  app.delete<{ Params: { id: string } }>('/whiteboards/:id', async (req, reply) => {
    const b = db.select().from(whiteboards).where(eq(whiteboards.id, req.params.id)).get();
    if (!b) return reply.code(404).send({ error: 'not found' });
    db.delete(whiteboardFiles).where(eq(whiteboardFiles.boardId, b.id)).run();
    db.delete(whiteboardScenes).where(eq(whiteboardScenes.boardId, b.id)).run();
    db.delete(whiteboards).where(eq(whiteboards.id, b.id)).run();
    await fsp.rm(boardDir(b.id), { recursive: true, force: true });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/whiteboards/:id/scene', async (req, reply): Promise<BoardSceneDTO | { error: string }> => {
    const b = db.select().from(whiteboards).where(eq(whiteboards.id, req.params.id)).get();
    if (!b) return reply.code(404).send({ error: 'not found' });
    const scene = db.select().from(whiteboardScenes).where(eq(whiteboardScenes.boardId, b.id)).get();
    return { elements: scene ? safeJsonArray(scene.elements) : [], appState: scene ? safeJsonObject(scene.appState) : {} };
  });

  app.put<{ Params: { id: string }; Body: unknown }>('/whiteboards/:id/scene', async (req, reply) => {
    const b = db.select().from(whiteboards).where(eq(whiteboards.id, req.params.id)).get();
    if (!b) return reply.code(404).send({ error: 'not found' });
    const parsed = BoardSceneInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const now = nowUtcIso();
    const values = {
      boardId: b.id,
      elements: JSON.stringify(parsed.data.elements),
      appState: JSON.stringify(parsed.data.appState),
      updatedAtUtc: now,
    };
    db.insert(whiteboardScenes).values(values).onConflictDoUpdate({ target: whiteboardScenes.boardId, set: values }).run();
    db.update(whiteboards).set({ updatedAtUtc: now }).where(eq(whiteboards.id, b.id)).run();
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/whiteboards/:id/files', async (req, reply): Promise<BoardFileDTO[]> => {
    const b = db.select().from(whiteboards).where(eq(whiteboards.id, req.params.id)).get();
    if (!b) return reply.code(404).send([]);
    const rows = db.select().from(whiteboardFiles).where(eq(whiteboardFiles.boardId, b.id)).all();
    const out: BoardFileDTO[] = [];
    for (const r of rows) {
      const diskPath = path.join(boardDir(b.id), r.id);
      if (!fs.existsSync(diskPath)) continue;
      const buf = await fsp.readFile(diskPath);
      out.push({ id: r.id, mimeType: r.mimeType, dataUrl: `data:${r.mimeType};base64,${buf.toString('base64')}` });
    }
    return out;
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/whiteboards/:id/files', async (req, reply) => {
    const b = db.select().from(whiteboards).where(eq(whiteboards.id, req.params.id)).get();
    if (!b) return reply.code(404).send({ error: 'not found' });
    const parsed = BoardFileInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const { id, mimeType, dataUrl } = parsed.data;
    const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
    const buffer = Buffer.from(base64, 'base64');
    const dir = boardDir(b.id);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, id), buffer);
    const now = nowUtcIso();
    db.insert(whiteboardFiles)
      .values({ id, boardId: b.id, mimeType, sizeBytes: buffer.length, createdAtUtc: now })
      .onConflictDoUpdate({ target: whiteboardFiles.id, set: { mimeType, sizeBytes: buffer.length } })
      .run();
    return reply.code(201).send({ ok: true });
  });
}
