/**
 * "Recent" tracks what was opened, not what was edited (Obsidian's own model) — so it
 * lives client-side in localStorage rather than as server state derived from updatedAt.
 */
const KEY = 'timeblock:notes:recent';
const MAX = 20;

export function recordNoteOpened(id: string): void {
  try {
    const list = getRecentNoteIds().filter((existing) => existing !== id);
    list.unshift(id);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // localStorage unavailable (private browsing etc.) — recent list is a convenience, not critical
  }
}

export function getRecentNoteIds(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function forgetRecentNote(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(getRecentNoteIds().filter((existing) => existing !== id)));
  } catch {
    // ignore
  }
}
