import { createHash, randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { getDomain } from 'tldts';
import { and, desc, eq, gt, lt } from 'drizzle-orm';
import type { ActivityClassification, ActivityClassificationRule, ActivityStatus, BlockActivitySummary } from '@timeblock/shared';
import type { DB } from '../db/client.js';
import { activityClassificationRules, activitySources, blockActivitySummaries, blocks, computerActivityEvents, tasks } from '../db/schema.js';
import { nowUtcIso } from '../config.js';
import { ActivityWatchAdapter, ActivityWatchAdapterError, type ActivityWatchCanonicalEvent } from '../integrations/activitywatch/adapter.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_PARTITION_MS = 15 * 60 * 1000;
const SYNCERS = new WeakMap<DB, ActivitySyncService>();

type SyncCursor = { canonicalQueryAvailable?: boolean; state?: 'idle' | 'backfilling' | 'syncing' | 'retrying' | 'unsupported'; completedPartitions?: number; totalPartitions?: number; lastSuccessfulRange?: { fromUtc: string; toUtc: string }; warning?: string | null };
type SafeEvent = { fingerprint: string; startUtc: string; durationSec: number; application: string | null; domain: string | null; awCategory: string | null; classification: ActivityClassification; isIncognito: boolean };

function cursor(value: string | null): SyncCursor { try { return JSON.parse(value ?? '{}') as SyncCursor; } catch { return {}; } }
function safeApplication(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\\/].*[\\/]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return normalized || null;
}
function safeDomain(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return getDomain(value.trim(), { allowPrivateDomains: true }) ?? null; } catch { return null; }
}
function stringField(data: Record<string, unknown>, ...keys: string[]) { for (const key of keys) if (typeof data[key] === 'string') return data[key] as string; return null; }
function isPrivate(data: Record<string, unknown>): boolean { return data.incognito === true || data.private === true || data.sensitive === true; }
function ruleMatches(rule: typeof activityClassificationRules.$inferSelect, event: SafeEvent) {
  const value = rule.matchType === 'application' ? event.application : rule.matchType === 'domain' ? event.domain : event.awCategory;
  return value?.toLocaleLowerCase() === rule.matchValue.toLocaleLowerCase();
}

/** Implements the documented precedence while keeping raw ActivityWatch data transient. */
export function classifyEvent(event: SafeEvent, rules: Array<typeof activityClassificationRules.$inferSelect>, context?: { projectId: string | null; taskClass: string | null }): ActivityClassification {
  if (event.isIncognito) return 'sensitive';
  const scoped = rules.filter((rule) => (rule.scope === 'project' && context?.projectId && rule.scopeId === context.projectId) || (rule.scope === 'task_class' && context?.taskClass && rule.scopeId === context.taskClass));
  const global = rules.filter((rule) => rule.scope === 'global');
  return (scoped.find((rule) => ruleMatches(rule, event)) ?? global.find((rule) => ruleMatches(rule, event))?.classification ?? event.classification ?? 'unknown') as ActivityClassification;
}

function sanitize(event: ActivityWatchCanonicalEvent): SafeEvent | null {
  const start = DateTime.fromISO(event.timestamp, { zone: 'utc' });
  if (!start.isValid || !Number.isFinite(event.duration) || event.duration <= 0) return null;
  const privateActivity = isPrivate(event.data);
  const application = privateActivity ? null : safeApplication(stringField(event.data, 'app', 'application'));
  const domain = privateActivity ? null : safeDomain(stringField(event.data, 'url', 'domain'));
  const awCategory = privateActivity ? null : stringField(event.data, '$category', 'category')?.slice(0, 160) ?? null;
  const stable = JSON.stringify([start.toUTC().toISO(), Math.round(event.duration * 1000), application, domain, awCategory, privateActivity]);
  return { fingerprint: createHash('sha256').update(stable).digest('hex'), startUtc: start.toUTC().toISO()!, durationSec: event.duration, application, domain, awCategory, classification: privateActivity ? 'sensitive' : 'unknown', isIncognito: privateActivity };
}
function deduplicateByFingerprint(events: SafeEvent[]): SafeEvent[] {
  return [...new Map(events.map((event) => [event.fingerprint, event])).values()];
}

function overlapMinutes(event: SafeEvent, fromMs: number, toMs: number) { return Math.max(0, Math.min(Date.parse(event.startUtc) + event.durationSec * 1000, toMs) - Math.max(Date.parse(event.startUtc), fromMs)) / 60_000; }
function round(value: number) { return Math.round(value * 100) / 100; }
function average(values: number[]) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }

function rebuildBlockSummaries(db: DB, rangeStart: string, rangeEnd: string) {
  const rules = db.select().from(activityClassificationRules).all();
  const observed = db.select().from(computerActivityEvents).all().map((row) => ({ fingerprint: row.fingerprint, startUtc: row.startUtc, durationSec: row.durationSec, application: row.application, domain: row.registrableDomain, awCategory: row.activityWatchCategory, classification: row.category as ActivityClassification, isIncognito: row.isIncognito === 1 }));
  const rows = db.select({ block: blocks, task: tasks }).from(blocks).leftJoin(tasks, eq(blocks.taskId, tasks.id)).where(and(lt(blocks.startUtc, rangeEnd), gt(blocks.endUtc, rangeStart))).all();
  const now = nowUtcIso();
  for (const { block, task } of rows) {
    const from = Date.parse(block.startUtc); const to = Date.parse(block.endUtc); const planned = Math.max(1, (to - from) / 60_000);
    const slices = observed.map((event) => ({ event, minutes: overlapMinutes(event, from, to) })).filter((item) => item.minutes > 0).map((item) => ({ ...item, classification: classifyEvent(item.event, rules, { projectId: task?.projectId ?? null, taskClass: task?.difficulty ?? null }) }));
    const totals: Record<ActivityClassification, number> = { relevant: 0, supporting: 0, neutral: 0, distraction: 0, unknown: 0, sensitive: 0, ignore: 0 };
    for (const slice of slices) totals[slice.classification] += slice.minutes;
    const counted = totals.relevant + totals.supporting + totals.neutral + totals.distraction;
    const classificationCoverage = counted + totals.unknown > 0 ? counted / (counted + totals.unknown) : 0;
    const watcherCoverage = slices.length ? Math.min(1, slices.reduce((sum, slice) => sum + slice.minutes, 0) / planned) : 0;
    const sampleFactor = Math.min(1, (totals.relevant + totals.supporting + totals.neutral + totals.distraction + totals.unknown) / 90);
    const confidence = 100 * (0.45 * watcherCoverage + 0.35 * classificationCoverage + 0.2 * sampleFactor);
    const ordered = [...slices].sort((a, b) => a.event.startUtc.localeCompare(b.event.startUtc));
    let switches = 0; let longestRun = 0; let runStart: number | null = null; let runEnd = 0; let previousKey = '';
    for (const slice of ordered) {
      const start = Date.parse(slice.event.startUtc); const end = start + slice.event.durationSec * 1000; const aligned = slice.classification === 'relevant' || slice.classification === 'supporting';
      const key = `${slice.classification}:${slice.event.application ?? slice.event.domain ?? ''}`;
      if (previousKey && key !== previousKey && aligned) switches += 1;
      previousKey = key;
      if (aligned && runStart !== null && start - runEnd <= 30_000) runEnd = Math.max(runEnd, end);
      else { if (runStart !== null) longestRun = Math.max(longestRun, (runEnd - runStart) / 60_000); runStart = aligned ? start : null; runEnd = aligned ? end : 0; }
    }
    if (runStart !== null) longestRun = Math.max(longestRun, (runEnd - runStart) / 60_000);
    const active = totals.relevant + totals.supporting + totals.neutral + totals.distraction;
    const intent = active > 0 ? 100 * Math.max(0, Math.min(1, (totals.relevant + 0.5 * totals.supporting - 0.5 * totals.distraction) / active)) : null;
    const alignedRatio = active > 0 ? (totals.relevant + totals.supporting) / active : 0;
    const switchCalm = 100 / (1 + (totals.relevant + totals.supporting > 0 ? switches / ((totals.relevant + totals.supporting) / 60) : 0) / 4);
    const stability = 70 * alignedRatio + 30 * switchCalm / 100;
    const delivery = 100 * Math.min(1, (totals.relevant + totals.supporting) / planned);
    const firstAligned = ordered.find((slice) => slice.classification === 'relevant' || slice.classification === 'supporting');
    const latency = firstAligned ? Math.max(0, (Date.parse(firstAligned.event.startUtc) - from) / 60_000) : null;
    const startAdherence = latency === null ? 0 : 100 * Math.max(0, 1 - latency / 30);
    const quality = intent === null ? null : 0.45 * intent + 0.30 * stability + 0.25 * (0.8 * delivery + 0.2 * startAdherence);
    const values = { formulaVersion: 'activity-alignment-v1', actualStartUtc: firstAligned?.event.startUtc ?? null, actualEndUtc: ordered.at(-1)?.event.startUtc ?? null, startLatencyMin: latency === null ? null : round(latency), coverage: round(watcherCoverage * 100), relevantMin: round(totals.relevant), supportingMin: round(totals.supporting), distractionMin: round(totals.distraction), idleMin: 0, unknownMin: round(totals.unknown + totals.neutral), contextSwitches: switches, returnLatencyMin: null, longestFocusSessionMin: round(longestRun), continuity: round(alignedRatio), focusRatio: active > 0 ? round((totals.relevant + totals.supporting) / active) : null, focusQuality: quality === null ? null : round(quality), primaryCategory: null, overrunMin: 0, confidence: round(confidence), verificationState: confidence >= 70 && classificationCoverage >= 0.7 ? 'verified' : slices.length ? 'observed' : 'unobserved', updatedAtUtc: now };
    const existing = db.select().from(blockActivitySummaries).where(eq(blockActivitySummaries.blockId, block.id)).get();
    if (existing) db.update(blockActivitySummaries).set(values).where(eq(blockActivitySummaries.id, existing.id)).run();
    else db.insert(blockActivitySummaries).values({ id: randomUUID(), blockId: block.id, ...values }).run();
  }
}

export class ActivitySyncService {
  private running: Promise<ActivityStatus> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly db: DB, private readonly adapterFactory: (port: number) => ActivityWatchAdapter = (port) => new ActivityWatchAdapter(port)) {}
  start() { if (!this.timer) { this.timer = setInterval(() => void this.sync().catch(() => undefined), 60_000); this.timer.unref(); void this.sync().catch(() => undefined); } }
  async sync(): Promise<ActivityStatus> { if (!this.running) this.running = this.run().finally(() => { this.running = null; }); return this.running; }
  private async queryRange(adapter: ActivityWatchAdapter, from: DateTime, to: DateTime): Promise<ActivityWatchCanonicalEvent[]> {
    try { return await adapter.canonicalEvents(from.toUTC().toISO()!, to.toUTC().toISO()!); }
    catch (error) { if (error instanceof ActivityWatchAdapterError && error.code === 'response_too_large' && to.toMillis() - from.toMillis() > MIN_PARTITION_MS) { const half = DateTime.fromMillis(from.toMillis() + Math.floor((to.toMillis() - from.toMillis()) / 2), { zone: 'utc' }); return [...await this.queryRange(adapter, from, half), ...await this.queryRange(adapter, half, to)]; } throw error; }
  }
  private async run(): Promise<ActivityStatus> {
    const source = this.db.select().from(activitySources).orderBy(desc(activitySources.updatedAtUtc)).get();
    if (!source || source.mode === 'off') return this.status();
    const previous = cursor(source.cursor); const now = DateTime.utc();
    const backfill = !previous.lastSuccessfulRange;
    const ranges: Array<[DateTime, DateTime]> = backfill ? Array.from({ length: 30 }, (_, index) => { const end = now.startOf('day').minus({ days: index }); return [end.minus({ days: 1 }), end] as [DateTime, DateTime]; }) : [now.startOf('hour').minus({ hours: 1 }), now.startOf('hour').plus({ hours: 1 })].map((start) => [start, start.plus({ hours: 1 })] as [DateTime, DateTime]);
    this.db.update(activitySources).set({ cursor: JSON.stringify({ ...previous, state: backfill ? 'backfilling' : 'syncing', totalPartitions: ranges.length, completedPartitions: 0, warning: null }), backfillStatus: backfill ? 'running' : source.backfillStatus, updatedAtUtc: nowUtcIso() }).where(eq(activitySources.id, source.id)).run();
    const adapter = this.adapterFactory(source.port);
    try {
      for (let index = 0; index < ranges.length; index++) {
        const [from, to] = ranges[index]!; const records = deduplicateByFingerprint((await this.queryRange(adapter, from, to)).map(sanitize).filter((item): item is SafeEvent => !!item)); const partition = from.toUTC().toISO()!; const rules = this.db.select().from(activityClassificationRules).all(); const ingestedAt = nowUtcIso();
        this.db.transaction((tx) => { tx.delete(computerActivityEvents).where(and(eq(computerActivityEvents.sourceId, source.id), eq(computerActivityEvents.partitionStartUtc, partition))).run(); for (const event of records) { const classification = classifyEvent(event, rules); tx.insert(computerActivityEvents).values({ id: randomUUID(), sourceId: source.id, bucketId: 'canonical', sourceEventId: event.fingerprint, partitionStartUtc: partition, fingerprint: event.fingerprint, startUtc: event.startUtc, durationSec: event.durationSec, application: event.application, registrableDomain: event.domain, editorProjectKey: null, language: null, category: classification, activityWatchCategory: event.awCategory, isAfk: 0, isIncognito: event.isIncognito ? 1 : 0, keyboardCount: null, mouseCount: null, matchedRuleId: null, ingestedAtUtc: ingestedAt, updatedAtUtc: ingestedAt }).run(); } });
        this.db.update(activitySources).set({ cursor: JSON.stringify({ canonicalQueryAvailable: true, state: backfill ? 'backfilling' : 'syncing', completedPartitions: index + 1, totalPartitions: ranges.length, lastSuccessfulRange: { fromUtc: from.toUTC().toISO()!, toUtc: to.toUTC().toISO()! }, warning: null }), updatedAtUtc: nowUtcIso() }).where(eq(activitySources.id, source.id)).run();
      }
      rebuildBlockSummaries(this.db, ranges.at(-1)![0].toUTC().toISO()!, ranges[0]![1].toUTC().toISO()!);
      const final = ranges[0]!; this.db.update(activitySources).set({ health: 'healthy', lastSuccessfulSyncAtUtc: nowUtcIso(), backfillStatus: 'complete', cursor: JSON.stringify({ canonicalQueryAvailable: true, state: 'idle', completedPartitions: ranges.length, totalPartitions: ranges.length, lastSuccessfulRange: { fromUtc: final[0].toUTC().toISO()!, toUtc: final[1].toUTC().toISO()! }, warning: null }), lastErrorCode: null, updatedAtUtc: nowUtcIso() }).where(eq(activitySources.id, source.id)).run();
    } catch (error) { const unsupported = error instanceof ActivityWatchAdapterError && error.code === 'invalid_response'; this.db.update(activitySources).set({ health: error instanceof ActivityWatchAdapterError && error.code === 'unavailable' ? 'unavailable' : source.health, lastErrorCode: error instanceof ActivityWatchAdapterError ? `activitywatch_${error.code}` : 'activitywatch_unavailable', cursor: JSON.stringify({ ...previous, canonicalQueryAvailable: false, state: unsupported ? 'unsupported' : 'retrying', warning: unsupported ? 'This ActivityWatch server does not support canonical queries. Raw durations are intentionally not used.' : 'Local ActivityWatch sync will retry.' }), updatedAtUtc: nowUtcIso() }).where(eq(activitySources.id, source.id)).run(); throw error; }
    return this.status();
  }
  status(): ActivityStatus { const source = this.db.select().from(activitySources).orderBy(desc(activitySources.updatedAtUtc)).get(); const capabilities = (() => { try { return JSON.parse(source?.capabilities ?? '{}'); } catch { return {}; } })(); const state = cursor(source?.cursor ?? null); return { configured: !!source, mode: (source?.mode as ActivityStatus['mode']) ?? 'off', health: (source?.health as ActivityStatus['health']) ?? 'disconnected', port: source?.port ?? null, version: source?.version ?? null, capabilities: { window: capabilities.window === true, afk: capabilities.afk === true, browser: capabilities.browser === true, editor: capabilities.editor === true, input: capabilities.input === true }, requiredSourcesAvailable: capabilities.window === true && capabilities.afk === true, lastSuccessfulSyncAt: source?.lastSuccessfulSyncAtUtc ?? null, lastErrorCode: source?.lastErrorCode ?? null, canonicalQueryAvailable: state.canonicalQueryAvailable ?? false, watcherDetails: { windowBucket: capabilities.window ? 'available' : null, afkBucket: capabilities.afk ? 'available' : null, browserBucket: capabilities.browser ? 'available' : null }, sync: { state: state.state ?? 'idle', completedPartitions: state.completedPartitions ?? 0, totalPartitions: state.totalPartitions ?? 0, lastSuccessfulRange: state.lastSuccessfulRange ?? null, warning: state.warning ?? null } }; }
}

export function getActivitySyncService(db: DB) { let service = SYNCERS.get(db); if (!service) { service = new ActivitySyncService(db); SYNCERS.set(db, service); } return service; }
