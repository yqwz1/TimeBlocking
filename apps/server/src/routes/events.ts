import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { EventInputSchema, EventPatchSchema, type EventDTO } from '@timeblock/shared';
import { events } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { getSettings } from '../settings.js';
import { getAuthedClient } from '../integrations/google/auth.js';
import { APP_TAG, eventIdForBlock, Gcal, type GEvent } from '../integrations/google/client.js';
import { eventToDTO } from '../plan/mappers.js';
import { blockHash } from '../sync/hash.js';
import { nowUtcIso } from '../config.js';

type EventRow = typeof events.$inferSelect;

function gcalOf(db: DB): Gcal | null {
  const auth = getAuthedClient(db);
  return auth ? new Gcal(auth) : null;
}

/**
 * Build the Google payload for an event. Tagged with `source` (not `app`) so the
 * app-calendar pull's `app === APP_TAG` check skips it — one-way push, no orphan
 * churn and no risk of the reconciler deleting it.
 */
function gEventOf(e: EventRow, timezone: string): GEvent {
  const descParts = [e.description, e.meetingUrl ? `Join: ${e.meetingUrl}` : ''].filter(Boolean);
  return {
    summary: e.title,
    description: descParts.join('\n\n') || undefined,
    location: e.location || undefined,
    start: { dateTime: e.startUtc, timeZone: timezone },
    end: { dateTime: e.endUtc, timeZone: timezone },
    extendedProperties: { private: { source: APP_TAG, kind: 'event', eventId: e.id } },
  };
}

export function registerEventRoutes(app: FastifyInstance, db: DB) {
  app.get('/calendar-events', async () => db.select().from(events).all().map(eventToDTO));

  app.get<{ Params: { id: string } }>('/calendar-events/:id', async (req, reply) => {
    const e = db.select().from(events).where(eq(events.id, req.params.id)).get();
    if (!e) return reply.code(404).send({ error: 'not found' });
    return eventToDTO(e);
  });

  app.post<{ Body: unknown }>('/calendar-events', async (req, reply): Promise<EventDTO | { error: string }> => {
    const parsed = EventInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const input = parsed.data;
    if (input.startUtc >= input.endUtc) return reply.code(400).send({ error: 'startUtc must be before endUtc' });

    const settings = getSettings(db);
    const now = nowUtcIso();
    const id = randomUUID();
    const gcal = gcalOf(db);
    const canPush = !!(gcal && settings.appCalendarId);
    const gcalEventId = canPush ? eventIdForBlock(id) : null;

    db.insert(events)
      .values({
        id,
        title: input.title,
        description: input.description ?? '',
        location: input.location ?? '',
        meetingUrl: input.meetingUrl?.trim() ? input.meetingUrl.trim() : null,
        color: input.color ?? null,
        priority: input.priority ?? 1,
        difficulty: input.difficulty ?? null,
        startUtc: input.startUtc,
        endUtc: input.endUtc,
        reminderMinutesBefore: input.reminderMinutesBefore ?? null,
        gcalEventId,
        calendarId: canPush ? settings.appCalendarId : null,
        lastPushedHash: canPush ? blockHash(input.startUtc, input.endUtc) : null,
        createdAtUtc: now,
        updatedAtUtc: now,
      })
      .run();

    const row = db.select().from(events).where(eq(events.id, id)).get()!;
    if (canPush && gcalEventId) {
      void gcal!
        .insertEvent(settings.appCalendarId!, { id: gcalEventId, ...gEventOf(row, settings.timezone) })
        .catch((err) => req.log.error({ err, eventId: id }, 'failed to push event insert to Google Calendar'));
    }
    return reply.code(201).send(eventToDTO(row));
  });

  app.patch<{ Params: { id: string }; Body: unknown }>('/calendar-events/:id', async (req, reply) => {
    const existing = db.select().from(events).where(eq(events.id, req.params.id)).get();
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const parsed = EventPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const input = parsed.data;

    const patch: Partial<typeof events.$inferInsert> = { updatedAtUtc: nowUtcIso() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.location !== undefined) patch.location = input.location;
    if (input.meetingUrl !== undefined) patch.meetingUrl = input.meetingUrl.trim() ? input.meetingUrl.trim() : null;
    if (input.color !== undefined) patch.color = input.color ?? null;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.difficulty !== undefined) patch.difficulty = input.difficulty ?? null;
    if (input.startUtc !== undefined) patch.startUtc = input.startUtc;
    if (input.endUtc !== undefined) patch.endUtc = input.endUtc;
    if (input.reminderMinutesBefore !== undefined) {
      patch.reminderMinutesBefore = input.reminderMinutesBefore ?? null;
      patch.reminderFiredAtUtc = null; // re-arm on change
    }

    const start = patch.startUtc ?? existing.startUtc;
    const end = patch.endUtc ?? existing.endUtc;
    if (start >= end) return reply.code(400).send({ error: 'startUtc must be before endUtc' });
    if (patch.startUtc || patch.endUtc) patch.lastPushedHash = blockHash(start, end);

    db.update(events).set(patch).where(eq(events.id, existing.id)).run();
    const row = db.select().from(events).where(eq(events.id, existing.id)).get()!;

    const settings = getSettings(db);
    const gcal = gcalOf(db);
    if (gcal && settings.appCalendarId && existing.gcalEventId) {
      void gcal
        .patchEvent(settings.appCalendarId, existing.gcalEventId, gEventOf(row, settings.timezone))
        .catch((err) => req.log.error({ err, eventId: row.id }, 'failed to push event patch to Google Calendar'));
    }
    return eventToDTO(row);
  });

  app.delete<{ Params: { id: string } }>('/calendar-events/:id', async (req, reply) => {
    const existing = db.select().from(events).where(eq(events.id, req.params.id)).get();
    if (!existing) return reply.code(404).send({ error: 'not found' });
    db.delete(events).where(eq(events.id, existing.id)).run();

    const settings = getSettings(db);
    const gcal = gcalOf(db);
    if (gcal && settings.appCalendarId && existing.gcalEventId) {
      void gcal
        .deleteEvent(settings.appCalendarId, existing.gcalEventId)
        .catch((err) => req.log.error({ err, eventId: existing.id }, 'failed to delete Google Calendar event'));
    }
    return { ok: true };
  });
}
