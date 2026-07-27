import archiver from 'archiver';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { PassThrough } from 'node:stream';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { DB } from '../../db/client.js';
import { getState, setState } from '../../db/state.js';
import { getSettings } from '../../settings.js';
import { getVaultRoot } from '../../notes/vault.js';
import { getAuthedClient } from './auth.js';
import { DRIVE_BACKUP_FOLDER, Gdrive, type DriveFile } from './drive.js';

const LAST_BACKUP_AT = 'drive_backup_last_at';
const LAST_BACKUP_ERROR = 'drive_backup_last_error';
const ENCRYPTED_MAGIC = Buffer.from('TBENC1');
const ENCRYPTED_VERSION = 1;

function archiveVault(root: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
    archive.on('error', reject);
    archive.directory(root, false, (entry) => (/^(\.trash|\.snapshots)(\/|$)/.test(entry.name) ? false : entry));
    archive.pipe(output);
    void archive.finalize();
  });
}

function deriveBackupKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32);
}

export function encryptBackupArchive(bytes: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveBackupKey(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ENCRYPTED_MAGIC, Buffer.from([ENCRYPTED_VERSION]), salt, iv, tag, ciphertext]);
}

export function isEncryptedBackupArchive(bytes: Buffer): boolean {
  return bytes.subarray(0, ENCRYPTED_MAGIC.length).equals(ENCRYPTED_MAGIC);
}

export function decryptBackupArchive(bytes: Buffer, passphrase: string): Buffer {
  if (!isEncryptedBackupArchive(bytes)) return bytes;
  const version = bytes[ENCRYPTED_MAGIC.length];
  if (version !== ENCRYPTED_VERSION) throw new Error(`Unsupported backup encryption version: ${version}`);
  const saltStart = ENCRYPTED_MAGIC.length + 1;
  const salt = bytes.subarray(saltStart, saltStart + 16);
  const iv = bytes.subarray(saltStart + 16, saltStart + 28);
  const tag = bytes.subarray(saltStart + 28, saltStart + 44);
  const ciphertext = bytes.subarray(saltStart + 44);
  const key = deriveBackupKey(passphrase, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export interface DriveBackupStatus {
  lastBackupAt: string | null;
  lastBackupError: string | null;
  running: boolean;
}

/** A single-flight, retry-safe Drive backup queue. No Drive content is deleted except our marked snapshots. */
export class DriveBackupService {
  private running = false;
  constructor(private readonly db: DB) {}

  status(): DriveBackupStatus {
    return { lastBackupAt: getState(this.db, LAST_BACKUP_AT), lastBackupError: getState(this.db, LAST_BACKUP_ERROR), running: this.running };
  }

  async backupNow(): Promise<DriveFile> {
    if (this.running) throw new Error('A Drive backup is already running');
    const auth = getAuthedClient(this.db);
    if (!auth) throw new Error('Connect Google Drive first');
    this.running = true;
    try {
      const settings = getSettings(this.db);
      const drive = new Gdrive(auth);
      const zipBytes = await archiveVault(getVaultRoot(this.db));
      const encrypted = settings.driveBackupPassphrase.trim().length > 0;
      const bytes = encrypted ? encryptBackupArchive(zipBytes, settings.driveBackupPassphrase) : zipBytes;
      const folderId = await drive.getOrCreateFolder(DRIVE_BACKUP_FOLDER);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const uploaded = await drive.uploadBackup(folderId, `vault-${stamp}.${encrypted ? 'tbenc' : 'zip'}`, bytes);
      const backups = await drive.listBackups(folderId);
      for (const stale of backups.slice(settings.driveBackupRetention)) await drive.deleteAppFile(stale.id);
      setState(this.db, LAST_BACKUP_AT, new Date().toISOString());
      setState(this.db, LAST_BACKUP_ERROR, '');
      return uploaded;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState(this.db, LAST_BACKUP_ERROR, message);
      throw error;
    } finally {
      this.running = false;
    }
  }

  async list(): Promise<DriveFile[]> {
    const auth = getAuthedClient(this.db);
    if (!auth) return [];
    const drive = new Gdrive(auth);
    const folderId = await drive.getOrCreateFolder(DRIVE_BACKUP_FOLDER);
    return drive.listBackups(folderId);
  }

  /** Restores into an isolated folder; it never writes into the live vault. */
  async restoreForInspection(fileId: string): Promise<string> {
    const auth = getAuthedClient(this.db);
    if (!auth) throw new Error('Connect Google Drive first');
    const settings = getSettings(this.db);
    const bytes = await new Gdrive(auth).download(fileId);
    const decrypted = isEncryptedBackupArchive(bytes)
      ? (() => {
          const passphrase = settings.driveBackupPassphrase.trim();
          if (!passphrase) throw new Error('This backup is encrypted. Set the Drive backup passphrase in Settings before restoring it.');
          return decryptBackupArchive(bytes, passphrase);
        })()
      : bytes;
    const root = getVaultRoot(this.db);
    const destination = path.join(path.dirname(root), `${path.basename(root)}-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    await fsp.mkdir(destination, { recursive: true });
    // Node has no built-in zip extraction. Persist the archive alongside the empty inspection folder so
    // the user can inspect it without risking the active vault; extraction can be done by the OS/Explorer.
    await fsp.writeFile(path.join(destination, 'vault.zip'), decrypted);
    await fsp.writeFile(
      path.join(destination, 'README.txt'),
      `This is an isolated Drive backup restore created on ${new Date().toISOString()}.\nExtract vault.zip here to inspect it; the live vault was not changed.\n`,
    );
    return destination;
  }

  /** Run from a timer; failures are persisted for the Settings alert instead of escaping the event loop. */
  async runScheduled(): Promise<void> {
    const settings = getSettings(this.db);
    if (!settings.driveBackupIntervalHours || this.running || !getAuthedClient(this.db)) return;
    const last = getState(this.db, LAST_BACKUP_AT);
    if (last && Date.now() - Date.parse(last) < settings.driveBackupIntervalHours * 3_600_000) return;
    try { await this.backupNow(); } catch { /* status has the user-facing failure */ }
  }
}
