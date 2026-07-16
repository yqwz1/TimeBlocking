import { lt } from 'drizzle-orm';
import { syncLog } from './db/schema.js';
import type { DB } from './db/client.js';
import { nowUtcIso } from './config.js';

export function logSync(db: DB, source: string, kind: 'info' | 'conflict' | 'error', detail: unknown) {
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
  db.insert(syncLog).values({ tsUtc: nowUtcIso(), source, kind, detail: text }).run();
  if (kind === 'error') console.error(`[${source}]`, text);
}

/** Keep the log bounded. */
export function trimLog(db: DB, keep = 2000) {
  const rows = db.select({ id: syncLog.id }).from(syncLog).all();
  if (rows.length > keep) {
    const cutoff = rows.map((r) => r.id).sort((a, b) => b - a)[keep - 1];
    db.delete(syncLog).where(lt(syncLog.id, cutoff)).run();
  }
}
