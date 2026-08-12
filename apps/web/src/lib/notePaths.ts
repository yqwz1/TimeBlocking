/** Returns a safe markdown filename for a note rename. */
export function noteFileNameForRename(value: string): string {
  const stem = value.trim().replace(/[\\/]/g, '-').replace(/\.md$/i, '').trim();
  return stem ? `${stem}.md` : '';
}

/** Builds a vault-relative note path from a folder and filename. */
export function notePathInFolder(folder: string, fileName: string): string {
  return folder ? `${folder}/${fileName}` : fileName;
}
