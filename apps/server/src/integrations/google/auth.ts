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
];

export function googleCredsPresent(): boolean {
  return !!(env.googleClientId && env.googleClientSecret);
}

function makeClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri: OAUTH_REDIRECT_URI,
  });
}

export function getAuthUrl(): string {
  return makeClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
  });
}

function persistTokens(db: DB, tokens: Credentials) {
  const existing = db.select().from(oauthTokens).where(eq(oauthTokens.provider, 'google')).get();
  const row = {
    accessToken: tokens.access_token ?? existing?.accessToken ?? null,
    refreshToken: tokens.refresh_token ?? existing?.refreshToken ?? null,
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
    access_token: row.accessToken ?? undefined,
    refresh_token: row.refreshToken,
    expiry_date: row.expiryUtc ? Date.parse(row.expiryUtc) : undefined,
  });
  client.on('tokens', (t) => persistTokens(db, t));
  return client;
}
