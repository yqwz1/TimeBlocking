import { createHash } from 'node:crypto';
import type { ActivityCapabilities } from '@timeblock/shared';

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 512 * 1024;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sourceKey(hostname: string | undefined): string {
  // Hostnames can identify a person or device. The app only needs a stable local key.
  const fingerprint = createHash('sha256').update(hostname?.trim().toLowerCase() || 'activitywatch-local').digest('hex').slice(0, 24);
  return `activitywatch:${fingerprint}`;
}

async function readJson(response: Response): Promise<unknown> {
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
      if (size > MAX_RESPONSE_BYTES) {
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

  private url(path: '/api/0/info' | '/api/0/buckets'): string {
    return `http://127.0.0.1:${this.port}${path}`;
  }

  private async get(path: '/api/0/info' | '/api/0/buckets'): Promise<unknown> {
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
      return await readJson(response);
    } catch (error) {
      if (error instanceof ActivityWatchAdapterError) throw error;
      throw new ActivityWatchAdapterError('unavailable', 'ActivityWatch is unavailable on localhost.');
    } finally {
      clearTimeout(timeout);
    }
  }

  async probe(): Promise<ActivityWatchProbe> {
    const [infoRaw, bucketsRaw] = await Promise.all([this.get('/api/0/info'), this.get('/api/0/buckets')]);
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
}
