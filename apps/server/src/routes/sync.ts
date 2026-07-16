import type { FastifyInstance } from 'fastify';
import type { ReminderFiredEventDTO, SyncStatusDTO } from '@timeblock/shared';
import type { DB } from '../db/client.js';
import type { SyncManager } from '../sync/manager.js';

export function registerSyncRoutes(app: FastifyInstance, _db: DB, manager: SyncManager) {
  app.post('/sync', async (): Promise<SyncStatusDTO> => {
    await manager.runCycle('manual', { forceGoogle: true });
    return manager.getStatus();
  });

  app.get('/sync/status', async (): Promise<SyncStatusDTO> => manager.getStatus());

  // /recalculate is retired — auto-apply is gated behind settings.autoApply, and
  // the equivalent "clean redraft" now happens via POST /plan/proposal + apply
  // (see routes/proposal.ts). Kept as a redirect-free 410 so old clients fail loudly.
  app.post('/recalculate', async (_req, reply) => reply.code(410).send({ error: 'retired: use POST /plan/proposal' }));

  app.get('/events', async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (status: SyncStatusDTO) => reply.raw.write(`data: ${JSON.stringify(status)}\n\n`);
    send(manager.getStatus());
    const onUpdate = (status: SyncStatusDTO) => send(status);
    manager.on('update', onUpdate);
    const onReminder = (dto: ReminderFiredEventDTO) => reply.raw.write(`event: reminder\ndata: ${JSON.stringify(dto)}\n\n`);
    manager.on('reminder', onReminder);
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      manager.off('update', onUpdate);
      manager.off('reminder', onReminder);
      reply.raw.end();
    });
  });
}
