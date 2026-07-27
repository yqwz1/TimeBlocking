import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { durableJobs } from '../db/schema.js';
import { nowUtcIso } from '../config.js';

export interface DurableJobContext {
  jobId: string;
  attempt: number;
  checkpoint: Record<string, unknown>;
  saveCheckpoint(checkpoint: Record<string, unknown>, progress?: number): void;
}

export type DurableJobHandler = (payload: Record<string, unknown>, context: DurableJobContext) => Promise<void> | void;

function jsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function enqueueDurableJob(
  db: DB,
  kind: string,
  payload: Record<string, unknown> = {},
  options: { dedupeKey?: string; maxAttempts?: number; availableAt?: string } = {},
): string {
  const now = nowUtcIso();
  if (options.dedupeKey) {
    const existing = db.select().from(durableJobs).where(eq(durableJobs.dedupeKey, options.dedupeKey)).get();
    if (existing && !['failed', 'completed'].includes(existing.status)) return existing.id;
    if (existing) {
      db.update(durableJobs)
        .set({
          kind,
          payload: JSON.stringify(payload),
          status: 'queued',
          attempts: 0,
          maxAttempts: options.maxAttempts ?? existing.maxAttempts,
          availableAtUtc: options.availableAt ?? now,
          leaseOwner: null,
          leaseExpiresAtUtc: null,
          checkpoint: '{}',
          progress: 0,
          lastError: null,
          updatedAtUtc: now,
          completedAtUtc: null,
        })
        .where(eq(durableJobs.id, existing.id))
        .run();
      return existing.id;
    }
  }
  const id = randomUUID();
  db.insert(durableJobs)
    .values({
      id,
      kind,
      payload: JSON.stringify(payload),
      status: 'queued',
      dedupeKey: options.dedupeKey ?? null,
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 3,
      availableAtUtc: options.availableAt ?? now,
      checkpoint: '{}',
      progress: 0,
      createdAtUtc: now,
      updatedAtUtc: now,
    })
    .run();
  return id;
}

export function recoverExpiredLeases(db: DB, at = nowUtcIso()): number {
  return db
    .update(durableJobs)
    .set({ status: 'queued', leaseOwner: null, leaseExpiresAtUtc: null, updatedAtUtc: at })
    .where(and(eq(durableJobs.status, 'running'), lte(durableJobs.leaseExpiresAtUtc, at)))
    .run().changes;
}

export class DurableJobRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly owner = `runner:${process.pid}:${randomUUID()}`;

  constructor(
    private readonly db: DB,
    private readonly handlers: Record<string, DurableJobHandler>,
  ) {}

  start(intervalMs = 2_000) {
    if (this.timer) return;
    recoverExpiredLeases(this.db);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      const now = nowUtcIso();
      recoverExpiredLeases(this.db, now);
      const candidate = this.db
        .select()
        .from(durableJobs)
        .where(and(inArray(durableJobs.status, ['queued', 'retry']), lte(durableJobs.availableAtUtc, now)))
        .orderBy(asc(durableJobs.availableAtUtc), asc(durableJobs.createdAtUtc))
        .get();
      if (!candidate) return false;

      const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
      const claimed = this.db
        .update(durableJobs)
        .set({
          status: 'running',
          leaseOwner: this.owner,
          leaseExpiresAtUtc: leaseExpiresAt,
          attempts: sql`${durableJobs.attempts} + 1`,
          updatedAtUtc: now,
        })
        .where(and(eq(durableJobs.id, candidate.id), inArray(durableJobs.status, ['queued', 'retry'])))
        .run();
      if (!claimed.changes) return false;

      const job = this.db.select().from(durableJobs).where(eq(durableJobs.id, candidate.id)).get()!;
      const handler = this.handlers[job.kind];
      if (!handler) {
        this.fail(job.id, job.attempts, job.maxAttempts, new Error(`No handler registered for durable job "${job.kind}"`));
        return true;
      }
      try {
        await handler(jsonObject(job.payload), {
          jobId: job.id,
          attempt: job.attempts,
          checkpoint: jsonObject(job.checkpoint),
          saveCheckpoint: (checkpoint, progress = job.progress) => {
            this.db
              .update(durableJobs)
              .set({
                checkpoint: JSON.stringify(checkpoint),
                progress: Math.max(0, Math.min(1, progress)),
                leaseExpiresAtUtc: new Date(Date.now() + 60_000).toISOString(),
                updatedAtUtc: nowUtcIso(),
              })
              .where(and(eq(durableJobs.id, job.id), eq(durableJobs.leaseOwner, this.owner)))
              .run();
          },
        });
        const completedAt = nowUtcIso();
        this.db
          .update(durableJobs)
          .set({
            status: 'completed',
            progress: 1,
            leaseOwner: null,
            leaseExpiresAtUtc: null,
            completedAtUtc: completedAt,
            updatedAtUtc: completedAt,
          })
          .where(and(eq(durableJobs.id, job.id), eq(durableJobs.leaseOwner, this.owner)))
          .run();
      } catch (error) {
        this.fail(job.id, job.attempts, job.maxAttempts, error);
      }
      return true;
    } finally {
      this.running = false;
    }
  }

  private fail(id: string, attempts: number, maxAttempts: number, error: unknown) {
    const now = nowUtcIso();
    const terminal = attempts >= maxAttempts;
    const delayMs = Math.min(15 * 60_000, 2 ** Math.max(0, attempts - 1) * 5_000);
    this.db
      .update(durableJobs)
      .set({
        status: terminal ? 'failed' : 'retry',
        availableAtUtc: terminal ? now : new Date(Date.now() + delayMs).toISOString(),
        leaseOwner: null,
        leaseExpiresAtUtc: null,
        lastError: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
        updatedAtUtc: now,
      })
      .where(eq(durableJobs.id, id))
      .run();
  }
}

export function listDurableJobs(db: DB, limit = 100) {
  return db.select().from(durableJobs).orderBy(sql`${durableJobs.createdAtUtc} DESC`).limit(limit).all().map((row) => ({
    ...row,
    payload: jsonObject(row.payload),
    checkpoint: jsonObject(row.checkpoint),
  }));
}
