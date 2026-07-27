import { desc, eq } from 'drizzle-orm';
import type { GraphIndexFreshnessDTO, GraphJobDTO, GraphJobStatus } from '@timeblock/shared';
import { graphJobs, nodeMetrics, notes } from '../../db/schema.js';
import type { DB } from '../../db/client.js';

export type GraphJobName = 'embeddings' | 'concepts' | 'graph' | 'community-labels';

const KNOWN_JOBS: GraphJobName[] = ['embeddings', 'concepts', 'graph', 'community-labels'];

function writeJob(
  db: DB,
  name: GraphJobName,
  patch: Partial<{
    status: GraphJobStatus;
    progress: number;
    cursor: string | null;
    queuedAtUtc: string | null;
    startedAtUtc: string | null;
    completedAtUtc: string | null;
    error: string | null;
  }>,
): void {
  db.insert(graphJobs).values({ name, ...patch }).onConflictDoUpdate({ target: graphJobs.name, set: patch }).run();
}

export function queueGraphJob(db: DB, name: GraphJobName): void {
  writeJob(db, name, { status: 'queued', progress: 0, queuedAtUtc: new Date().toISOString(), error: null });
}

export function startGraphJob(db: DB, name: GraphJobName, cursor: string | null = null): void {
  writeJob(db, name, { status: 'running', progress: 0, cursor, startedAtUtc: new Date().toISOString(), error: null });
}

export function progressGraphJob(db: DB, name: GraphJobName, progress: number, cursor: string | null = null): void {
  writeJob(db, name, { progress: Math.max(0, Math.min(1, progress)), cursor });
}

export function completeGraphJob(db: DB, name: GraphJobName): void {
  writeJob(db, name, { status: 'completed', progress: 1, cursor: null, completedAtUtc: new Date().toISOString(), error: null });
}

export function failGraphJob(db: DB, name: GraphJobName, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  writeJob(db, name, { status: 'failed', error: message.slice(0, 500) });
}

/** A process crash can leave a durable `running` row. Stale hashes make each queued job safe to resume. */
export function recoverInterruptedGraphJobs(db: DB): GraphJobName[] {
  const interrupted = db
    .select({ name: graphJobs.name, status: graphJobs.status })
    .from(graphJobs)
    .all()
    .filter((row) => row.status === 'running' || row.status === 'queued')
    .map((row) => row.name as GraphJobName)
    .filter((name) => KNOWN_JOBS.includes(name));
  for (const name of interrupted) queueGraphJob(db, name);
  return interrupted;
}

function toDTO(row: typeof graphJobs.$inferSelect): GraphJobDTO {
  return {
    name: row.name,
    status: row.status as GraphJobStatus,
    progress: row.progress,
    cursor: row.cursor,
    queuedAt: row.queuedAtUtc,
    startedAt: row.startedAtUtc,
    completedAt: row.completedAtUtc,
    error: row.error,
  };
}

export function graphIndexFreshness(db: DB): GraphIndexFreshnessDTO {
  const rows = db.select().from(graphJobs).all();
  const jobs = rows.map(toDTO);
  const graphJob = rows.find((row) => row.name === 'graph');
  const metricAt = db.select({ at: nodeMetrics.updatedAtUtc }).from(nodeMetrics).orderBy(desc(nodeMetrics.updatedAtUtc)).limit(1).get()?.at ?? null;
  const indexedAt = graphJob?.completedAtUtc ?? metricAt;
  const newestNoteAt = db.select({ at: notes.updatedAtUtc }).from(notes).orderBy(desc(notes.updatedAtUtc)).limit(1).get()?.at ?? null;
  const active = rows.some((row) => row.status === 'queued' || row.status === 'running');
  const failed = rows.some((row) => row.status === 'failed');
  const stale = !!newestNoteAt && (!indexedAt || newestNoteAt > indexedAt);
  return {
    status: failed ? 'error' : active ? 'updating' : stale ? 'stale' : 'fresh',
    indexedAt,
    staleSince: stale ? newestNoteAt : null,
    jobs,
  };
}

export function clearGraphJobFailure(db: DB, name: GraphJobName): void {
  const row = db.select().from(graphJobs).where(eq(graphJobs.name, name)).get();
  if (row?.status === 'failed') writeJob(db, name, { status: 'idle', error: null });
}
