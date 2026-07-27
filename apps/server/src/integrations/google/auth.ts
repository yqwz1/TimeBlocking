import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { OAuth2Client, type Credentials } from 'google-auth-library';
import { eq } from 'drizzle-orm';
import { oauthTokens } from '../../db/schema.js';
import type { DB } from '../../db/client.js';
import { env, OAUTH_REDIRECT_URI } from '../../config.js';

export const GOOGLE_SCOPES = [
  // Full read/write on calendars this app creates (needed to create + manage the "⏱ Time Blocks" calendar).
  'https://www.googleapis.com/auth/calendar.app.created',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  // Identity is only used to show the connected account in Settings.
  'https://www.googleapis.com/auth/userinfo.email',
  // The default Drive permission is intentionally narrow: files and folders
  // created by this app (the backup mirror) only.
  'https://www.googleapis.com/auth/drive.file',
];

export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const ENCRYPTED_PREFIX = 'enc:v1:';

export function googleCredsPresent(): boolean {
  return !!(env.googleClientId && env.googleClientSecret);
}

export function tokenEncryptionConfigured(): boolean {
  return env.tokenEncryptionKey.trim().length >= 32;
}

function encryptionKey(): Buffer {
  if (!tokenEncryptionConfigured()) throw new Error('TB_TOKEN_ENCRYPTION_KEY must be set to at least 32 characters before connecting Google Drive');
  return createHash('sha256').update(env.tokenEncryptionKey).digest();
}

function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${ENCRYPTED_PREFIX}${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')}`;
}

function decrypt(value: string): string {
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value; // legacy calendar token; re-encrypted on its next refresh.
  const packed = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64url');
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const body = packed.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

function makeClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri: OAUTH_REDIRECT_URI,
  });
}

export function getAuthUrl(includeDriveReadonly = false): string {
  return makeClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: includeDriveReadonly ? [...GOOGLE_SCOPES, DRIVE_READONLY_SCOPE] : GOOGLE_SCOPES,
  });
}

function persistTokens(db: DB, tokens: Credentials) {
  const existing = db.select().from(oauthTokens).where(eq(oauthTokens.provider, 'google')).get();
  const row = {
    accessToken: tokens.access_token ? encrypt(tokens.access_token) : (existing?.accessToken ?? null),
    refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : (existing?.refreshToken ?? null),
    expiryUtc: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : (existing?.expiryUtc ?? null),
    scopes: tokens.scope ?? existing?.scopes ?? null,
  };
  db.insert(oauthTokens)
    .values({ provider: 'google', ...row })
    .onConflictDoUpdate({ target: oauthTokens.provider, set: row })
    .run();
}

export async function handleOAuthCallback(db: DB, code: string): Promise<void> {
  const client = makeClient();
  const { tokens } = await client.getToken(code);
  persistTokens(db, tokens);
}

export function isGoogleAuthed(db: DB): boolean {
  const row = db.select().from(oauthTokens).where(eq(oauthTokens.provider, 'google')).get();
  return !!row?.refreshToken;
}

export function disconnectGoogle(db: DB) {
  db.delete(oauthTokens).where(eq(oauthTokens.provider, 'google')).run();
}

/** Returns an OAuth2 client with persisted credentials, auto-refresh included, or null if not connected. */
export function getAuthedClient(db: DB): OAuth2Client | null {
  const row = db.select().from(oauthTokens).where(eq(oauthTokens.provider, 'google')).get();
  if (!row?.refreshToken) return null;
  const client = makeClient();
  client.setCredentials({
    access_token: row.accessToken ? decrypt(row.accessToken) : undefined,
    refresh_token: decrypt(row.refreshToken),
    expiry_date: row.expiryUtc ? Date.parse(row.expiryUtc) : undefined,
  });
  client.on('tokens', (t) => persistTokens(db, t));
  return client;
}
