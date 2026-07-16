import { DateTime } from 'luxon';
import { eq, inArray } from 'drizzle-orm';
import type { Settings } from '@timeblock/shared';
import { blocks, habitInstances, tasks } from '../../db/schema.js';
import type { DB } from '../../db/client.js';
import { clearState, getState, setState } from '../../db/state.js';
import { blockHash } from '../../sync/hash.js';
import { logSync } from '../../log.js';
import { nowUtcIso } from '../../config.js';
import { APP_TAG, type Gcal, type GEvent } from './client.js';

export interface GooglePullResult {
  changed: boolean;
}

function toUtcIso(iso: string): string {
  return DateTime.fromISO(iso, { setZone: true }).toUTC().toISO({ suppressMilliseconds: true })!;
}

/**
 * Apply one changed event from the app calendar to our block state.
 * Returns true when something schedule-relevant changed (=> replan needed).
 */
function handleAppEvent(db: DB, ev: GEvent, settings: Settings): boolean {
  if (ev.extendedProperties?.private?.app !== APP_TAG) return false; // untagged: never touch
  if (!ev.id) return false;

  const block = db.select().from(blocks).where(eq(blocks.gcalEventId, ev.id)).get();
  if (!block) {
    if (ev.status !== 'cancelled') logSync(db, 'google', 'info', `orphan app event ignored: ${ev.id}`);
    return false;
  }

  if (ev.status === 'cancelled') {
    // Echoes of our own deletes and historical blocks are inert.
    if (block.status === 'cancelled' || block.status === 'done' || block.status === 'missed') return false;

    // The user deleted the block in Google Calendar.
    if (block.habitInstanceId) {
      db.update(habitInstances)
        .set({ status: 'skipped' })
        .where(eq(habitInstances.id, block.habitInstanceId))
        .run();
      logSync(db, 'google', 'info', `habit block deleted by user -> instance skipped (${block.id})`);
    } else if (block.taskId && settings.onBlockDeleted === 'unschedule') {
      db.update(tasks).set({ skipScheduling: 1, forceSchedule: 0 }).where(eq(tasks.id, block.taskId)).run();
      logSync(db, 'google', 'info', `block deleted by user -> task ${block.taskId} unscheduled`);
    } else {
      logSync(db, 'google', 'info', `block deleted by user -> task ${block.taskId} will be rescheduled`);
    }
    db.update(blocks)
      .set({ status: 'cancelled', updatedAtUtc: nowUtcIso() })
      .where(eq(blocks.id, block.id))
      .run();
    return true;
  }

  const start = ev.start?.dateTime;
  const end = ev.end?.dateTime;
  if (!start || !end) return false; // an all-day mutation we don't own

  const startUtc = toUtcIso(start);
  const endUtc = toUtcIso(end);
  const incoming = blockHash(startUtc, endUtc);

  if (incoming === block.lastPushedHash) {
    // Our own write echoing back.
    db.update(blocks).set({ gcalUpdated: ev.updated ?? null }).where(eq(blocks.id, block.id)).run();
    return false;
  }

  // The user dragged/resized the block: Calendar owns placement. Lock it.
  const revived = block.status === 'missed' && Date.parse(endUtc) > Date.now();
  db.update(blocks)
    .set({
      startUtc,
      endUtc,
      locked: 1,
      lastPushedHash: incoming, // accepted state; suppress any echo
      gcalUpdated: ev.updated ?? null,
      status: revived ? 'scheduled' : block.status,
      updatedAtUtc: nowUtcIso(),
    })
    .where(eq(blocks.id, block.id))
    .run();
  logSync(db, 'google', 'info', `user moved block ${block.id} -> ${startUtc} (locked)`);

  if (settings.updateDueOnMove && block.taskId) {
    db.update(tasks).set({ dueDatetimeUtc: startUtc, updatedAtUtc: nowUtcIso() }).where(eq(tasks.id, block.taskId)).run();
  }
  return true;
}

/**
 * After a 410 full resync: any block we believe is live but whose event no
 * longer exists was deleted by the user while we were desynced.
 */
function reconcileFullResync(db: DB, events: GEvent[], settings: Settings): boolean {
  const liveEventIds = new Set(events.filter((e) => e.status !== 'cancelled' && e.id).map((e) => e.id!));
  const liveBlocks = db
    .select()
    .from(blocks)
    .where(inArray(blocks.status, ['scheduled', 'pending_create']))
    .all();
  let changed = false;
  for (const b of liveBlocks) {
    if (b.gcalEventId && !liveEventIds.has(b.gcalEventId)) {
      const fake: GEvent = {
        id: b.gcalEventId,
        status: 'cancelled',
        extendedProperties: { private: { app: APP_TAG } },
      };
      changed = handleAppEvent(db, fake, settings) || changed;
    }
  }
  return changed;
}

export async function pullAppCalendar(db: DB, gcal: Gcal, settings: Settings): Promise<GooglePullResult> {
  const calId = settings.appCalendarId;
  const result: GooglePullResult = { changed: false };
  if (!calId) return result;

  const tokenKey = `gcal_sync_token:${calId}`;
  const token = getState(db, tokenKey);

  let pull = await gcal.listAppEventsIncremental(calId, token);
  if (pull.reset) {
    logSync(db, 'google', 'info', 'sync token expired (410) -> full resync');
    clearState(db, tokenKey);
    pull = await gcal.listAppEventsIncremental(calId, null);
    result.changed = reconcileFullResync(db, pull.events, settings) || result.changed;
  }

  for (const ev of pull.events) {
    result.changed = handleAppEvent(db, ev, settings) || result.changed;
  }
  if (pull.nextSyncToken) setState(db, tokenKey, pull.nextSyncToken);
  return result;
}
