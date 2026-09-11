import { createHash } from 'node:crypto';
import type { DB } from '../db/client.js';
import { getAuthedClient } from '../integrations/google/auth.js';
import type { EmailMessage } from './templates.js';

export class GmailApiError extends Error {
  constructor(message: string, public readonly status: number | null) {
    super(message);
    this.name = 'GmailApiError';
  }
}

export interface GmailSender {
  profile(): Promise<{ emailAddress: string }>;
  send(message: EmailMessage, deliveryKey?: string): Promise<{ id: string; emailAddress: string }>;
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export function buildMimeMessage(emailAddress: string, message: EmailMessage, deliveryKey = `${message.subject}\0${message.text}`): string {
  const boundary = `timeblock-${createHash('sha256').update(`${emailAddress}\0${message.subject}\0${message.text}\0${message.html}`).digest('hex').slice(0, 24)}`;
  const messageId = createHash('sha256').update(deliveryKey).digest('hex').slice(0, 32);
  return [
    `From: ${emailAddress}`,
    `To: ${emailAddress}`,
    `Message-ID: <timeblock.${messageId}@timeblocking.local>`,
    `Subject: ${encodeHeader(message.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    message.text,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    message.html,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

async function gmailRequest<T>(db: DB, path: string, init?: RequestInit): Promise<T> {
  const auth = getAuthedClient(db);
  if (!auth) throw new GmailApiError('Connect Google and grant Gmail send permission.', 401);
  const token = await auth.getAccessToken();
  if (!token.token) throw new GmailApiError('Google authorization is unavailable. Reconnect Gmail in Settings.', 401);
  let response: Response;
  try {
    response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (error) {
    throw new GmailApiError(error instanceof Error ? error.message : String(error), null);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new GmailApiError(payload?.error?.message ?? `Gmail API returned ${response.status}`, response.status);
  }
  return response.json() as Promise<T>;
}

/**
 * gmail.send deliberately cannot read the Gmail profile. The base Google
 * connection already requests openid + userinfo.email, which is sufficient
 * to learn the connected account for self-addressed notifications.
 */
async function connectedAccountEmail(db: DB): Promise<string> {
  const auth = getAuthedClient(db);
  if (!auth) throw new GmailApiError('Connect Google and grant Gmail send permission.', 401);
  const token = await auth.getAccessToken();
  if (!token.token) throw new GmailApiError('Google authorization is unavailable. Reconnect Gmail in Settings.', 401);

  let response: Response;
  try {
    response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token.token}` },
    });
  } catch (error) {
    throw new GmailApiError(error instanceof Error ? error.message : String(error), null);
  }
  if (!response.ok) throw new GmailApiError(`Google account lookup returned ${response.status}`, response.status);
  const payload = await response.json() as { email?: string };
  if (!payload.email) throw new GmailApiError('Google did not provide an email address for the connected account.', 400);
  return payload.email;
}

export class GmailRestSender implements GmailSender {
  constructor(private readonly db: DB) {}

  async profile(): Promise<{ emailAddress: string }> {
    return { emailAddress: await connectedAccountEmail(this.db) };
  }

  async send(message: EmailMessage, deliveryKey?: string): Promise<{ id: string; emailAddress: string }> {
    const { emailAddress } = await this.profile();
    const raw = Buffer.from(buildMimeMessage(emailAddress, message, deliveryKey), 'utf8').toString('base64url');
    const sent = await gmailRequest<{ id: string }>(this.db, '/messages/send', { method: 'POST', body: JSON.stringify({ raw }) });
    return { id: sent.id, emailAddress };
  }
}
