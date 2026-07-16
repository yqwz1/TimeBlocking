import { EventEmitter } from 'node:events';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { ReminderFiredEventDTO, ScheduleRunDTO, SyncStatusDTO } from '@timeblock/shared';
import { events, reminders, syncLog, tasks } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { nowUtcIso } from '../config.js';
import { getSettings } from '../settings.js';
import { logSync, trimLog } from '../log.js';
import { scheduleRuns } from '../db/schema.js';
import { getAuthedClient } from '../integrations/google/auth.js';
import { Gcal, isOfflineError } from '../integrations/google/client.js';
import { pullAppCalendar } from '../integrations/google/sync.js';
import { markElapsedAsMissed, planAndApply, planOnly, type RunSummary } from './reconciler.js';
import { getDraftProposalId, lastAppliedAt } from './proposals.js';
import type { BlockOp } from '../scheduler/diff.js';
import { rollupDay } from '../analytics/rollup.js';
import { evaluatePendingDays } from '../gamification/engine.js';

const GOOGLE_POLL_MS = 60_000;
const TICK_MS = 20_000;
const WAKE_GAP_MS = 5 * 60_000;

function countOps(ops: BlockOp[]): { created: number; moved: number; deleted: number } {
  let created = 0;
  let moved = 0;
  let deleted = 0;
  for (const op of ops) {
    if (op.type === 'create') created++;
    else if (op.type === 'move') moved++;
    else deleted++;
  }
  return { created, moved, deleted };
}

interface CycleOpts {
  forceGoogle?: boolean;
  forcePlan?: boolean;
}

/**
 * Owns the mutex-serialized sync cycle: pull Google -> mark missed -> fire
 * reminders -> plan (if dirty, and only apply when autoApply:'full') -> rollup
 * -> notify. One instance per server process; routes call into it for on-demand
 * cycles (sync/proposal/task actions) and it also self-schedules polling.
 */
export class SyncManager extends EventEmitter {
  private running = false;
  private queued = false;
  private timer: NodeJS.Timeout | null = null;
  private lastTickAt = Date.now();
  private lastGooglePullAt = 0;

  private lastCycleAt: string | null = null;
  private lastGooglePullAtIso: string | null = null;
  private lastError: string | null = null;
  /** True when Google is unreachable (no internet). Sync pauses and auto-resumes; not an error. */
  private offline = false;
  private lastRun: ScheduleRunDTO | null = null;
  /** Counts from the last dry (autoApply:'off') plan — what the planner would change if applied. */
  private drift = { created: 0, moved: 0, deleted: 0 };

  constructor(private db: DB) {
    super();
  }

  start() {
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private tick() {
    const now = Date.now();
    const gap = now - this.lastTickAt;
    this.lastTickAt = now;
    const wake = gap > WAKE_GAP_MS + TICK_MS;
    if (wake) logSync(this.db, 'system', 'info', `resumed after ${Math.round(gap / 1000)}s gap (sleep/idle) -> catch-up cycle`);
    void this.runCycle('poll', { forceGoogle: wake });
  }

  async runCycle(trigger: string, opts: CycleOpts = {}): Promise<RunSummary | null> {
    if (this.running) {
      this.queued = true;
      return null;
    }
    this.running = true;
    let result: RunSummary | null = null;
    try {
      result = await this.doCycle(trigger, opts);
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      logSync(this.db, 'system', 'error', this.lastError);
    } finally {
      this.running = false;
      this.lastCycleAt = nowUtcIso();
      trimLog(this.db);
      this.emit('update', this.getStatus());
    }
    if (this.queued) {
      this.queued = false;
      setImmediate(() => void this.runCycle('queued-followup'));
    }
    return result;
  }

  private async doCycle(trigger: string, opts: CycleOpts): Promise<RunSummary | null> {
    const settings = getSettings(this.db);
    const nowIso = nowUtcIso();
    const now = Date.now();
    let dirty = !!opts.forcePlan;

    const gcalClient = this.tryGcal();
    if (gcalClient && settings.appCalendarId && (opts.forceGoogle || now - this.lastGooglePullAt >= GOOGLE_POLL_MS)) {
      // Google I/O is best-effort: a lost connection must never abort the local
      // work below (missed-marking, reminders, rollups). We pause sync and resume
      // automatically on the next cycle once we're back online.
      try {
        const r = await pullAppCalendar(this.db, gcalClient, settings);
        this.lastGooglePullAt = now;
        this.lastGooglePullAtIso = nowUtcIso();
        if (r.changed) dirty = true;
        this.noteOffline(false);
      } catch (err) {
        if (isOfflineError(err)) this.noteOffline(true);
        else logSync(this.db, 'google', 'error', err instanceof Error ? err.message : String(err));
      }
    }

    const elapsedChanged = markElapsedAsMissed(this.db, settings, nowIso);
    if (elapsedChanged && settings.autoRescheduleMissed) dirty = true;

    evaluatePendingDays(this.db, settings, nowIso);
    this.fireReminders(nowIso);
    this.fireEventReminders(nowIso);

    let summary: RunSummary | null = null;
    if (dirty && gcalClient && settings.appCalendarId) {
      const externalBusy = await this.freeBusy(gcalClient, settings, nowIso);

      if (settings.autoApply === 'full') {
        // Applying writes to Google. If we lose the connection mid-apply, pause
        // rather than crash the cycle — the next online cycle replans and pushes.
        try {
          summary = await planAndApply(this.db, gcalClient, settings, externalBusy, nowIso, true, settings.autoRescheduleMissed);
          this.noteOffline(false);
        } catch (err) {
          if (isOfflineError(err)) this.noteOffline(true);
          else throw err;
        }
        if (summary) {
          this.db
            .insert(scheduleRuns)
            .values({
              ranAtUtc: nowIso,
              trigger,
              created: summary.created,
              moved: summary.moved,
              deleted: summary.deleted,
              atRisk: JSON.stringify(summary.atRisk),
              unplaceable: JSON.stringify(summary.unplaceable),
              risks: JSON.stringify(summary.risks),
              dayLoads: JSON.stringify(summary.dayLoads),
            })
            .run();
          this.lastRun = {
            ranAt: nowIso,
            trigger,
            created: summary.created,
            moved: summary.moved,
            deleted: summary.deleted,
            atRisk: summary.atRisk,
            unplaceable: summary.unplaceable,
          };
        }
      } else {
        // autoApply:'off' (default) — the planner only observes. It never writes to
        // Google/DB on its own; it just reports what it *would* change so the UI can
        // surface a "review" prompt. Writing only happens via an explicit proposal apply.
        const { ops } = planOnly(this.db, settings, nowIso, externalBusy, {
          sticky: true,
          allowMissedReplan: settings.autoRescheduleMissed,
        });
        this.drift = countOps(ops);
        if (this.drift.created || this.drift.moved || this.drift.deleted) {
          logSync(
            this.db,
            'scheduler',
            'info',
            `drift: +${this.drift.created} ~${this.drift.moved} -${this.drift.deleted} (review to apply)`,
          );
        }
      }
      rollupDay(this.db, settings, nowIso.slice(0, 10), externalBusy);
    }
    return summary;
  }

  /** Fires any due, unfired reminders for open tasks and emits one 'reminder' event per hit. */
  private fireReminders(nowIso: string): void {
    const due = this.db
      .select()
      .from(reminders)
      .where(and(isNull(reminders.firedAtUtc), lte(reminders.remindAtUtc, nowIso)))
      .all();
    if (!due.length) return;
    for (const r of due) {
      const t = this.db.select().from(tasks).where(eq(tasks.id, r.taskId)).get();
      this.db.update(reminders).set({ firedAtUtc: nowIso }).where(eq(reminders.id, r.id)).run();
      if (!t || t.isDeleted || t.status === 'done' || t.status === 'cancelled') continue;
      const dto: ReminderFiredEventDTO = {
        reminderId: r.id,
        taskId: r.taskId,
        taskContent: t.content,
        message: r.message,
        remindAtUtc: r.remindAtUtc,
      };
      this.emit('reminder', dto);
    }
  }

  /** Fires "N minutes before" reminders for upcoming events; one-shot per event. */
  private fireEventReminders(nowIso: string): void {
    const now = Date.parse(nowIso);
    const pending = this.db
      .select()
      .from(events)
      .where(isNull(events.reminderFiredAtUtc))
      .all()
      .filter((e) => e.reminderMinutesBefore != null);
    for (const e of pending) {
      const remindAt = Date.parse(e.startUtc) - (e.reminderMinutesBefore ?? 0) * 60_000;
      if (remindAt > now) continue; // not due yet
      if (Date.parse(e.endUtc) < now) {
        // Event already ended (e.g. created in the past) — arm it as fired without notifying.
        this.db.update(events).set({ reminderFiredAtUtc: nowIso }).where(eq(events.id, e.id)).run();
        continue;
      }
      this.db.update(events).set({ reminderFiredAtUtc: nowIso }).where(eq(events.id, e.id)).run();
      const dto: ReminderFiredEventDTO = {
        reminderId: `event:${e.id}`,
        taskId: e.id,
        taskContent: e.title,
        message: e.reminderMinutesBefore ? `Starts in ${e.reminderMinutesBefore} min` : 'Starting now',
        remindAtUtc: new Date(remindAt).toISOString(),
      };
      this.emit('reminder', dto);
    }
  }

  private tryGcal(): Gcal | null {
    const auth = getAuthedClient(this.db);
    return auth ? new Gcal(auth) : null;
  }

  private async freeBusy(
    gcal: Gcal,
    settings: ReturnType<typeof getSettings>,
    nowIso: string,
  ): Promise<{ startUtc: string; endUtc: string }[]> {
    const ids = settings.busyCalendarIds.filter((id) => id !== settings.appCalendarId);
    if (!ids.length) return [];
    const end = DateTime.fromISO(nowIso).plus({ days: settings.horizonDays + 1 }).toISO()!;
    try {
      const busy = await gcal.freeBusy(ids, nowIso, end);
      this.noteOffline(false);
      return busy.map((b) => ({ startUtc: b.start, endUtc: b.end }));
    } catch (err) {
      if (isOfflineError(err)) this.noteOffline(true);
      else logSync(this.db, 'google', 'error', err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  /**
   * Flip the offline flag, logging only on transition so we don't spam the sync
   * log every cycle while the connection is down. Offline is a paused state, not
   * an error — the poll loop keeps retrying and resumes automatically.
   */
  private noteOffline(on: boolean): void {
    if (on === this.offline) return;
    this.offline = on;
    logSync(
      this.db,
      'system',
      'info',
      on ? 'offline — Google sync paused, will resume when back online' : 'back online — Google sync resumed',
    );
  }

  forcePlan(trigger = 'manual'): Promise<RunSummary | null> {
    return this.runCycle(trigger, { forcePlan: true });
  }

  /** Google client + fresh busy time for a proposal build/apply. gcalClient is null when Google isn't connected. */
  async proposalContext(nowIso: string): Promise<{
    settings: ReturnType<typeof getSettings>;
    gcalClient: Gcal | null;
    externalBusy: { startUtc: string; endUtc: string }[];
  }> {
    const settings = getSettings(this.db);
    const gcalClient = this.tryGcal();
    const externalBusy = gcalClient ? await this.freeBusy(gcalClient, settings, nowIso) : [];
    return { settings, gcalClient, externalBusy };
  }

  /**
   * Run a proposal build/refine/apply exclusively — never interleaved with a poll
   * cycle or another proposal action. Returns `{ busy: true }` instead of blocking
   * if a cycle is already running; callers should surface that as a 409/retry.
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<{ busy: true } | { busy: false; result: T }> {
    if (this.running) return { busy: true };
    this.running = true;
    try {
      const result = await fn();
      return { busy: false, result };
    } finally {
      this.running = false;
      this.emit('update', this.getStatus());
    }
  }

  getStatus(): SyncStatusDTO {
    const settings = getSettings(this.db);
    const recent = this.db.select().from(syncLog).orderBy(desc(syncLog.id)).limit(30).all();
    const proposalId = getDraftProposalId(this.db);
    const state: SyncStatusDTO['schedule']['state'] = proposalId
      ? 'proposal_pending'
      : this.drift.created || this.drift.moved || this.drift.deleted
        ? 'drift'
        : 'in_sync';
    return {
      googleAuthed: !!getAuthedClient(this.db),
      appCalendarReady: !!settings.appCalendarId,
      offline: this.offline,
      running: this.running,
      lastCycleAt: this.lastCycleAt,
      lastGooglePullAt: this.lastGooglePullAtIso,
      lastError: this.lastError,
      lastRun: this.lastRun,
      recentLog: recent.reverse().map((r) => ({ ts: r.tsUtc, source: r.source, kind: r.kind, detail: r.detail })),
      schedule: {
        state,
        driftCreated: this.drift.created,
        driftMoved: this.drift.moved,
        driftDeleted: this.drift.deleted,
        proposalId,
        lastAppliedAt: lastAppliedAt(this.db),
      },
    };
  }
}
