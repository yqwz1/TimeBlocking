import { createHash } from 'node:crypto';

/** Stable content fingerprint used for echo suppression on two-way sync. */
export function contentHash(fields: Record<string, unknown>): string {
  const keys = Object.keys(fields).sort();
  const canonical = JSON.stringify(keys.map((k) => [k, fields[k] ?? null]));
  return createHash('sha1').update(canonical).digest('hex');
}

/** Fingerprint of a block's placement as pushed to Google (times only — renames are user-owned). */
export function blockHash(startUtc: string, endUtc: string): string {
  return contentHash({ start: startUtc, end: endUtc });
}
