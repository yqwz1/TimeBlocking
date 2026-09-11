import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, lt } from 'drizzle-orm';
import type { ActivityCenterOverview, ActivityClassificationRule, ActivityTimelineSegment, FocusWorkSessionInput } from '@timeblock/shared';
import { ActivityCenterOverviewSchema, ActivityClassificationRuleSchema, ActivityTimelineSegmentSchema } from '@timeblock/shared';
import type { DB } from '../db/client.js';
import { activityClassificationRules, activityExperiments, blockActivitySummaries, blocks, computerActivityEvents, focusWorkSessions } from '../db/schema.js';
import { nowUtcIso } from '../config.js';

function minutes(startUtc: string, durationSec: number, fromUtc: string, toUtc: string) { return Math.max(0, Math.min(Date.parse(startUtc) + durationSec * 1000, Date.parse(toUtc)) - Math.max(Date.parse(startUtc), Date.parse(fromUtc))) / 60_000; }
function rounded(value: number) { return Math.round(value * 100) / 100; }
function activeExperiment(db: DB) { const row = db.select().from(activityExperiments).where(eq(activityExperiments.status, 'active')).orderBy(desc(activityExperiments.createdAtUtc)).get(); return row ? { id: row.id, kind: row.kind, title: row.title, status: 'active' as const, startedAtUtc: row.startedAtUtc, endsAtUtc: row.endsAtUtc } : null; }

/** Compact, evidence-linked center data. Scores only use explicit work contexts. */
export function getActivityCenterOverview(db: DB, fromUtc: string, toUtc: string): ActivityCenterOverview {
  const summaries = db.select({ summary: blockActivitySummaries, block: blocks }).from(blockActivitySummaries).innerJoin(blocks, eq(blockActivitySummaries.blockId, blocks.id)).where(and(lt(blocks.startUtc, toUtc), gt(blocks.endUtc, fromUtc))).all();
  const planned = summaries.reduce((sum, row) => sum + Math.max(0, Math.min(Date.parse(row.block.endUtc), Date.parse(toUtc)) - Math.max(Date.parse(row.block.startUtc), Date.parse(fromUtc))) / 60_000, 0);
  const total = (key: 'relevantMin' | 'supportingMin' | 'distractionMin' | 'unknownMin') => summaries.reduce((sum, row) => sum + row.summary[key], 0);
  const relevant = total('relevantMin'); const supporting = total('supportingMin'); const distraction = total('distractionMin'); const unknown = total('unknownMin'); const observed = relevant + supporting + distraction + unknown;
  const intent = observed - unknown > 0 ? Math.max(0, Math.min(100, 100 * (relevant + 0.5 * supporting - 0.5 * distraction) / (observed - unknown))) : null;
  const focus = summaries.length ? summaries.reduce((sum, row) => sum + (row.summary.focusQuality ?? 0), 0) / summaries.length : null;
  const planDelivery = planned > 0 ? Math.min(100, 100 * (relevant + supporting) / planned) : null;
  const startAdherence = summaries.length ? summaries.reduce((sum, row) => sum + (row.summary.startLatencyMin === null ? 0 : Math.max(0, 100 * (1 - row.summary.startLatencyMin / 30))), 0) / summaries.length : null;
  const followThrough = planDelivery === null || startAdherence === null ? null : 0.8 * planDelivery + 0.2 * startAdherence;
  const coverage = summaries.length ? summaries.reduce((sum, row) => sum + row.summary.coverage, 0) / summaries.length : 0;
  const classificationCoverage = observed ? 100 * Math.max(0, 1 - unknown / observed) : 0;
  const sample = Math.min(100, observed / 90 * 100); const confidence = 0.45 * coverage + 0.35 * classificationCoverage + 0.2 * sample;
  const gateReasons: string[] = [];
  if (observed < 90) gateReasons.push('Need 90 active work-context minutes before a headline score.');
  if (summaries.length < 2) gateReasons.push('Need two work contexts before a headline score.');
  if (coverage < 75) gateReasons.push('Watcher coverage is below 75%.');
  if (classificationCoverage < 70) gateReasons.push('Classify more observed time before scoring it.');
  const score = gateReasons.length || intent === null || focus === null || followThrough === null ? null : Math.max(0, Math.min(100, 0.45 * intent + 0.30 * focus + 0.25 * followThrough));
  const breakdown = new Map<string, { minutes: number; classification: typeof computerActivityEvents.$inferSelect.category }>();
  for (const event of db.select().from(computerActivityEvents).all()) { const value = minutes(event.startUtc, event.durationSec, fromUtc, toUtc); if (!value || event.category === 'sensitive' || event.category === 'ignore') continue; const label = event.registrableDomain ?? event.application ?? event.activityWatchCategory ?? 'Unknown activity'; const current = breakdown.get(label) ?? { minutes: 0, classification: event.category }; current.minutes += value; breakdown.set(label, current); }
  const insights: ActivityCenterOverview['insights'] = [];
  const delayed = summaries.filter((row) => (row.summary.startLatencyMin ?? 0) >= 10);
  if (delayed.length) insights.push({ id: 'delayed-starts', title: 'Some planned work started late', detail: `${delayed.length} of ${summaries.length} observed work contexts started at least 10 minutes after their planned time.`, sample: `${summaries.length} contexts`, confidence: rounded(confidence), limitations: 'Association only; calendar timing does not reveal why a start was delayed.' });
  if (distraction >= 10) insights.push({ id: 'distraction', title: 'Friction showed up during planned work', detail: `${Math.round(distraction)} minutes were classified as distraction in work contexts.`, sample: `${Math.round(observed)} observed minutes`, confidence: rounded(confidence), limitations: 'Classifications are user-controlled and unknown time is not a penalty.' });
  return ActivityCenterOverviewSchema.parse({ fromUtc, toUtc, score: score === null ? null : rounded(score), gateReasons, confidence: rounded(confidence), confidenceInputs: { watcherCoverage: rounded(coverage), classificationCoverage: rounded(classificationCoverage), sampleFactor: rounded(sample) }, components: { intentAlignment: intent === null ? null : rounded(intent), focusStability: focus === null ? null : rounded(focus), followThrough: followThrough === null ? null : rounded(followThrough), planDelivery: planDelivery === null ? null : rounded(planDelivery), startAdherence: startAdherence === null ? null : rounded(startAdherence) }, totals: { alignedMinutes: rounded(relevant + supporting), plannedMinutes: rounded(planned), observedMinutes: rounded(observed), relevantMinutes: rounded(relevant), supportingMinutes: rounded(supporting), neutralMinutes: 0, distractionMinutes: rounded(distraction), unknownMinutes: rounded(unknown) }, topBreakdowns: [...breakdown.entries()].map(([label, item]) => ({ label, minutes: rounded(item.minutes), classification: item.classification })).sort((a, b) => b.minutes - a.minutes).slice(0, 8), insights, activeExperiment: activeExperiment(db) });
}

export function getActivityTimeline(db: DB, fromUtc: string, toUtc: string): ActivityTimelineSegment[] {
  return db.select().from(computerActivityEvents).all().flatMap((event) => { const start = Date.parse(event.startUtc); const end = start + event.durationSec * 1000; if (end <= Date.parse(fromUtc) || start >= Date.parse(toUtc) || event.category === 'sensitive') return []; return [ActivityTimelineSegmentSchema.parse({ startUtc: new Date(Math.max(start, Date.parse(fromUtc))).toISOString(), endUtc: new Date(Math.min(end, Date.parse(toUtc))).toISOString(), classification: event.category, application: event.application, domain: event.registrableDomain, category: event.activityWatchCategory })]; });
}

export function listClassificationRules(db: DB): ActivityClassificationRule[] { return db.select().from(activityClassificationRules).all().map((row) => ActivityClassificationRuleSchema.parse({ id: row.id, scope: row.scope, scopeId: row.scopeId, matchType: row.matchType, matchValue: row.matchValue, classification: row.classification, createdAtUtc: row.createdAtUtc, updatedAtUtc: row.updatedAtUtc })); }
export function createClassificationRule(db: DB, input: Omit<ActivityClassificationRule, 'id' | 'createdAtUtc' | 'updatedAtUtc'>): ActivityClassificationRule { const now = nowUtcIso(); const row = { id: randomUUID(), ...input, createdAtUtc: now, updatedAtUtc: now }; db.insert(activityClassificationRules).values(row).run(); return ActivityClassificationRuleSchema.parse(row); }
export function deleteClassificationRule(db: DB, id: string) { return db.delete(activityClassificationRules).where(eq(activityClassificationRules.id, id)).run().changes > 0; }
export function recordFocusWorkSession(db: DB, input: FocusWorkSessionInput) { db.insert(focusWorkSessions).values({ ...input, createdAtUtc: nowUtcIso() }).onConflictDoNothing().run(); }
export function createActivityExperiment(db: DB, input: { kind: string; title: string; detail: string; endsAtUtc: string }) { const now = nowUtcIso(); db.update(activityExperiments).set({ status: 'dismissed', updatedAtUtc: now }).where(eq(activityExperiments.status, 'active')).run(); const row = { id: randomUUID(), kind: input.kind, title: input.title, detail: input.detail, status: 'active', baselineJson: '{}', resultJson: null, startedAtUtc: now, endsAtUtc: input.endsAtUtc, createdAtUtc: now, updatedAtUtc: now }; db.insert(activityExperiments).values(row).run(); return row; }
