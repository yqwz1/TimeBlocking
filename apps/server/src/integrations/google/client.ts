import { calendar, type calendar_v3 } from '@googleapis/calendar';
import type { OAuth2Client } from 'google-auth-library';

export type GEvent = calendar_v3.Schema$Event;

export const APP_CALENDAR_NAME = '⏱ Time Blocks';
export const APP_TAG = 'timeblock';

/** Every Google request aborts after this long so a dead/flaky link can't hang the sync loop. */
const REQUEST_TIMEOUT_MS = 15_000;
const REQ_OPTS = { timeout: REQUEST_TIMEOUT_MS } as const;

function statusOf(err: unknown): number {
  const e = err as { code?: number | string; status?: number; response?: { status?: number } };
  const raw = e?.response?.status ?? e?.status ?? e?.code;
  return typeof raw === 'string' ? Number(raw) : (raw ?? 0);
}

/** Network/connectivity error codes (no internet, DNS failure, dropped socket, request timeout). */
const OFFLINE_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNABORTED',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'EPIPE',
]);

/**
 * True when an error looks like a lost/absent internet connection rather than a
 * genuine API rejection (auth revoked, 4xx/5xx). Used to pause sync calmly and
 * auto-resume instead of surfacing a scary error.
 */
export function isOfflineError(err: unknown): boolean {
  const e = err as { code?: string; errno?: string; message?: string; cause?: { code?: string } };
  const code = e?.code ?? e?.errno ?? e?.cause?.code;
  if (typeof code === 'string' && OFFLINE_CODES.has(code)) return true;
  const msg = (e?.message ?? '').toLowerCase();
  return (
    msg.includes('getaddrinfo') ||
    msg.includes('enotfound') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('request to')
  );
}

export interface BusyInterval {
  start: string; // ISO
  end: string;
}

export class Gcal {
  private api: calendar_v3.Calendar;

  constructor(auth: OAuth2Client) {
    this.api = calendar({ version: 'v3', auth });
  }

  async listCalendars(): Promise<{ id: string; summary: string; primary: boolean }[]> {
    const res = await this.api.calendarList.list({ maxResults: 250 }, REQ_OPTS);
    return (res.data.items ?? [])
      .filter((c) => c.id)
      .map((c) => ({ id: c.id!, summary: c.summary ?? c.id!, primary: !!c.primary }));
  }

  async createAppCalendar(tz: string): Promise<string> {
    const res = await this.api.calendars.insert(
      { requestBody: { summary: APP_CALENDAR_NAME, timeZone: tz } },
      REQ_OPTS,
    );
    return res.data.id!;
  }

  /** Server-side merged busy intervals (recurring events are expanded, transparent events excluded). */
  async freeBusy(calendarIds: string[], timeMinIso: string, timeMaxIso: string): Promise<BusyInterval[]> {
    if (calendarIds.length === 0) return [];
    const res = await this.api.freebusy.query(
      { requestBody: { timeMin: timeMinIso, timeMax: timeMaxIso, items: calendarIds.map((id) => ({ id })) } },
      REQ_OPTS,
    );
    const out: BusyInterval[] = [];
    for (const cal of Object.values(res.data.calendars ?? {})) {
      for (const b of cal.busy ?? []) {
        if (b.start && b.end) out.push({ start: b.start, end: b.end });
      }
    }
    return out;
  }

  /** Windowed listing with titles, for showing external events in the UI. */
  async listEventsWindow(calendarId: string, timeMinIso: string, timeMaxIso: string): Promise<GEvent[]> {
    const events: GEvent[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.api.events.list(
        {
          calendarId,
          timeMin: timeMinIso,
          timeMax: timeMaxIso,
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 250,
          pageToken,
        },
        REQ_OPTS,
      );
      events.push(...(res.data.items ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return events;
  }

  /**
   * Incremental sync of the app calendar. Returns reset=true on HTTP 410 (expired
   * sync token) — caller must clear the token and do a full pass.
   */
  async listAppEventsIncremental(
    calendarId: string,
    syncToken: string | null,
  ): Promise<{ events: GEvent[]; nextSyncToken: string | null; reset: boolean }> {
    const events: GEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;
    try {
      do {
        const res = await this.api.events.list(
          {
            calendarId,
            syncToken: syncToken ?? undefined,
            showDeleted: true,
            maxResults: 250,
            pageToken,
          },
          REQ_OPTS,
        );
        events.push(...(res.data.items ?? []));
        pageToken = res.data.nextPageToken ?? undefined;
        if (res.data.nextSyncToken) nextSyncToken = res.data.nextSyncToken;
      } while (pageToken);
      return { events, nextSyncToken, reset: false };
    } catch (err) {
      if (statusOf(err) === 410) return { events: [], nextSyncToken: null, reset: true };
      throw err;
    }
  }

  /**
   * Insert with a client-supplied event id (idempotent: a retry after a crash
   * gets 409 and is treated as success).
   */
  async insertEvent(calendarId: string, event: GEvent): Promise<'created' | 'exists'> {
    try {
      await this.api.events.insert({ calendarId, requestBody: event }, REQ_OPTS);
      return 'created';
    } catch (err) {
      if (statusOf(err) === 409) return 'exists';
      throw err;
    }
  }

  async patchEvent(calendarId: string, eventId: string, patch: GEvent): Promise<void> {
    await this.api.events.patch({ calendarId, eventId, requestBody: patch }, REQ_OPTS);
  }

  /** Delete tolerating already-gone (404/410). */
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await this.api.events.delete({ calendarId, eventId }, REQ_OPTS);
    } catch (err) {
      const s = statusOf(err);
      if (s !== 404 && s !== 410) throw err;
    }
  }
}

/** Google client-supplied event ids must be base32hex (a-v, 0-9); a dashless UUID qualifies. */
export function eventIdForBlock(blockUuid: string): string {
  return blockUuid.replace(/-/g, '').toLowerCase();
}
