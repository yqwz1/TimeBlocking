import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DriveBackupDTO, DriveBackupStatusDTO, DriveConnectionDTO, DriveFileDTO } from '@timeblock/shared';
import type { DB } from '../db/client.js';
import { getSettings } from '../settings.js';
import { createNoteFile, getVaultRoot, normalizeNotePath, readNoteFile, VaultConflictError } from '../notes/vault.js';
import { indexNote } from '../notes/indexer.js';
import { oauthTokens } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getAuthUrl, getAuthedClient, isGoogleAuthed, tokenEncryptionConfigured } from '../integrations/google/auth.js';
import { Gdrive, GOOGLE_DOC_MIME } from '../integrations/google/drive.js';
import type { DriveBackupService } from '../integrations/google/driveBackups.js';

function dto(file: { id: string; name: string; mimeType: string; modifiedTime: string | null; size?: number | null; webViewLink: string | null }): DriveFileDTO {
  return { id: file.id, name: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime, webViewLink: file.webViewLink };
}

function backupDto(file: { id: string; name: string; createdTime?: string | null; modifiedTime: string | null; size?: number | null; webViewLink: string | null }): DriveBackupDTO {
  return { id: file.id, name: file.name, createdAt: file.createdTime ?? file.modifiedTime, size: file.size ?? null, webViewLink: file.webViewLink };
}

function docToMarkdown(title: string, text: string, fileId: string): string {
  return `---\ngdrive_file_id: ${fileId}\ngdrive_imported_at: ${new Date().toISOString()}\n---\n\n# ${title.replace(/\r?\n/g, ' ').trim()}\n\n${text.trim()}\n`;
}

function diffPreview(current: string, incoming: string): { changed: boolean; current: string; incoming: string } {
  return { changed: current !== incoming, current, incoming };
}

export function registerDriveRoutes(app: FastifyInstance, db: DB, backups: DriveBackupService) {
  app.get('/drive/status', async (): Promise<DriveConnectionDTO> => {
    const auth = getAuthedClient(db);
    let accountEmail: string | null = null;
    if (auth) {
      try { accountEmail = await new Gdrive(auth).accountEmail(); } catch { /* a stale token is still shown as connected; its next operation can reconnect */ }
    }
    const scopes = db.select().from(oauthTokens).where(eq(oauthTokens.provider, 'google')).get()?.scopes ?? '';
    return { connected: isGoogleAuthed(db), accountEmail, encryptionConfigured: tokenEncryptionConfigured(), readOnlyGranted: scopes.includes('drive.readonly') };
  });

  app.get<{ Querystring: { broader?: string } }>('/drive/connect', async (req, reply) => {
    if (!tokenEncryptionConfigured()) return reply.code(400).send({ error: 'Set TB_TOKEN_ENCRYPTION_KEY (at least 32 characters) before connecting Google Drive.' });
    return reply.redirect(getAuthUrl(req.query.broader === '1'));
  });

  app.get('/drive/backups/status', async (): Promise<DriveBackupStatusDTO> => backups.status());
  app.get('/drive/backups', async (): Promise<DriveBackupDTO[]> => (await backups.list()).map(backupDto));
  app.post('/drive/backups', async (req, reply) => {
    try { return reply.code(201).send(backupDto(await backups.backupNow())); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.post<{ Params: { id: string } }>('/drive/backups/:id/restore', async (req, reply) => {
    try { return { ok: true, inspectionPath: await backups.restoreForInspection(req.params.id) }; }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) }); }
  });

  app.get<{ Querystring: { q?: string } }>('/drive/search', async (req, reply): Promise<DriveFileDTO[] | unknown> => {
    const settings = getSettings(db);
    if (!settings.driveReadOnlyEnabled) return reply.code(403).send({ error: 'Enable Drive search and import in Settings, then grant the read-only permission.' });
    const auth = getAuthedClient(db);
    if (!auth) return reply.code(401).send({ error: 'Connect Google Drive first' });
    return (await new Gdrive(auth).search(req.query.q?.trim() || '')).map(dto);
  });

  app.post<{ Body: { fileId: string; path?: string } }>('/drive/import', async (req, reply) => {
    const parsed = z.object({ fileId: z.string().min(1), path: z.string().min(1).optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const settings = getSettings(db);
    if (!settings.driveReadOnlyEnabled) return reply.code(403).send({ error: 'Enable Drive search and import in Settings first.' });
    const auth = getAuthedClient(db);
    if (!auth) return reply.code(401).send({ error: 'Connect Google Drive first' });
    const drive = new Gdrive(auth);
    const file = await drive.getFile(parsed.data.fileId);
    if (file.mimeType !== GOOGLE_DOC_MIME) return reply.code(400).send({ error: 'Only Google Docs can be imported as notes.' });
    const content = docToMarkdown(file.name, await drive.exportGoogleDocText(file.id), file.id);
    const suggested = normalizeNotePath(parsed.data.path ?? `Imports/${file.name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Google Doc'}`);
    try {
      await createNoteFile(getVaultRoot(db), suggested, content);
    } catch (error) {
      if (error instanceof VaultConflictError) return reply.code(409).send({ error: `${suggested} already exists; choose a different path.` });
      throw error;
    }
    await indexNote(db, getVaultRoot(db), suggested);
    return reply.code(201).send({ id: suggested });
  });

  app.post<{ Body: { noteId: string; approve?: boolean } }>('/drive/repull', async (req, reply) => {
    const parsed = z.object({ noteId: z.string().min(1), approve: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const root = getVaultRoot(db);
    const note = await readNoteFile(root, parsed.data.noteId);
    if (!note) return reply.code(404).send({ error: 'note not found' });
    const match = /^gdrive_file_id:\s*(.+)$/m.exec(note.content);
    if (!match) return reply.code(400).send({ error: 'This is not an imported Google Doc.' });
    const auth = getAuthedClient(db);
    if (!auth) return reply.code(401).send({ error: 'Connect Google Drive first' });
    const drive = new Gdrive(auth);
    const file = await drive.getFile(match[1].trim());
    const incoming = docToMarkdown(file.name, await drive.exportGoogleDocText(file.id), file.id);
    const preview = diffPreview(note.content, incoming);
    if (!parsed.data.approve || !preview.changed) return preview;
    const { writeNoteFile } = await import('../notes/vault.js');
    await writeNoteFile(root, parsed.data.noteId, incoming, getSettings(db).notesSnapshotRetention);
    await indexNote(db, root, parsed.data.noteId);
    return { ...preview, applied: true };
  });
}
