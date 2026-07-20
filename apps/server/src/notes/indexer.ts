import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { conceptExtractions, conceptMentions, noteChunks, noteLinks, notes } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { listMarkdownFiles, readNoteFile } from './vault.js';
import { hashContent, parseNote, snippetAround } from './parser.js';

/** A note's filename stem (its wikilink identity in Obsidian) — e.g. "Folder/Beta.md" -> "Beta". */
function stemOf(id: string): string {
  return path.basename(id).replace(/\.md$/i, '');
}

function ftsUpsert(db: DB, id: string, title: string, body: string) {
  db.run(sql`DELETE FROM notes_fts WHERE id = ${id}`);
  db.run(sql`INSERT INTO notes_fts (id, title, body) VALUES (${id}, ${title}, ${body})`);
}

function ftsDelete(db: DB, id: string) {
  db.run(sql`DELETE FROM notes_fts WHERE id = ${id}`);
}

/**
 * Resolves a `[[wikilink]]` target to an existing note id — by filename stem first (Obsidian's
 * own identity for a link target), falling back to the display title for links written against
 * a heading-derived or frontmatter title that doesn't match the filename.
 */
export function resolveTitleToId(db: DB, target: string): string | null {
  const byStem = db
    .select({ id: notes.id })
    .from(notes)
    .where(sql`lower(${notes.id}) = lower(${target} || '.md') OR lower(${notes.id}) LIKE lower('%/' || ${target} || '.md')`)
    .get();
  if (byStem) return byStem.id;
  const byTitle = db.select({ id: notes.id }).from(notes).where(sql`lower(${notes.title}) = lower(${target})`).get();
  return byTitle?.id ?? null;
}

/** Reads one file off disk and syncs it into the SQLite cache (notes, note_links, notes_fts). Removes the row if the file is gone. */
export async function indexNote(db: DB, root: string, relPath: string): Promise<void> {
  const file = await readNoteFile(root, relPath);
  if (!file) {
    removeNoteFromIndex(db, relPath);
    return;
  }
  const hash = hashContent(file.content);
  const existing = db.select().from(notes).where(eq(notes.id, relPath)).get();
  if (existing && existing.contentHash === hash) return;

  const parsed = parseNote(relPath, file.content);
  const values = {
    id: relPath,
    title: parsed.title,
    tags: JSON.stringify(parsed.tags),
    frontmatter: JSON.stringify(parsed.frontmatter),
    contentHash: hash,
    createdAtUtc: existing?.createdAtUtc ?? file.createdAtUtc,
    updatedAtUtc: file.updatedAtUtc,
  };
  db.insert(notes).values(values).onConflictDoUpdate({ target: notes.id, set: values }).run();

  db.delete(noteLinks).where(eq(noteLinks.sourceId, relPath)).run();
  for (const targetTitle of parsed.wikilinks) {
    const targetId = resolveTitleToId(db, targetTitle);
    const snippet = snippetAround(parsed.body, targetTitle);
    db.insert(noteLinks).values({ sourceId: relPath, targetTitle, targetId, snippet }).run();
  }

  ftsUpsert(db, relPath, parsed.title, parsed.body);

  // A note that was just created/renamed may resolve wikilinks other notes already pointed at
  // by filename stem or by title — re-check dangling links against both.
  const stem = stemOf(relPath);
  db.run(
    sql`UPDATE note_links SET target_id = ${relPath} WHERE target_id IS NULL AND (lower(target_title) = lower(${stem}) OR lower(target_title) = lower(${parsed.title}))`,
  );
}

export function removeNoteFromIndex(db: DB, id: string): void {
  db.delete(notes).where(eq(notes.id, id)).run();
  db.delete(noteLinks).where(eq(noteLinks.sourceId, id)).run();
  db.run(sql`UPDATE note_links SET target_id = NULL WHERE target_id = ${id}`);
  db.delete(noteChunks).where(eq(noteChunks.noteId, id)).run();
  db.delete(conceptMentions).where(eq(conceptMentions.noteId, id)).run();
  db.delete(conceptExtractions).where(eq(conceptExtractions.noteId, id)).run();
  ftsDelete(db, id);
}

/** Wipes and rebuilds the entire cache from the files on disk. The files are always the source of truth. */
export async function reindexAll(db: DB, root: string): Promise<number> {
  db.run(sql`DELETE FROM notes_fts`);
  db.delete(noteLinks).run();
  db.delete(notes).run();
  const files = await listMarkdownFiles(root);
  for (const relPath of files) await indexNote(db, root, relPath);
  return files.length;
}

export interface BacklinkRow {
  id: string;
  title: string;
  snippet: string;
}

export function getBacklinks(db: DB, id: string): BacklinkRow[] {
  return db
    .select({ id: noteLinks.sourceId, title: notes.title, snippet: noteLinks.snippet })
    .from(noteLinks)
    .innerJoin(notes, eq(notes.id, noteLinks.sourceId))
    .where(eq(noteLinks.targetId, id))
    .all();
}

export function getOutgoingLinks(db: DB, id: string): { title: string; id: string | null }[] {
  return db.select({ title: noteLinks.targetTitle, id: noteLinks.targetId }).from(noteLinks).where(eq(noteLinks.sourceId, id)).all();
}

// Sentinel control characters marking a match inside a snippet — replaced with <mark> client-side
// only after HTML-escaping the rest of the (untrusted, user-authored) snippet text.
const SNIPPET_MARK_START = '\uE000';
const SNIPPET_MARK_END = '\uE001';

/** Notes whose body mentions this note's title as plain text without an explicit `[[wikilink]]` to it. */
export function getUnlinkedMentions(db: DB, id: string, title: string): BacklinkRow[] {
  if (!title.trim()) return [];
  // Column-filtered so a note is never flagged just because *another* note's own title
  // happens to contain this word (e.g. "Untitled 2" mentioning "Untitled").
  const phrase = `body:"${title.replace(/"/g, '""')}"`;
  const rows = db.all<{ id: string; title: string; snip: string }>(
    sql`SELECT id, title, snippet(notes_fts, 2, ${SNIPPET_MARK_START}, ${SNIPPET_MARK_END}, '…', 10) as snip FROM notes_fts WHERE notes_fts MATCH ${phrase} AND id != ${id} ORDER BY bm25(notes_fts) LIMIT 25`,
  );
  const linkedSourceIds = new Set(
    db.select({ sourceId: noteLinks.sourceId }).from(noteLinks).where(eq(noteLinks.targetId, id)).all().map((r) => r.sourceId),
  );
  return rows.filter((r) => !linkedSourceIds.has(r.id)).map((r) => ({ id: r.id, title: r.title, snippet: r.snip }));
}

function toFtsMatchQuery(q: string): string {
  const words = q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w.replace(/"/g, '""')}"*`);
  return words.join(' ');
}

export interface NoteSearchRow {
  id: string;
  title: string;
  snip: string;
}

export function searchNotes(db: DB, query: string, limit = 30): NoteSearchRow[] {
  const q = toFtsMatchQuery(query);
  if (!q) return [];
  return db.all<NoteSearchRow>(
    sql`SELECT id, title, snippet(notes_fts, 2, ${SNIPPET_MARK_START}, ${SNIPPET_MARK_END}, '…', 12) as snip FROM notes_fts WHERE notes_fts MATCH ${q} ORDER BY bm25(notes_fts) LIMIT ${limit}`,
  );
}
