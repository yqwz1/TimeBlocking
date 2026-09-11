import type { FastifyInstance } from 'fastify';
import type { ScheduleItemDTO } from '@timeblock/shared';
import type { DB } from '../db/client.js';
import { getSettings } from '../settings.js';
import { getAuthedClient } from '../integrations/google/auth.js';
import { Gcal } from '../integrations/google/client.js';
import { readLocalSchedule } from '../plan/scheduleQuery.js';

export function registerScheduleRoutes(app: FastifyInstance, db: DB) {
  app.get<{ Querystring: { from?: string; to?: string; external?: string } }>('/schedule', async (req, reply): Promise<ScheduleItemDTO[] | { error: string }> => {
    const { from, to, external } = req.query;
    if (!from || !to) return reply.code(400).send({ error: 'from & to query params required (UTC ISO)' });
    const settings = getSettings(db);

    const items: ScheduleItemDTO[] = readLocalSchedule(db, from, to, settings.timezone);

    const auth = external === '0' ? null : getAuthedClient(db);
    if (auth) {
      const gcal = new Gcal(auth);
      const externalIds = settings.busyCalendarIds.filter((id) => id !== settings.appCalendarId);
      for (const calId of externalIds) {
        try {
          const events = await gcal.listEventsWindow(calId, from, to);
          for (const ev of events) {
            if (!ev.start?.dateTime || !ev.end?.dateTime || ev.status === 'cancelled' || !ev.id) continue;
            items.push({
              id: `ext:${calId}:${ev.id}`,
              kind: 'external',
              title: ev.summary ?? '(busy)',
              start: ev.start.dateTime,
              end: ev.end.dateTime,
              editable: false,
            });
          }
        } catch {
          // best-effort: a flaky external calendar shouldn't break the whole view
        }
      }
    }

    return items;
  });
}
