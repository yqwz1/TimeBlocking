import type { FastifyInstance } from 'fastify';
import { SettingsSchema, type Settings } from '@timeblock/shared';
import type { DB } from '../db/client.js';
import type { SyncManager } from '../sync/manager.js';
import { getSettings, updateSettings } from '../settings.js';
import { GMAIL_SEND_SCOPE, hasGoogleScope, tokenEncryptionConfigured } from '../integrations/google/auth.js';

export function registerSettingsRoutes(app: FastifyInstance, db: DB, manager: SyncManager) {
  app.get('/settings', async (): Promise<Settings> => getSettings(db));

  app.put<{ Body: Partial<Settings> }>('/settings', async (req, reply) => {
    const parsed = SettingsSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    if (parsed.data.emailNotificationsEnabled) {
      if (!tokenEncryptionConfigured()) return reply.code(400).send({ error: 'Set TB_TOKEN_ENCRYPTION_KEY (at least 32 characters) before enabling email notifications.' });
      if (!hasGoogleScope(db, GMAIL_SEND_SCOPE)) return reply.code(400).send({ error: 'Connect Gmail and grant send permission before enabling email notifications.' });
    }
    const next = updateSettings(db, parsed.data);
    await manager.forcePlan('settings-changed');
    return next;
  });
}
