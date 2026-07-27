export function decodeNoteDeepLinkId(id: string): string | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
    const base64 = id.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(id.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes) || null;
  } catch {
    return null;
  }
}
