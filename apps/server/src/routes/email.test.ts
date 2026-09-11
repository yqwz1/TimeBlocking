import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDb } from '../db/client.js';
import type { EmailNotificationService } from '../email/service.js';
import { registerEmailRoutes } from './email.js';

describe('email routes', () => {
  let app: ReturnType<typeof Fastify> | undefined;
  afterEach(async () => app?.close());

  it('returns status and invokes a user-triggered test send', async () => {
    const status = {
      googleConnected: true, gmailPermissionGranted: true, encryptionConfigured: true,
      senderEmail: 'me@example.com', recipientEmail: 'me@example.com', lastDelivery: null, currentError: null,
    };
    const service = { status: vi.fn(async () => status), sendTest: vi.fn(async () => undefined) } as unknown as EmailNotificationService;
    app = Fastify();
    registerEmailRoutes(app, createDb(':memory:'), service);
    await app.ready();

    const statusResponse = await app.inject({ method: 'GET', url: '/email/status' });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toMatchObject({ senderEmail: 'me@example.com', gmailPermissionGranted: true });
    const testResponse = await app.inject({ method: 'POST', url: '/email/test' });
    expect(testResponse.statusCode).toBe(200);
    expect(service.sendTest).toHaveBeenCalledOnce();
  });

  it('surfaces test-send failures as actionable client errors', async () => {
    const service = {
      status: vi.fn(),
      sendTest: vi.fn(async () => { throw new Error('Reconnect Gmail.'); }),
    } as unknown as EmailNotificationService;
    app = Fastify();
    registerEmailRoutes(app, createDb(':memory:'), service);
    await app.ready();
    const response = await app.inject({ method: 'POST', url: '/email/test' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Reconnect Gmail.' });
  });
});
