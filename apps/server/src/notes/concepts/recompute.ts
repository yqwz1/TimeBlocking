import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { ConceptDTO, ConceptStatusDTO, ConceptType, Settings } from '@timeblock/shared';
import { conceptBlacklist, conceptExtractions, conceptMentions, concepts, notes } from '../../db/schema.js';
import type { DB } from '../../db/client.js';
import { getSettings } from '../../settings.js';
import { aiConfigured } from '../../ai/client.js';
import { readNoteFile } from '../vault.js';
import { hashContent, parseNote } from '../parser.js';
import { extractConcepts } from './extract.js';
import { ModelGateway } from '../../assistant/modelGateway.js';
import { completeGraphJob, failGraphJob, progressGraphJob, queueGraphJob, startGraphJob } from '../graph/jobs.js';

function normKey(type: string, name: string): string {
  return `${type}|${name.trim().toLowerCase()}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countOccurrences(body: string, name: string): number {
  try {
    const m = body.match(new RegExp(escapeRegex(name), 'gi'));
    return m ? Math.min(m.length, 20) : 1;
  } catch {
    return 1;
  }
}

interface ConceptRow {
  id: string;
  name: string;
  type: string;
  aliases: string;
  normKey: string;
}

/** normKey (of canonical name AND every alias) → conceptId, plus the blacklist set. Built once per pass. */
function loadIndex(db: DB): { byNorm: Map<string, string>; blacklist: Set<string>; rows: ConceptRow[] } {
  const rows = db.select().from(concepts).all() as ConceptRow[];
  const byNorm = new Map<string, string>();
  for (const c of rows) {
    byNorm.set(c.normKey, c.id);
    let aliases: string[] = [];
    try {
      aliases = JSON.parse(c.aliases);
    } catch {
      aliases = [];
    }
    for (const a of aliases) byNorm.set(normKey(c.type, a), c.id);
  }
  const blacklist = new Set(db.select().from(conceptBlacklist).all().map((b) => b.normKey));
  return { byNorm, blacklist, rows };
}

/**
 * Incrementally (re)extracts concepts for every note whose body changed since its last extraction.
 * One AI call per stale note; AI-off/offline safe (returns 0). Prunes mentions/extractions for deleted
 * notes and concepts left with no mentions, so the cache self-heals. Returns how many notes were processed.
 */
export async function extractStaleNotes(db: DB, root: string, settings: Settings): Promise<number> {
  if (!settings.aiEnabled || !aiConfigured()) return 0;

  // Self-heal: drop mentions/extractions for notes that no longer exist.
  const liveIds = new Set(db.select({ id: notes.id }).from(notes).all().map((r) => r.id));
  for (const m of db.select({ noteId: conceptMentions.noteId }).from(conceptMentions).all()) {
    if (!liveIds.has(m.noteId)) db.delete(conceptMentions).where(eq(conceptMentions.noteId, m.noteId)).run();
  }
  for (const e of db.select({ noteId: conceptExtractions.noteId }).from(conceptExtractions).all()) {
    if (!liveIds.has(e.noteId)) db.delete(conceptExtractions).where(eq(conceptExtractions.noteId, e.noteId)).run();
  }

  const noteRows = db.select({ id: notes.id }).from(notes).all();
  const extractedHash = new Map(db.select().from(conceptExtractions).all().map((e) => [e.noteId, e.contentHash]));

  let processed = 0;
  for (let noteIndex = 0; noteIndex < noteRows.length; noteIndex++) {
    const { id } = noteRows[noteIndex];
    const file = await readNoteFile(root, id);
    if (!file) continue;
    const parsed = parseNote(id, file.content);
    const bodyHash = hashContent(parsed.body);
    if (extractedHash.get(id) === bodyHash) continue;

    const index = loadIndex(db);
    const existingNames = index.rows.map((c) => c.name);
    let extracted;
    try {
      extracted = await extractConcepts(new ModelGateway(db), settings.aiModel, parsed.title, parsed.body, existingNames);
    } catch {
      continue; // offline / API error (e.g. rate limit) — leave stale; retries next pass
    }

    db.delete(conceptMentions).where(eq(conceptMentions.noteId, id)).run();
    const now = new Date().toISOString();
    for (const c of extracted) {
      const nk = normKey(c.type, c.name);
      if (index.blacklist.has(nk)) continue;
      let conceptId = index.byNorm.get(nk);
      if (!conceptId) {
        conceptId = randomUUID();
        db.insert(concepts).values({ id: conceptId, name: c.name, type: c.type, aliases: '[]', normKey: nk, createdAtUtc: now }).run();
        index.byNorm.set(nk, conceptId);
        index.rows.push({ id: conceptId, name: c.name, type: c.type, aliases: '[]', normKey: nk });
      }
      db.insert(conceptMentions)
        .values({ conceptId, noteId: id, count: countOccurrences(parsed.body, c.name) })
        .onConflictDoUpdate({ target: [conceptMentions.conceptId, conceptMentions.noteId], set: { count: countOccurrences(parsed.body, c.name) } })
        .run();
    }
    db.insert(conceptExtractions).values({ noteId: id, contentHash: bodyHash }).onConflictDoUpdate({ target: conceptExtractions.noteId, set: { contentHash: bodyHash } }).run();
    processed++;
    progressGraphJob(db, 'concepts', noteRows.length ? (noteIndex + 1) / noteRows.length : 1, id);
  }

  // Prune concepts left with no mentions.
  db.run(sql`DELETE FROM concepts WHERE id NOT IN (SELECT DISTINCT concept_id FROM concept_mentions)`);
  return processed;
}

// ── Background runner (single-flight with a trailing re-run) ─────────────────
let running = false;
let pending = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function runExtraction(db: DB, root: string): Promise<void> {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  startGraphJob(db, 'concepts');
  try {
    do {
      pending = false;
      await extractStaleNotes(db, root, getSettings(db));
    } while (pending);
    completeGraphJob(db, 'concepts');
  } catch (error) {
    failGraphJob(db, 'concepts', error);
    // rebuildable cache — swallow
  } finally {
    running = false;
  }
}

/** Debounced, fire-and-forget incremental extraction after note writes. */
export function triggerConceptExtraction(db: DB, root: string): void {
  queueGraphJob(db, 'concepts');
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runExtraction(db, root);
  }, 3000);
}

/** Kicks a full backfill pass immediately (Settings button); returns whether one is now running. */
export function startConceptBackfill(db: DB, root: string): boolean {
  void runExtraction(db, root);
  return running || pending;
}

export function isExtractionRunning(): boolean {
  return running;
}

// ── Read / management operations ────────────────────────────────────────────

export function listConcepts(db: DB): ConceptDTO[] {
  const counts = new Map<string, number>();
  for (const m of db.select({ conceptId: conceptMentions.conceptId }).from(conceptMentions).all()) {
    counts.set(m.conceptId, (counts.get(m.conceptId) ?? 0) + 1);
  }
  return (db.select().from(concepts).all() as ConceptRow[])
    .map((c) => {
      let aliases: string[] = [];
      try {
        aliases = JSON.parse(c.aliases);
      } catch {
        aliases = [];
      }
      return { id: c.id, name: c.name, type: c.type as ConceptType, aliases, mentionCount: counts.get(c.id) ?? 0 };
    })
    .sort((a, b) => b.mentionCount - a.mentionCount || a.name.localeCompare(b.name));
}

export function getConceptStatus(db: DB): ConceptStatusDTO {
  const totalNotes = db.select({ id: notes.id }).from(notes).all().length;
  const extractedNotes = db.select({ noteId: conceptExtractions.noteId }).from(conceptExtractions).all().length;
  const conceptCount = db.select({ id: concepts.id }).from(concepts).all().length;
  return { totalNotes, extractedNotes, conceptCount, aiEnabled: getSettings(db).aiEnabled && aiConfigured(), running };
}

/** Renames a concept, keeping its old name as an alias. Rejects a name that collides with another concept. */
export function renameConcept(db: DB, id: string, newName: string): { ok: boolean; error?: string } {
  const row = db.select().from(concepts).where(eq(concepts.id, id)).get();
  if (!row) return { ok: false, error: 'not found' };
  const nk = normKey(row.type, newName);
  const collide = db.select({ id: concepts.id }).from(concepts).where(eq(concepts.normKey, nk)).get();
  if (collide && collide.id !== id) return { ok: false, error: 'a concept with that name already exists — merge instead' };
  let aliases: string[] = [];
  try {
    aliases = JSON.parse(row.aliases);
  } catch {
    aliases = [];
  }
  if (row.name.toLowerCase() !== newName.trim().toLowerCase() && !aliases.some((a) => a.toLowerCase() === row.name.toLowerCase())) aliases.push(row.name);
  db.update(concepts).set({ name: newName.trim(), normKey: nk, aliases: JSON.stringify(aliases) }).where(eq(concepts.id, id)).run();
  return { ok: true };
}

/** Merges `sourceId` into `targetId`: moves mentions, folds names into aliases, deletes the source. */
export function mergeConcepts(db: DB, sourceId: string, targetId: string): { ok: boolean; error?: string } {
  if (sourceId === targetId) return { ok: false, error: 'cannot merge a concept into itself' };
  const source = db.select().from(concepts).where(eq(concepts.id, sourceId)).get();
  const target = db.select().from(concepts).where(eq(concepts.id, targetId)).get();
  if (!source || !target) return { ok: false, error: 'not found' };

  db.transaction((tx) => {
    for (const m of tx.select().from(conceptMentions).where(eq(conceptMentions.conceptId, sourceId)).all()) {
      tx.insert(conceptMentions)
        .values({ conceptId: targetId, noteId: m.noteId, count: m.count })
        .onConflictDoUpdate({ target: [conceptMentions.conceptId, conceptMentions.noteId], set: { count: sql`${conceptMentions.count} + ${m.count}` } })
        .run();
    }
    tx.delete(conceptMentions).where(eq(conceptMentions.conceptId, sourceId)).run();

    let aliases: string[] = [];
    let srcAliases: string[] = [];
    try {
      aliases = JSON.parse(target.aliases);
    } catch {
      aliases = [];
    }
    try {
      srcAliases = JSON.parse(source.aliases);
    } catch {
      srcAliases = [];
    }
    const merged = Array.from(new Set([...aliases, source.name, ...srcAliases].filter((a) => a.toLowerCase() !== target.name.toLowerCase())));
    tx.update(concepts).set({ aliases: JSON.stringify(merged) }).where(eq(concepts.id, targetId)).run();
    tx.delete(concepts).where(eq(concepts.id, sourceId)).run();
  });
  return { ok: true };
}

/** Blacklists a concept (never recreated on extraction) and deletes it + its mentions. */
export function blacklistConcept(db: DB, id: string): { ok: boolean; error?: string } {
  const row = db.select().from(concepts).where(eq(concepts.id, id)).get();
  if (!row) return { ok: false, error: 'not found' };
  db.transaction((tx) => {
    tx.insert(conceptBlacklist).values({ normKey: row.normKey }).onConflictDoNothing().run();
    tx.delete(conceptMentions).where(eq(conceptMentions.conceptId, id)).run();
    tx.delete(concepts).where(eq(concepts.id, id)).run();
  });
  return { ok: true };
}
