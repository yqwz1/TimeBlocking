import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { attachments, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { attachmentToDTO } from '../plan/mappers.js';
import { DATA_DIR, nowUtcIso } from '../config.js';

const ATTACHMENTS_DIR = path.join(DATA_DIR, 'attachments');

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\- ]/g, '_').slice(0, 200) || 'file';
}

export function registerAttachmentRoutes(app: FastifyInstance, db: DB) {
  app.get<{ Params: { id: string } }>('/tasks/:id/attachments', async (req) => {
    return db.select().from(attachments).where(eq(attachments.taskId, req.params.id)).all().map(attachmentToDTO);
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/attachments', async (req, reply) => {
    const t = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
    if (!t) return reply.code(404).send({ error: 'task not found' });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'no file uploaded' });

    const id = randomUUID();
    const fileName = sanitizeFileName(file.filename);
    const dir = path.join(ATTACHMENTS_DIR, t.id);
    await fsp.mkdir(dir, { recursive: true });
    const diskPath = path.join(dir, `${id}-${fileName}`);
    const buffer = await file.toBuffer();
    await fsp.writeFile(diskPath, buffer);

    db.insert(attachments)
      .values({ id, taskId: t.id, fileName, mimeType: file.mimetype, sizeBytes: buffer.length, createdAtUtc: nowUtcIso() })
      .run();
    return reply.code(201).send(attachmentToDTO(db.select().from(attachments).where(eq(attachments.id, id)).get()!));
  });

  app.get<{ Params: { id: string } }>('/attachments/:id/file', async (req, reply) => {
    const a = db.select().from(attachments).where(eq(attachments.id, req.params.id)).get();
    if (!a) return reply.code(404).send({ error: 'not found' });
    const diskPath = path.join(ATTACHMENTS_DIR, a.taskId, `${a.id}-${a.fileName}`);
    if (!fs.existsSync(diskPath)) return reply.code(404).send({ error: 'file missing' });
    reply.header('Content-Type', a.mimeType || 'application/octet-stream');
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(a.fileName)}"`);
    return reply.send(fs.createReadStream(diskPath));
  });

  app.delete<{ Params: { id: string } }>('/attachments/:id', async (req, reply) => {
    const a = db.select().from(attachments).where(eq(attachments.id, req.params.id)).get();
    if (!a) return reply.code(404).send({ error: 'not found' });
    const diskPath = path.join(ATTACHMENTS_DIR, a.taskId, `${a.id}-${a.fileName}`);
    try {
      await fsp.unlink(diskPath);
    } catch {
      // already gone; still remove the row
    }
    db.delete(attachments).where(eq(attachments.id, a.id)).run();
    return { ok: true };
  });
}
