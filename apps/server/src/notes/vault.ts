import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { getSettings } from '../settings.js';
import type { DB } from '../db/client.js';

export const DEFAULT_VAULT_DIR = path.join(DATA_DIR, 'vault');
const TRASH_DIRNAME = '.trash';
const SNAPSHOTS_DIRNAME = '.snapshots';

export class VaultPathError extends Error {}
export class VaultConflictError extends Error {}

/** Resolves the configured vault root (or the default), creating it on first use. */
export function getVaultRoot(db: DB): string {
  const settings = getSettings(db);
  const root = settings.notesVaultPath && settings.notesVaultPath.trim() ? settings.notesVaultPath : DEFAULT_VAULT_DIR;
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Normalizes a user-supplied vault-relative path: forward slashes, no leading slash, `.md` appended if missing. */
export function normalizeNotePath(relPath: string): string {
  let p = relPath.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p.toLowerCase().endsWith('.md')) p += '.md';
  return p;
}

/** Resolves a vault-relative path to an absolute path, rejecting any attempt to escape the vault root. */
export function safeResolve(root: string, relPath: string): string {
  const resolved = path.resolve(root, relPath);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new VaultPathError(`path escapes vault root: ${relPath}`);
  }
  return resolved;
}

function isHiddenTopLevel(name: string): boolean {
  return name === TRASH_DIRNAME || name === SNAPSHOTS_DIRNAME || name.startsWith('.');
}

/** Recursively lists every `.md` file in the vault as forward-slash relative paths, skipping `.trash`/`.snapshots`/dotfiles. */
export async function listMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, rel: string) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (rel === '' && isHiddenTopLevel(entry.name)) continue;
      if (rel !== '' && entry.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        out.push(childRel);
      }
    }
  }
  await walk(root, '');
  return out;
}

export interface NoteFileStat {
  content: string;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export async function readNoteFile(root: string, relPath: string): Promise<NoteFileStat | null> {
  const abs = safeResolve(root, relPath);
  try {
    const [content, stat] = await Promise.all([fsp.readFile(abs, 'utf8'), fsp.stat(abs)]);
    return { content, createdAtUtc: stat.birthtime.toISOString(), updatedAtUtc: stat.mtime.toISOString() };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Writes a file atomically (temp file + rename) so a crash mid-write never corrupts the note. */
async function atomicWrite(abs: string, content: string) {
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${randomUUID()}`;
  await fsp.writeFile(tmp, content, 'utf8');
  await fsp.rename(tmp, abs);
}

async function snapshotBefore(root: string, relPath: string, retention: number) {
  if (retention <= 0) return;
  const abs = safeResolve(root, relPath);
  if (!fs.existsSync(abs)) return;
  const snapDir = path.join(root, SNAPSHOTS_DIRNAME, relPath);
  await fsp.mkdir(snapDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  await fsp.copyFile(abs, path.join(snapDir, `${ts}.md`));
  const files = (await fsp.readdir(snapDir)).sort();
  const excess = files.length - retention;
  for (let i = 0; i < excess; i++) await fsp.unlink(path.join(snapDir, files[i]));
}

export async function createNoteFile(root: string, relPath: string, content: string): Promise<void> {
  const abs = safeResolve(root, relPath);
  if (fs.existsSync(abs)) throw new VaultConflictError(`a note already exists at ${relPath}`);
  await atomicWrite(abs, content);
}

export async function writeNoteFile(root: string, relPath: string, content: string, snapshotRetention: number): Promise<void> {
  await snapshotBefore(root, relPath, snapshotRetention);
  await atomicWrite(safeResolve(root, relPath), content);
}

export async function moveNoteFile(root: string, fromRel: string, toRel: string): Promise<void> {
  const fromAbs = safeResolve(root, fromRel);
  const toAbs = safeResolve(root, toRel);
  if (fs.existsSync(toAbs)) throw new VaultConflictError(`a note already exists at ${toRel}`);
  await fsp.mkdir(path.dirname(toAbs), { recursive: true });
  await fsp.rename(fromAbs, toAbs);
}

/** Soft-deletes a note into `.trash/<timestamp>/<relPath>`, preserving its folder structure for restore. Returns the trash folder id. */
export async function trashNoteFile(root: string, relPath: string): Promise<string> {
  const fromAbs = safeResolve(root, relPath);
  const ts = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;
  const destAbs = path.join(root, TRASH_DIRNAME, ts, relPath);
  await fsp.mkdir(path.dirname(destAbs), { recursive: true });
  await fsp.rename(fromAbs, destAbs);
  return ts;
}

export interface TrashEntry {
  trashId: string;
  originalPath: string;
  deletedAt: string;
}

async function findFilesRecursive(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await findFilesRecursive(path.join(dir, entry.name), childRel)));
    else out.push(childRel);
  }
  return out;
}

export async function listTrash(root: string): Promise<TrashEntry[]> {
  const trashDir = path.join(root, TRASH_DIRNAME);
  if (!fs.existsSync(trashDir)) return [];
  const folders = await fsp.readdir(trashDir, { withFileTypes: true });
  const out: TrashEntry[] = [];
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const folderAbs = path.join(trashDir, folder.name);
    const [files, stat] = await Promise.all([findFilesRecursive(folderAbs), fsp.stat(folderAbs)]);
    for (const f of files) out.push({ trashId: folder.name, originalPath: f, deletedAt: stat.mtime.toISOString() });
  }
  return out;
}

/** Restores a trashed note back to its original path, appending " (restored)" if something now occupies that path. */
export async function restoreFromTrash(root: string, trashId: string): Promise<string> {
  const trashDir = path.join(root, TRASH_DIRNAME, trashId);
  if (!fs.existsSync(trashDir)) throw new VaultPathError('trash entry not found');
  const files = await findFilesRecursive(trashDir);
  if (files.length === 0) throw new VaultPathError('trash entry is empty');
  const relPath = files[0];
  const fromAbs = path.join(trashDir, relPath);
  let toRel = relPath;
  let toAbs = safeResolve(root, toRel);
  if (fs.existsSync(toAbs)) {
    const ext = path.extname(relPath);
    const base = relPath.slice(0, -ext.length);
    toRel = `${base} (restored)${ext}`;
    toAbs = safeResolve(root, toRel);
  }
  await fsp.mkdir(path.dirname(toAbs), { recursive: true });
  await fsp.rename(fromAbs, toAbs);
  await fsp.rm(trashDir, { recursive: true, force: true });
  return toRel;
}

export async function purgeTrashEntry(root: string, trashId: string): Promise<void> {
  const trashDir = path.join(root, TRASH_DIRNAME, trashId);
  await fsp.rm(trashDir, { recursive: true, force: true });
}

/** Permanently removes trash folders older than `retentionDays`. Called lazily whenever trash is listed. */
export async function purgeExpiredTrash(root: string, retentionDays: number): Promise<void> {
  const trashDir = path.join(root, TRASH_DIRNAME);
  if (!fs.existsSync(trashDir)) return;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const folders = await fsp.readdir(trashDir, { withFileTypes: true });
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const folderAbs = path.join(trashDir, folder.name);
    const stat = await fsp.stat(folderAbs);
    if (stat.mtime.getTime() < cutoff) await fsp.rm(folderAbs, { recursive: true, force: true });
  }
}
