import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { EmailNotificationKind, EmailNotificationStatusDTO, ScheduleItemDTO, Settings } from '@timeblock/shared';
import { blocks, emailDispatches, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { getSettings } from '../settings.js';
import { GMAIL_SEND_SCOPE, hasGoogleScope, isGoogleAuthed, tokenEncryptionConfigured } from '../integrations/google/auth.js';
import { blockToItem } from '../plan/mappers.js';
import { buildAgendaEmailModel, buildRecapEmailModel } from './content.js';
import { GmailApiError, GmailRestSender, type GmailSender } from './gmail.js';
import { renderDailyRecap, renderMorningAgenda, renderTaskReminder, renderTestEmail, type EmailMessage } from './templates.js';

const POLL_MS = 20_000;
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];
const PENDING_STATUSES = ['pending', 'retry'] as const;
type DispatchRow = typeof emailDispatches.$inferSelect;

function atLocalTime(date: string, hhmm: string, timezone: string): DateTime {
  return DateTime.fromISO(`${date}T${hhmm}`, { zone: timezone });
}

function isOpenTask(task: typeof tasks.$inferSelect | undefined): boolean {
  return !!task && !task.isDeleted && !task.isCompleted && task.status !== 'done' && task.status !== 'cancelled';
}

function terminalStatus(status: string): status is 'sent' | 'skipped' | 'failed' {
  return status === 'sent' || status === 'skipped' || status === 'failed';
}

/** Independent Gmail poller. It never participates in calendar sync cycles. */
export class EmailNotificationService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastServiceError: string | null = null;

  constructor(private readonly db: DB, private readonly sender: GmailSender = new GmailRestSender(db)) {
    // Recover work claimed by an interrupted process. The unique dedupe key keeps
    // normal restart and concurrent-tick delivery single-flight.
    const now = new Date().toISOString();
    db.update(emailDispatches)
      .set({ status: 'retry', nextAttemptAtUtc: now, updatedAtUtc: now, lastError: 'Delivery interrupted; retrying.' })
      .where(eq(emailDispatches.status, 'sending'))
      .run();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(nowIso = new Date().toISOString()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const settings = getSettings(this.db);
      if (settings.emailNotificationsEnabled) {
        this.enqueueDue(settings, nowIso);
        const due = this.db
          .select()
          .from(emailDispatches)
          .where(inArray(emailDispatches.status, [...PENDING_STATUSES]))
          .all()
          .filter((row) => row.nextAttemptAtUtc <= nowIso)
          .sort((a, b) => a.nextAttemptAtUtc.localeCompare(b.nextAttemptAtUtc))
          .slice(0, 50);
        for (const row of due) await this.processOne(row.id, nowIso);
      }
    } catch (error) {
      this.lastServiceError = error instanceof Error ? error.message : String(error);
    } finally {
      this.running = false;
    }
  }

  private enqueueDue(settings: Settings, nowIso: string): void {
    const now = DateTime.fromISO(nowIso, { zone: 'utc' }).setZone(settings.timezone);
    const date = now.toISODate()!;
    const morning = atLocalTime(date, settings.emailMorningAgendaTime, settings.timezone);
    const recap = atLocalTime(date, settings.emailDailyRecapTime, settings.timezone);

    if (settings.emailMorningAgendaEnabled && now >= morning && now < recap) {
      this.enqueue('morning_agenda', `morning_agenda:${date}`, morning.toUTC().toISO()!, null, nowIso);
    }
    if (settings.emailDailyRecapEnabled) {
      if (now >= recap) {
        this.enqueue('daily_recap', `daily_recap:${date}`, recap.toUTC().toISO()!, null, nowIso);
      } else if (now < morning) {
        const previousDate = now.minus({ days: 1 }).toISODate()!;
        const previousRecap = atLocalTime(previousDate, settings.emailDailyRecapTime, settings.timezone);
        this.enqueue('daily_recap', `daily_recap:${previousDate}`, previousRecap.toUTC().toISO()!, null, nowIso);
      }
    }
    if (!settings.emailTaskReminderEnabled) return;

    const nowMs = Date.parse(nowIso);
    const leadMs = settings.emailTaskReminderMinutesBefore * 60_000;
    for (const block of this.db.select().from(blocks).all()) {
      if (!['scheduled', 'pending_create'].includes(block.status) || !block.taskId) continue;
      const startMs = Date.parse(block.startUtc);
      if (startMs <= nowMs || startMs - leadMs > nowMs) continue;
      const task = this.db.select().from(tasks).where(eq(tasks.id, block.taskId)).get();
      if (!isOpenTask(task)) continue;
      this.enqueue(
        'task_reminder',
        `task_reminder:${block.id}:${block.startUtc}`,
        new Date(startMs - leadMs).toISOString(),
        block.id,
        nowIso,
      );
    }
  }

  private enqueue(kind: EmailNotificationKind, dedupeKey: string, intendedSendAtUtc: string, blockId: string | null, nowIso: string): string {
    const id = randomUUID();
    this.db.insert(emailDispatches).values({
      id,
      kind,
      dedupeKey,
      blockId,
      intendedSendAtUtc,
      nextAttemptAtUtc: intendedSendAtUtc < nowIso ? nowIso : intendedSendAtUtc,
      attempts: 0,
      status: 'pending',
      createdAtUtc: nowIso,
      updatedAtUtc: nowIso,
    }).onConflictDoNothing().run();
    return this.db.select().from(emailDispatches).where(eq(emailDispatches.dedupeKey, dedupeKey)).get()?.id ?? id;
  }

  private claim(row: DispatchRow, nowIso: string): DispatchRow | null {
    const result = this.db.update(emailDispatches)
      .set({ status: 'sending', attempts: row.attempts + 1, updatedAtUtc: nowIso })
      .where(and(eq(emailDispatches.id, row.id), eq(emailDispatches.status, row.status)))
      .run();
    return result.changes === 1 ? this.db.select().from(emailDispatches).where(eq(emailDispatches.id, row.id)).get() ?? null : null;
  }

  private async messageFor(row: DispatchRow, settings: Settings, nowIso: string): Promise<EmailMessage | null> {
    const now = DateTime.fromISO(nowIso, { zone: 'utc' }).setZone(settings.timezone);
    if (row.kind === 'test') return renderTestEmail(settings.timezone);
    if (row.kind === 'morning_agenda') {
      const date = row.dedupeKey.slice('morning_agenda:'.length);
      const expires = atLocalTime(date, settings.emailDailyRecapTime, settings.timezone);
      if (now.toISODate() !== date || now >= expires) return null;
      return renderMorningAgenda(buildAgendaEmailModel(this.db, settings, date));
    }
    if (row.kind === 'daily_recap') {
      const date = row.dedupeKey.slice('daily_recap:'.length);
      const sendAt = atLocalTime(date, settings.emailDailyRecapTime, settings.timezone);
      const expires = atLocalTime(DateTime.fromISO(date, { zone: settings.timezone }).plus({ days: 1 }).toISODate()!, settings.emailMorningAgendaTime, settings.timezone);
      if (now < sendAt || now >= expires) return null;
      return renderDailyRecap(buildRecapEmailModel(this.db, settings, date));
    }
    if (row.kind === 'task_reminder' && row.blockId) {
      const block = this.db.select().from(blocks).where(eq(blocks.id, row.blockId)).get();
      if (!block || !block.taskId || !['scheduled', 'pending_create'].includes(block.status)) return null;
      if (row.dedupeKey !== `task_reminder:${block.id}:${block.startUtc}` || Date.parse(block.startUtc) <= Date.parse(nowIso)) return null;
      const task = this.db.select().from(tasks).where(eq(tasks.id, block.taskId)).get();
      if (!isOpenTask(task)) return null;
      const minutesUntilStart = Math.max(1, Math.ceil((Date.parse(block.startUtc) - Date.parse(nowIso)) / 60_000));
      return renderTaskReminder(blockToItem(this.db, block), settings.timezone, minutesUntilStart);
    }
    return null;
  }

  private async processOne(id: string, nowIso: string): Promise<void> {
    const pending = this.db.select().from(emailDispatches).where(eq(emailDispatches.id, id)).get();
    if (!pending || !PENDING_STATUSES.includes(pending.status as (typeof PENDING_STATUSES)[number])) return;
    const row = this.claim(pending, nowIso);
    if (!row) return;
    try {
      const settings = getSettings(this.db);
      const message = await this.messageFor(row, settings, nowIso);
      if (!message) {
        this.db.update(emailDispatches).set({ status: 'skipped', skippedAtUtc: nowIso, updatedAtUtc: nowIso, lastError: null }).where(eq(emailDispatches.id, row.id)).run();
        return;
      }
      const sent = await this.sender.send(message, row.dedupeKey);
      const sentAt = nowIso;
      this.db.update(emailDispatches).set({ status: 'sent', providerMessageId: sent.id, sentAtUtc: sentAt, updatedAtUtc: sentAt, lastError: null }).where(eq(emailDispatches.id, row.id)).run();
      this.lastServiceError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastServiceError = message;
      const status = error instanceof GmailApiError ? error.status : null;
      const transient = status == null || status === 408 || status === 429 || status >= 500;
      const shouldRetry = transient && row.attempts < MAX_ATTEMPTS;
      const updatedAt = nowIso;
      const delay = RETRY_DELAYS_MS[Math.min(row.attempts - 1, RETRY_DELAYS_MS.length - 1)];
      this.db.update(emailDispatches).set({
        status: shouldRetry ? 'retry' : 'failed',
        nextAttemptAtUtc: shouldRetry ? new Date(Date.parse(updatedAt) + delay).toISOString() : row.nextAttemptAtUtc,
        lastError: message,
        updatedAtUtc: updatedAt,
      }).where(eq(emailDispatches.id, row.id)).run();
    }
  }

  async sendTest(nowIso = new Date().toISOString()): Promise<void> {
    if (!isGoogleAuthed(this.db) || !hasGoogleScope(this.db, GMAIL_SEND_SCOPE)) throw new Error('Connect Gmail and grant send permission first.');
    const id = this.enqueue('test', `test:${randomUUID()}`, nowIso, null, nowIso);
    await this.processOne(id, nowIso);
    const row = this.db.select().from(emailDispatches).where(eq(emailDispatches.id, id)).get();
    if (row?.status !== 'sent') throw new Error(row?.lastError ?? 'Test email could not be sent.');
  }

  async status(): Promise<EmailNotificationStatusDTO> {
    const googleConnected = isGoogleAuthed(this.db);
    const gmailPermissionGranted = hasGoogleScope(this.db, GMAIL_SEND_SCOPE);
    let senderEmail: string | null = null;
    let profileError: string | null = null;
    if (googleConnected && gmailPermissionGranted) {
      try { senderEmail = (await this.sender.profile()).emailAddress; }
      catch (error) { profileError = error instanceof Error ? error.message : String(error); }
    }
    const terminal = this.db.select().from(emailDispatches).orderBy(desc(emailDispatches.updatedAtUtc)).all().filter((row) => terminalStatus(row.status));
    const latest = terminal[0];
    const at = latest ? (latest.sentAtUtc ?? latest.skippedAtUtc ?? latest.updatedAtUtc) : null;
    return {
      googleConnected,
      gmailPermissionGranted,
      encryptionConfigured: tokenEncryptionConfigured(),
      senderEmail,
      recipientEmail: senderEmail,
      lastDelivery: latest && at && terminalStatus(latest.status) ? {
        kind: latest.kind as EmailNotificationKind,
        status: latest.status,
        at,
        error: latest.lastError,
      } : null,
      // A historical dispatch failure remains visible in lastDelivery, but it
      // is not a current connection error once a fresh identity check works.
      currentError: profileError ?? this.lastServiceError ?? null,
    };
  }
}
