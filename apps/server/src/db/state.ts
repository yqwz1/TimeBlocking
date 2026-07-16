import { eq } from 'drizzle-orm';
import { syncState } from './schema.js';
import type { DB } from './client.js';
import { nowUtcIso } from '../config.js';

export function getState(db: DB, key: string): string | null {
  const row = db.select().from(syncState).where(eq(syncState.key, key)).get();
  return row?.value ?? null;
}

export function setState(db: DB, key: string, value: string) {
  db.insert(syncState)
    .values({ key, value, updatedAtUtc: nowUtcIso() })
    .onConflictDoUpdate({ target: syncState.key, set: { value, updatedAtUtc: nowUtcIso() } })
    .run();
}

export function clearState(db: DB, key: string) {
  db.delete(syncState).where(eq(syncState.key, key)).run();
}
