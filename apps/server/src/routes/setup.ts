import type { FastifyInstance } from 'fastify';
import type { CalendarListEntryDTO, SetupStatusDTO } from '@timeblock/shared';
import type { DB } from '../db/client.js';
import type { SyncManager } from '../sync/manager.js';
import { getSettings, updateSettings } from '../settings.js';
import { disconnectGoogle, getAuthUrl, getAuthedClient, googleCredsPresent, isGoogleAuthed } from '../integrations/google/auth.js';
import { Gcal } from '../integrations/google/client.js';

export function registerSetupRoutes(app: FastifyInstance, db: DB, manager: SyncManager) {
  app.get('/setup/status', async (): Promise<SetupStatusDTO> => {
    const settings = getSettings(db);
    return {
      googleCredsPresent: googleCredsPresent(),
      google: isGoogleAuthed(db),
      calendarChosen: !!settings.appCalendarId,
    };
  });

  app.get('/auth/google/start', async (_req, reply) => {
    if (!googleCredsPresent()) return reply.code(400).send({ error: 'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set in .env' });
    return reply.redirect(getAuthUrl());
  });

  app.post('/setup/google/disconnect', async () => {
    disconnectGoogle(db);
    return { ok: true };
  });

  app.get('/setup/calendars', async (): Promise<CalendarListEntryDTO[]> => {
    const auth = getAuthedClient(db);
    if (!auth) return [];
    return new Gcal(auth).listCalendars();
  });

  app.post<{ Body: { busyCalendarIds?: string[] } }>('/setup/calendars', async (req, reply) => {
    const auth = getAuthedClient(db);
    if (!auth) return reply.code(400).send({ error: 'connect Google first' });
    const gcal = new Gcal(auth);
    const settings = getSettings(db);
    const appCalendarId = settings.appCalendarId ?? (await gcal.createAppCalendar(settings.timezone));
    const busyCalendarIds = [...new Set([...(req.body?.busyCalendarIds ?? []), appCalendarId])];
    updateSettings(db, { appCalendarId, busyCalendarIds });
    await manager.runCycle('setup-calendars', { forceGoogle: true, forcePlan: true });
    return { ok: true, appCalendarId };
  });
}
