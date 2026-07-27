import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decryptBackupArchive, encryptBackupArchive, isEncryptedBackupArchive } from '../integrations/google/driveBackups.js';
import { listNoteSnapshots, readNoteFile, restoreNoteSnapshot, writeNoteFile } from './vault.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function tempVault(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tb-phase8-'));
  tempDirs.push(dir);
  return dir;
}

describe('Phase 8 notes utilities', () => {
  it('round-trips encrypted Drive backup archives', () => {
    const source = Buffer.from('vault-bytes-go-here');
    const encrypted = encryptBackupArchive(source, 'correct horse battery staple');
    expect(isEncryptedBackupArchive(encrypted)).toBe(true);
    expect(decryptBackupArchive(encrypted, 'correct horse battery staple')).toEqual(source);
  });

  it('lists and restores per-note snapshots', async () => {
    const root = await tempVault();
    const noteId = 'Projects/Test.md';
    await writeNoteFile(root, noteId, '# First\n', 10);
    await writeNoteFile(root, noteId, '# Second\n', 10);
    await writeNoteFile(root, noteId, '# Third\n', 10);

    const snapshots = await listNoteSnapshots(root, noteId);
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[0].createdAt.endsWith('Z')).toBe(true);

    await restoreNoteSnapshot(root, noteId, snapshots[snapshots.length - 1].id, 10);
    const restored = await readNoteFile(root, noteId);
    expect(restored?.content).toBe('# First\n');
  });
});
