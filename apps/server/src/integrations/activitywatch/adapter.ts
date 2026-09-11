import { createHash } from 'node:crypto';
import type { ActivityCapabilities } from '@timeblock/shared';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PROBE_RESPONSE_BYTES = 512 * 1024;
const MAX_QUERY_RESPONSE_BYTES = 2 * 1024 * 1024;

export class ActivityWatchAdapterError extends Error {
  constructor(public readonly code: 'unavailable' | 'invalid_response' | 'response_too_large', message: string) {
    super(message);
  }
}

export interface ActivityWatchProbe {
  version: string;
  sourceKey: string;
  capabilities: ActivityCapabilities;
}

/** Internal-only representation. It is deliberately converted to a safe projection before persistence. */
export interface ActivityWatchCanonicalEvent {
  timestamp: string;
  duration: number;
  data: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sourceKey(hostname: string | undefined): string {
  // Hostnames can identify a person or device. The app only needs a stable local key.
  const fingerprint = createHash('sha256').update(hostname?.trim().toLowerCase() || 'activitywatch-local').digest('hex').slice(0, 24);
  return `activitywatch:${fingerprint}`;
}

async function readJson(response: Response, maxBytes: number = MAX_PROBE_RESPONSE_BYTES): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new ActivityWatchAdapterError('invalid_response', 'ActivityWatch returned a non-JSON response.');
  }
  if (!response.body) throw new ActivityWatchAdapterError('invalid_response', 'ActivityWatch returned an empty response.');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ActivityWatchAdapterError('response_too_large', 'ActivityWatch response exceeded the safety limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ActivityWatchAdapterError('invalid_response', 'ActivityWatch returned invalid JSON.');
  }
}

/**
 * Read-only, loopback-only boundary around ActivityWatch's intentionally
 * unauthenticated API. Keep all ActivityWatch protocol knowledge here.
 */
export class ActivityWatchAdapter {
  constructor(
    private readonly port: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('ActivityWatch port must be a valid TCP port.');
  }

  private url(path: '/api/0/info' | '/api/0/buckets/' | '/api/0/query/'): string {
    return `http://127.0.0.1:${this.port}${path}`;
  }

  private async get(path: '/api/0/info' | '/api/0/buckets/'): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(this.url(path), {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new ActivityWatchAdapterError('unavailable', `ActivityWatch returned HTTP ${response.status}.`);
      return await readJson(response, MAX_PROBE_RESPONSE_BYTES);
    } catch (error) {
      if (error instanceof ActivityWatchAdapterError) throw error;
      throw new ActivityWatchAdapterError('unavailable', 'ActivityWatch is unavailable on localhost.');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async postQuery(body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(this.url('/api/0/query/'), {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new ActivityWatchAdapterError('unavailable', `ActivityWatch canonical query returned HTTP ${response.status}.`);
      return await readJson(response, MAX_QUERY_RESPONSE_BYTES);
    } catch (error) {
      if (error instanceof ActivityWatchAdapterError) throw error;
      throw new ActivityWatchAdapterError('unavailable', 'ActivityWatch canonical query is unavailable on localhost.');
    } finally { clearTimeout(timeout); }
  }

  async probe(): Promise<ActivityWatchProbe> {
    const [infoRaw, bucketsRaw] = await Promise.all([this.get('/api/0/info'), this.get('/api/0/buckets/')]);
    if (!isRecord(infoRaw) || typeof infoRaw.version !== 'string' || !isRecord(bucketsRaw)) {
      throw new ActivityWatchAdapterError('invalid_response', 'ActivityWatch returned an unsupported API schema.');
    }
    const bucketIds = Object.keys(bucketsRaw).map((id) => id.toLowerCase());
    const has = (...terms: string[]) => bucketIds.some((id) => terms.some((term) => id.includes(term)));
    return {
      version: infoRaw.version.slice(0, 80),
      sourceKey: sourceKey(typeof infoRaw.hostname === 'string' ? infoRaw.hostname : undefined),
      capabilities: {
        window: has('watcher-window'),
        afk: has('watcher-afk'),
        browser: has('watcher-web', 'watcher-browser'),
        editor: has('watcher-editor'),
        input: has('watcher-input'),
      },
    };
  }

  /**
   * Mirrors ActivityWatch's documented canonical pipeline. `flood` resolves
   * heartbeat/zero-duration events, AFK is intersected before categorization,
   * and categories come from the user's local hierarchy. No writes are made.
   */
  async canonicalEvents(fromUtc: string, toUtc: string): Promise<ActivityWatchCanonicalEvent[]> {
    // ActivityWatch v0.13 expects individual query statements, not one
    // newline-delimited program. Keep classification local: its optional
    // __CATEGORIES__ variable is not available on a standard local server.
    const query = [
      'events = flood(query_bucket(find_bucket("aw-watcher-window_")));',
      'not_afk = flood(query_bucket(find_bucket("aw-watcher-afk_")));',
      'not_afk = filter_keyvals(not_afk, "status", ["not-afk"]);',
      'events = filter_period_intersect(events, not_afk);',
      'RETURN = events;',
    ];
    const raw = await this.postQuery({ timeperiods: [`${fromUtc}/${toUtc}`], query });
    const events = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : Array.isArray(raw) ? raw : null;
    if (!events || !events.every((event) => isRecord(event) && typeof event.timestamp === 'string' && typeof event.duration === 'number' && isRecord(event.data))) {
      throw new ActivityWatchAdapterError('invalid_response', 'ActivityWatch returned an unsupported canonical query result.');
    }
    return events.map((event) => ({ timestamp: event.timestamp as string, duration: Math.max(0, event.duration as number), data: event.data as Record<string, unknown> }));
  }
}
