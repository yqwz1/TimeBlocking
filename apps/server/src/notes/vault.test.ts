import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVaultFolder, deleteVaultFolder, restoreFromTrash, trashVaultFolder } from './vault.js';

describe('vault folders', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
  });

  it('creates and deletes an empty folder', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'timeblock-vault-'));
    roots.push(root);
    await createVaultFolder(root, 'Projects/Alpha');
    await deleteVaultFolder(root, 'Projects/Alpha');
    await expect(fsp.stat(path.join(root, 'Projects/Alpha'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('moves a populated folder to trash and restores all files together', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'timeblock-vault-'));
    roots.push(root);
    await fsp.mkdir(path.join(root, 'Projects/Alpha'), { recursive: true });
    await fsp.writeFile(path.join(root, 'Projects/Alpha/Overview.md'), '# Alpha');
    await fsp.writeFile(path.join(root, 'Projects/Alpha/Notes.md'), '# Notes');

    const trashId = await trashVaultFolder(root, 'Projects/Alpha');
    await expect(fsp.stat(path.join(root, 'Projects/Alpha'))).rejects.toMatchObject({ code: 'ENOENT' });
    const restored = await restoreFromTrash(root, trashId);
    expect(restored.sort()).toEqual(['Projects/Alpha/Notes.md', 'Projects/Alpha/Overview.md'].sort());
    await expect(fsp.readFile(path.join(root, 'Projects/Alpha/Overview.md'), 'utf8')).resolves.toBe('# Alpha');
  });
});
