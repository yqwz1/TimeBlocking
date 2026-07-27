/** URL-safe opaque note ids keep nested vault paths out of route parsing. */
export function encodeIntegrationNoteId(notePath: string): string {
  return Buffer.from(notePath, 'utf8').toString('base64url');
}

export function decodeIntegrationNoteId(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('invalid note id');
  const decoded = Buffer.from(id, 'base64url').toString('utf8');
  if (!decoded || Buffer.from(decoded, 'utf8').toString('base64url') !== id.replace(/=+$/, '')) throw new Error('invalid note id');
  return decoded;
}

export function notePathFromDeepLink(value: string): string | null {
  try {
    const url = new URL(value, 'http://localhost');
    const match = url.pathname.match(/^\/note\/([^/]+)$/);
    return match ? decodeIntegrationNoteId(match[1]) : null;
  } catch {
    return null;
  }
}
