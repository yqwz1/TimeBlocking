import { describe, expect, it, vi } from 'vitest';
import { createDb, type DB } from '../db/client.js';
import { blocks, emailDispatches, tasks } from '../db/schema.js';
import { updateSettings } from '../settings.js';
import { GmailApiError, type GmailSender } from './gmail.js';
import { EmailNotificationService } from './service.js';

function mockSender(send: GmailSender['send'] = vi.fn(async () => ({ id: 'gmail-1', emailAddress: 'me@example.com' }))): GmailSender {
  return { profile: vi.fn(async () => ({ emailAddress: 'me@example.com' })), send };
}

function emailOnlySettings(db: DB) {
  updateSettings(db, {
    timezone: 'Asia/Riyadh',
    emailNotificationsEnabled: true,
    emailMorningAgendaEnabled: false,
    emailDailyRecapEnabled: false,
    emailTaskReminderEnabled: true,
    emailTaskReminderMinutesBefore: 30,
  });
}

describe('EmailNotificationService', () => {
  it('delivers a split block exactly once across concurrent ticks and restarts', async () => {
    const db = createDb(':memory:');
    emailOnlySettings(db);
    db.insert(tasks).values({ id: 'task', content: 'Deep work', status: 'todo' }).run();
    db.insert(blocks).values({ id: 'chunk-2', taskId: 'task', startUtc: '2026-09-08T07:30:00.000Z', endUtc: '2026-09-08T08:00:00.000Z', status: 'scheduled', chunkIndex: 1 }).run();
    const send = vi.fn(async () => ({ id: 'gmail-1', emailAddress: 'me@example.com' }));

    const first = new EmailNotificationService(db, mockSender(send));
    const concurrent = new EmailNotificationService(db, mockSender(send));
    await Promise.all([first.tick('2026-09-08T07:10:00.000Z'), concurrent.tick('2026-09-08T07:10:00.000Z')]);
    await new EmailNotificationService(db, mockSender(send)).tick('2026-09-08T07:11:00.000Z');

    expect(send).toHaveBeenCalledTimes(1);
    expect(db.select().from(emailDispatches).all()).toEqual([
      expect.objectContaining({ kind: 'task_reminder', blockId: 'chunk-2', status: 'sent', attempts: 1 }),
    ]);
  });

  it('retries transient failures and invalidates the old dispatch when a block moves', async () => {
    const db = createDb(':memory:');
    emailOnlySettings(db);
    db.insert(tasks).values({ id: 'task', content: 'Move me', status: 'todo' }).run();
    db.insert(blocks).values({ id: 'block', taskId: 'task', startUtc: '2026-09-08T07:30:00.000Z', endUtc: '2026-09-08T08:00:00.000Z', status: 'pending_create' }).run();
    const send = vi.fn<GmailSender['send']>()
      .mockRejectedValueOnce(new GmailApiError('temporary', 503))
      .mockResolvedValue({ id: 'gmail-2', emailAddress: 'me@example.com' });
    const service = new EmailNotificationService(db, mockSender(send));

    await service.tick('2026-09-08T07:10:00.000Z');
    expect(db.select().from(emailDispatches).all()[0]).toMatchObject({ status: 'retry', attempts: 1 });
    db.update(blocks).set({ startUtc: '2026-09-08T07:35:00.000Z', endUtc: '2026-09-08T08:05:00.000Z' }).run();
    await service.tick('2026-09-08T07:10:31.000Z');

    const rows = db.select().from(emailDispatches).all().sort((a, b) => a.createdAtUtc.localeCompare(b.createdAtUtc));
    expect(rows.map((row) => row.status).sort()).toEqual(['sent', 'skipped']);
    expect(rows.find((row) => row.status === 'sent')?.dedupeKey).toContain('2026-09-08T07:35:00.000Z');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('never sends reminders after a block starts or after the task is completed', async () => {
    const db = createDb(':memory:');
    emailOnlySettings(db);
    db.insert(tasks).values({ id: 'task', content: 'Already done', status: 'done', isCompleted: 1 }).run();
    db.insert(blocks).values([
      { id: 'started', taskId: 'task', startUtc: '2026-09-08T07:00:00.000Z', endUtc: '2026-09-08T08:00:00.000Z', status: 'scheduled' },
      { id: 'future', taskId: 'task', startUtc: '2026-09-08T07:30:00.000Z', endUtc: '2026-09-08T08:00:00.000Z', status: 'scheduled' },
    ]).run();
    const send = vi.fn(async () => ({ id: 'gmail-1', emailAddress: 'me@example.com' }));
    await new EmailNotificationService(db, mockSender(send)).tick('2026-09-08T07:10:00.000Z');
    expect(send).not.toHaveBeenCalled();
    expect(db.select().from(emailDispatches).all()).toHaveLength(0);
  });

  it('applies agenda and recap catch-up boundaries and still sends empty days', async () => {
    const db = createDb(':memory:');
    updateSettings(db, {
      timezone: 'Asia/Riyadh', emailNotificationsEnabled: true,
      emailMorningAgendaEnabled: true, emailMorningAgendaTime: '07:30',
      emailDailyRecapEnabled: true, emailDailyRecapTime: '21:30',
      emailTaskReminderEnabled: false,
    });
    const send = vi.fn(async () => ({ id: `gmail-${send.mock.calls.length}`, emailAddress: 'me@example.com' }));
    const service = new EmailNotificationService(db, mockSender(send));

    await service.tick('2026-09-08T04:29:59.000Z');
    expect(send).toHaveBeenCalledTimes(1); // Sep 7 recap is still eligible until the morning-agenda boundary.
    await service.tick('2026-09-08T04:30:00.000Z');
    await service.tick('2026-09-08T18:30:00.000Z');
    expect(send).toHaveBeenCalledTimes(3);
    expect(db.select().from(emailDispatches).all().map((row) => row.kind).sort()).toEqual(['daily_recap', 'daily_recap', 'morning_agenda']);
  });

  it('stops retrying authorization failures and exposes the error', async () => {
    const db = createDb(':memory:');
    emailOnlySettings(db);
    db.insert(tasks).values({ id: 'task', content: 'Needs auth', status: 'todo' }).run();
    db.insert(blocks).values({ id: 'block', taskId: 'task', startUtc: '2026-09-08T07:30:00.000Z', endUtc: '2026-09-08T08:00:00.000Z', status: 'scheduled' }).run();
    const sender = mockSender(vi.fn(async () => { throw new GmailApiError('Grant Gmail access again.', 401); }));
    const service = new EmailNotificationService(db, sender);
    await service.tick('2026-09-08T07:10:00.000Z');
    expect(db.select().from(emailDispatches).all()[0]).toMatchObject({ status: 'failed', attempts: 1 });
    expect((await service.status()).currentError).toBe('Grant Gmail access again.');
  });
});
