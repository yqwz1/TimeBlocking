import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { blocks, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import type { SyncManager } from '../sync/manager.js';
import { getSettings } from '../settings.js';
import { getAuthedClient } from '../integrations/google/auth.js';
import { Gcal } from '../integrations/google/client.js';
import { blockHash } from '../sync/hash.js';
import { nowUtcIso } from '../config.js';
import { dueDatePatchForMove } from '../tasks/service.js';

export function registerBlockRoutes(app: FastifyInstance, db: DB, manager: SyncManager) {
  app.patch<{ Params: { id: string }; Body: { startUtc: string; endUtc: string } }>('/blocks/:id', async (req, reply) => {
    const row = db.select().from(blocks).where(eq(blocks.id, req.params.id)).get();
    if (!row) return reply.code(404).send({ error: 'not found' });
    const { startUtc, endUtc } = req.body;
    if (!startUtc || !endUtc) return reply.code(400).send({ error: 'startUtc & endUtc required' });
    const settings = getSettings(db);
    db.update(blocks)
      .set({ startUtc, endUtc, locked: 1, lastPushedHash: blockHash(startUtc, endUtc), updatedAtUtc: nowUtcIso() })
      .where(eq(blocks.id, row.id))
      .run();
    if (row.taskId) {
      const t = db.select().from(tasks).where(eq(tasks.id, row.taskId)).get();
      if (t?.dueDate) {
        const duePatch = dueDatePatchForMove(settings.timezone, startUtc, !!t.dueDatetimeUtc);
        db.update(tasks).set(duePatch).where(eq(tasks.id, t.id)).run();
      }
    }
    const auth = getAuthedClient(db);
    if (auth && settings.appCalendarId && row.gcalEventId) {
      // Push to Google in the background — the sync reconciler's hash-diff tick would
      // catch this anyway, and awaiting it here made every drag-and-drop wait on a live
      // Google API round-trip before the UI could settle.
      new Gcal(auth)
        .patchEvent(settings.appCalendarId, row.gcalEventId, {
          start: { dateTime: startUtc, timeZone: settings.timezone },
          end: { dateTime: endUtc, timeZone: settings.timezone },
        })
        .catch((err) => req.log.error({ err, blockId: row.id }, 'failed to push block move to Google Calendar'));
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/blocks/:id/lock', async (req, reply) => {
    const row = db.select().from(blocks).where(eq(blocks.id, req.params.id)).get();
    if (!row) return reply.code(404).send({ error: 'not found' });
    db.update(blocks).set({ locked: 1, updatedAtUtc: nowUtcIso() }).where(eq(blocks.id, row.id)).run();
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/blocks/:id/unlock', async (req, reply) => {
    const row = db.select().from(blocks).where(eq(blocks.id, req.params.id)).get();
    if (!row) return reply.code(404).send({ error: 'not found' });
    db.update(blocks).set({ locked: 0, updatedAtUtc: nowUtcIso() }).where(eq(blocks.id, row.id)).run();
    await manager.forcePlan('block-unlock');
    return { ok: true };
  });
}
