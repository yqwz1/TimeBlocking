const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/** Makes a user/AI supplied title safe as one cross-platform Markdown filename segment. */
export function sanitizeVoiceNoteTitle(title: string): string {
  let safe = title
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\- ]+|[.\- ]+$/g, '')
    .slice(0, 80)
    .replace(/[.\- ]+$/g, '');
  if (!safe) safe = 'voice-note';
  if (WINDOWS_RESERVED_NAME.test(safe)) safe = `note-${safe}`;
  return safe;
}

/** Builds a unique vault-relative capture path under e.g. `Inbox/Voice/2026-07-24/...`. */
export function buildInboxNotePath(baseFolder: string, localTimestamp: string, title: string, existingIds: Iterable<string> = []): string {
  const cleanFolder = baseFolder
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
  const dateFolder = /^\d{4}-\d{2}-\d{2}/.exec(localTimestamp)?.[0] ?? 'Inbox';
  const stem = `${cleanFolder}/${dateFolder}/${localTimestamp}-${sanitizeVoiceNoteTitle(title)}`;
  const occupied = new Set([...existingIds].map((id) => id.toLocaleLowerCase()));
  let candidate = `${stem}.md`;
  let suffix = 2;
  while (occupied.has(candidate.toLocaleLowerCase())) candidate = `${stem}-${suffix++}.md`;
  return candidate;
}

/** Builds a unique vault-relative path from a local `yyyy-MM-dd-HHmmss` timestamp. */
export function buildVoiceNotePath(localTimestamp: string, title: string, existingIds: Iterable<string> = []): string {
  const stem = `Voice Notes/${localTimestamp}-${sanitizeVoiceNoteTitle(title)}`;
  const occupied = new Set([...existingIds].map((id) => id.toLocaleLowerCase()));
  let candidate = `${stem}.md`;
  let suffix = 2;
  while (occupied.has(candidate.toLocaleLowerCase())) candidate = `${stem}-${suffix++}.md`;
  return candidate;
}
