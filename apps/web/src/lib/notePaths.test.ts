import { describe, expect, it } from 'vitest';
import { noteFileNameForRename, notePathInFolder } from './notePaths.js';

describe('note paths', () => {
  it('keeps a rename as a file instead of turning the new name into a folder', () => {
    expect(noteFileNameForRename('New name')).toBe('New name.md');
    expect(noteFileNameForRename('New name.md')).toBe('New name.md');
    expect(noteFileNameForRename('nested/name')).toBe('nested-name.md');
  });

  it('joins a note filename to its destination folder', () => {
    expect(notePathInFolder('', 'Note.md')).toBe('Note.md');
    expect(notePathInFolder('Projects/Alpha', 'Note.md')).toBe('Projects/Alpha/Note.md');
  });
});
