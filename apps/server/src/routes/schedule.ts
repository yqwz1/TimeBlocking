import type { FastifyInstance } from 'fastify';
import type { ScheduleItemDTO } from '@timeblock/shared';
import { blocks, events } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { getSettings } from '../settings.js';
import { getAuthedClient } from '../integrations/google/auth.js';
import { Gcal } from '../integrations/google/client.js';
import { blockToItem, eventToItem } from '../plan/mappers.js';

const VISIBLE_STATUSES = new Set(['scheduled', 'pending_create', 'done', 'missed']);

export function registerScheduleRoutes(app: FastifyInstance, db: DB) {
  app.get<{ Querystring: { from?: string; to?: string; external?: string } }>('/schedule', async (req, reply): Promise<ScheduleItemDTO[] | { error: string }> => {
    const { from, to, external } = req.query;
    if (!from || !to) return reply.code(400).send({ error: 'from & to query params required (UTC ISO)' });
    const settings = getSettings(db);

    const rows = db
      .select()
      .from(blocks)
      .all()
      .filter((b) => VISIBLE_STATUSES.has(b.status) && b.startUtc < to && b.endUtc > from);

    const items: ScheduleItemDTO[] = rows.map((b) => blockToItem(db, b));

    // Native events (meetings) — fixed-time entries rendered straight from our store.
    const eventRows = db
      .select()
      .from(events)
      .all()
      .filter((e) => e.startUtc < to && e.endUtc > from);
    for (const e of eventRows) items.push(eventToItem(e));

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
