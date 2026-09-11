import type { FastifyInstance } from 'fastify';
import type { EmailNotificationStatusDTO } from '@timeblock/shared';
import type { DB } from '../db/client.js';
import type { EmailNotificationService } from '../email/service.js';
import {
  DRIVE_READONLY_SCOPE,
  getAuthUrl,
  googleCredsPresent,
  hasGoogleScope,
  tokenEncryptionConfigured,
} from '../integrations/google/auth.js';

export function registerEmailRoutes(app: FastifyInstance, db: DB, service: EmailNotificationService) {
  app.get('/email/status', async (): Promise<EmailNotificationStatusDTO> => service.status());

  app.get('/email/connect', async (_req, reply) => {
    if (!googleCredsPresent()) return reply.code(400).send({ error: 'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set in .env' });
    if (!tokenEncryptionConfigured()) {
      return reply.code(400).send({ error: 'Set TB_TOKEN_ENCRYPTION_KEY (at least 32 characters) before enabling email notifications.' });
    }
    return reply.redirect(getAuthUrl({
      includeDriveReadonly: hasGoogleScope(db, DRIVE_READONLY_SCOPE),
      includeGmailSend: true,
      state: 'email-notifications',
    }));
  });

  app.post('/email/test', async (_req, reply) => {
    try {
      await service.sendTest();
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
