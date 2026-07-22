import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from '@timeblock/shared';
import { eq } from 'drizzle-orm';
import { settings } from './db/schema.js';
import type { DB } from './db/client.js';

const RETIRED_GEMINI_MODELS = new Set(['gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-2.0-flash-lite', 'gemini-2.0-flash-lite-001']);

export function normalizeAiModel(model: string): string {
  return RETIRED_GEMINI_MODELS.has(model) ? 'gemini-3.5-flash-lite' : model;
}

function upsertRow(db: DB, key: string, value: string) {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export function getSettings(db: DB): Settings {
  const rows = db.select().from(settings).all();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const raw = map.get(key);
    if (raw !== undefined) {
      try {
        merged[key] = JSON.parse(raw);
      } catch {
        // ignore corrupt value, keep default
      }
    }
  }
  if (typeof merged.aiModel === 'string') merged.aiModel = normalizeAiModel(merged.aiModel);
  const parsed = SettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
}

export function updateSettings(db: DB, patch: Partial<Settings>): Settings {
  const merged = { ...getSettings(db), ...patch };
  // Keep the chunk bounds coherent regardless of which field was edited.
  if (merged.minChunkMin > merged.maxChunkMin) merged.minChunkMin = merged.maxChunkMin;
  const next = SettingsSchema.parse(merged);
  for (const key of Object.keys(patch)) {
    const k = key as keyof Settings;
    upsertRow(db, k, JSON.stringify(next[k]));
  }
  return next;
}

/** Secrets live beside settings under a prefix. */
export function getSecret(db: DB, name: string): string | null {
  const row = db.select().from(settings).where(eq(settings.key, `secret:${name}`)).get();
  return row ? (JSON.parse(row.value) as string) : null;
}

export function setSecret(db: DB, name: string, value: string) {
  upsertRow(db, `secret:${name}`, JSON.stringify(value));
}

/** On first boot, default the timezone to the machine's timezone. */
export function ensureTimezoneDefault(db: DB) {
  const row = db.select().from(settings).where(eq(settings.key, 'timezone')).get();
  if (!row) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    updateSettings(db, { timezone: tz });
  }
}
