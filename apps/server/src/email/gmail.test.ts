import { describe, expect, it } from 'vitest';
import { GOOGLE_SCOPES, GMAIL_SEND_SCOPE, getAuthUrl, getGrantedGoogleScopes, markGoogleScopeGranted } from '../integrations/google/auth.js';
import { buildMimeMessage } from './gmail.js';
import { createDb } from '../db/client.js';
import { oauthTokens } from '../db/schema.js';

describe('Gmail delivery', () => {
  it('builds a multipart message addressed from and to the connected account', () => {
    const mime = buildMimeMessage('me@example.com', { subject: 'Agenda — اليوم', text: 'Plain body', html: '<p>HTML body</p>' });
    expect(mime).toContain('From: me@example.com\r\nTo: me@example.com');
    expect(mime).toContain('Message-ID: <timeblock.');
    expect(mime).toContain('Content-Type: multipart/alternative');
    expect(mime).toContain('Content-Type: text/plain');
    expect(mime).toContain('Content-Type: text/html');
    expect(mime).toContain('=?UTF-8?B?');
  });

  it('requests send-only Gmail access while preserving the existing Google scopes', () => {
    const url = new URL(getAuthUrl({ includeDriveReadonly: true, includeGmailSend: true, state: 'email-notifications' }));
    const scopes = (url.searchParams.get('scope') ?? '').split(' ');
    expect(scopes).toEqual(expect.arrayContaining([...GOOGLE_SCOPES, GMAIL_SEND_SCOPE]));
    expect(scopes.some((scope) => scope.includes('gmail.readonly') || scope.includes('gmail.modify') || scope.endsWith('/gmail'))).toBe(false);
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(url.searchParams.get('state')).toBe('email-notifications');
  });

  it('preserves recorded Calendar and Drive grants when Gmail is added', () => {
    const db = createDb(':memory:');
    db.insert(oauthTokens).values({ provider: 'google', refreshToken: 'legacy', scopes: GOOGLE_SCOPES.join(' ') }).run();
    markGoogleScopeGranted(db, GMAIL_SEND_SCOPE);
    expect(getGrantedGoogleScopes(db)).toEqual(expect.arrayContaining([...GOOGLE_SCOPES, GMAIL_SEND_SCOPE]));
  });
});
