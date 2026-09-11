import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDb } from '../db/client.js';
import type { SyncManager } from '../sync/manager.js';
import { registerSettingsRoutes } from './settings.js';

describe('settings routes email validation', () => {
  let app: ReturnType<typeof Fastify> | undefined;
  afterEach(async () => app?.close());

  it('rejects malformed email timing settings', async () => {
    app = Fastify();
    registerSettingsRoutes(app, createDb(':memory:'), { forcePlan: vi.fn() } as unknown as SyncManager);
    await app.ready();
    const response = await app.inject({ method: 'PUT', url: '/settings', payload: { emailMorningAgendaTime: '25:90' } });
    expect(response.statusCode).toBe(400);
  });

  it('does not enable the master switch before encrypted Gmail authorization exists', async () => {
    app = Fastify();
    registerSettingsRoutes(app, createDb(':memory:'), { forcePlan: vi.fn() } as unknown as SyncManager);
    await app.ready();
    const response = await app.inject({ method: 'PUT', url: '/settings', payload: { emailNotificationsEnabled: true } });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: string }).error).toMatch(/TB_TOKEN_ENCRYPTION_KEY|grant send permission/);
  });
});
