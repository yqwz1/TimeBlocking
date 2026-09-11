import { createHash, randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { ActivityAiAggregatePayload, ActivityAiAnalysis, ActivityAiAnalyzeInput, ActivityAiPreview, ActivityAiPreviewInput, ActivityAnalytics, ActivityCapabilities, ActivityConnectInput, ActivityCorrectionInput, ActivityPersonalAnalytics, ActivityRecommendation, ActivityStatus, BlockActivitySummary } from '@timeblock/shared';
import { ActivityAiAggregatePayloadSchema, ActivityAiAnalysisSchema, ActivityAiPreviewSchema, ActivityAnalyticsSchema, ActivityPersonalAnalyticsSchema, ActivityStatusSchema, BlockActivitySummarySchema } from '@timeblock/shared';
import { and, desc, eq, gt, lt } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { activityAiPreviews, activityRecommendations, activitySources, blockActivitySummaries, blocks, computerActivityEvents, events, tasks } from '../db/schema.js';
import { nowUtcIso } from '../config.js';
import { ModelGateway } from '../assistant/modelGateway.js';
import { ActivityWatchAdapter, ActivityWatchAdapterError } from '../integrations/activitywatch/adapter.js';
import { getSettings } from '../settings.js';
import { getActivitySyncService } from './sync.js';

const EMPTY_CAPABILITIES: ActivityCapabilities = { window: false, afk: false, browser: false, editor: false, input: false };

function parseCapabilities(value: string): ActivityCapabilities {
  try {
    const parsed = JSON.parse(value);
    return {
      window: parsed?.window === true,
      afk: parsed?.afk === true,
      browser: parsed?.browser === true,
      editor: parsed?.editor === true,
      input: parsed?.input === true,
    };
  } catch {
    return EMPTY_CAPABILITIES;
  }
}

function toStatus(row: typeof activitySources.$inferSelect | undefined): ActivityStatus {
  if (!row) {
    return {
      configured: false,
      mode: 'off',
      health: 'disconnected',
      port: null,
      version: null,
      capabilities: EMPTY_CAPABILITIES,
      requiredSourcesAvailable: false,
      lastSuccessfulSyncAt: null,
      lastErrorCode: null,
      canonicalQueryAvailable: false,
      watcherDetails: { windowBucket: null, afkBucket: null, browserBucket: null },
      sync: { state: 'idle', completedPartitions: 0, totalPartitions: 0, lastSuccessfulRange: null, warning: null },
    };
  }
  const capabilities = parseCapabilities(row.capabilities);
  return ActivityStatusSchema.parse({
    configured: true,
    mode: row.mode,
    health: row.health,
    port: row.port,
    version: row.version,
    capabilities,
    requiredSourcesAvailable: capabilities.window && capabilities.afk,
    lastSuccessfulSyncAt: row.lastSuccessfulSyncAtUtc,
    lastErrorCode: row.lastErrorCode,
    canonicalQueryAvailable: false,
    watcherDetails: { windowBucket: capabilities.window ? 'available' : null, afkBucket: capabilities.afk ? 'available' : null, browserBucket: capabilities.browser ? 'available' : null },
    sync: { state: 'idle', completedPartitions: 0, totalPartitions: 0, lastSuccessfulRange: null, warning: null },
  });
}

function errorCode(error: unknown): string {
  return error instanceof ActivityWatchAdapterError ? `activitywatch_${error.code}` : 'activitywatch_unavailable';
}

export function getActivityStatus(db: DB): ActivityStatus {
  return getActivitySyncService(db).status();
}

export async function connectActivityWatch(
  db: DB,
  input: ActivityConnectInput,
  createAdapter: (port: number) => ActivityWatchAdapter = (port) => new ActivityWatchAdapter(port),
): Promise<ActivityStatus> {
  const now = nowUtcIso();
  try {
    const probe = await createAdapter(input.port).probe();
    const existing = db.select().from(activitySources).where(eq(activitySources.sourceKey, probe.sourceKey)).get();
    const values = {
      port: input.port,
      version: probe.version,
      capabilities: JSON.stringify(probe.capabilities),
      mode: input.mode,
      health: 'healthy',
      lastAttemptAtUtc: now,
      lastErrorCode: null,
      updatedAtUtc: now,
    } as const;
    if (existing) {
      db.update(activitySources).set(values).where(eq(activitySources.id, existing.id)).run();
    } else {
      db.insert(activitySources).values({ id: crypto.randomUUID(), sourceKey: probe.sourceKey, createdAtUtc: now, lastSuccessfulSyncAtUtc: null, backfillStatus: 'not_started', cursor: null, ...values }).run();
    }
    return getActivityStatus(db);
  } catch (error) {
    const current = db.select().from(activitySources).orderBy(desc(activitySources.updatedAtUtc)).get();
    if (current?.port === input.port) {
      db.update(activitySources)
        .set({ health: 'unavailable', lastAttemptAtUtc: now, lastErrorCode: errorCode(error), updatedAtUtc: now })
        .where(eq(activitySources.id, current.id))
        .run();
    }
    throw error;
  }
}

/** The first sync action deliberately performs a fresh local capability check only. */
export async function refreshActivityWatchHealth(
  db: DB,
  createAdapter: (port: number) => ActivityWatchAdapter = (port) => new ActivityWatchAdapter(port),
): Promise<ActivityStatus> {
  const current = db.select().from(activitySources).orderBy(desc(activitySources.updatedAtUtc)).get();
  if (!current) throw new Error('ActivityWatch is not configured.');
  if (current.mode === 'off') throw new Error('Activity collection is off. Choose shadow mode before syncing.');
  return connectActivityWatch(db, { port: current.port, mode: current.mode as ActivityConnectInput['mode'] }, createAdapter);
}

function parseCorrection(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function toSummary(row: typeof blockActivitySummaries.$inferSelect): BlockActivitySummary {
  return BlockActivitySummarySchema.parse({
    blockId: row.blockId,
    formulaVersion: row.formulaVersion,
    actualStartUtc: row.actualStartUtc,
    actualEndUtc: row.actualEndUtc,
    startLatencyMin: row.startLatencyMin,
    coverage: row.coverage,
    relevantMin: row.relevantMin,
    supportingMin: row.supportingMin,
    distractionMin: row.distractionMin,
    idleMin: row.idleMin,
    unknownMin: row.unknownMin,
    contextSwitches: row.contextSwitches,
    returnLatencyMin: row.returnLatencyMin,
    longestFocusSessionMin: row.longestFocusSessionMin,
    continuity: row.continuity,
    focusRatio: row.focusRatio,
    focusQuality: row.focusQuality,
    primaryCategory: row.primaryCategory,
    overrunMin: row.overrunMin,
    confidence: row.confidence,
    verificationState: row.verificationState,
    correction: parseCorrection(row.correctionJson),
    updatedAtUtc: row.updatedAtUtc,
  });
}

export function getBlockActivitySummary(db: DB, blockId: string): BlockActivitySummary | null {
  const row = db.select().from(blockActivitySummaries).where(eq(blockActivitySummaries.blockId, blockId)).get();
  return row ? toSummary(row) : null;
}

export function correctBlockActivitySummary(db: DB, blockId: string, correction: ActivityCorrectionInput): BlockActivitySummary | null {
  const row = db.select().from(blockActivitySummaries).where(eq(blockActivitySummaries.blockId, blockId)).get();
  if (!row) return null;
  const now = nowUtcIso();
  const nextCorrection = { ...(parseCorrection(row.correctionJson) ?? {}), ...correction, correctedAtUtc: now };
  db.update(blockActivitySummaries)
    .set({
      actualStartUtc: correction.actualStartUtc === undefined ? row.actualStartUtc : correction.actualStartUtc,
      actualEndUtc: correction.actualEndUtc === undefined ? row.actualEndUtc : correction.actualEndUtc,
      primaryCategory: correction.primaryCategory === undefined ? row.primaryCategory : correction.primaryCategory,
      correctionJson: JSON.stringify(nextCorrection),
      correctedAtUtc: now,
      verificationState: 'corrected',
      updatedAtUtc: now,
    })
    .where(eq(blockActivitySummaries.id, row.id))
    .run();
  return getBlockActivitySummary(db, blockId);
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((total, value) => total + value, 0) / present.length : null;
}

/** Aggregate only pre-sanitized summaries; detailed events are intentionally never read here. */
export function getActivityAnalytics(db: DB, fromUtc: string, toUtc: string): ActivityAnalytics {
  const rows = db
    .select({ summary: blockActivitySummaries })
    .from(blockActivitySummaries)
    .innerJoin(blocks, eq(blockActivitySummaries.blockId, blocks.id))
    .where(and(lt(blocks.startUtc, toUtc), gt(blocks.endUtc, fromUtc)))
    .all()
    .map(({ summary }) => toSummary(summary));
  const total = (field: keyof Pick<BlockActivitySummary, 'overrunMin' | 'relevantMin' | 'supportingMin' | 'distractionMin' | 'idleMin' | 'unknownMin' | 'longestFocusSessionMin'>) => rows.reduce((sum, row) => sum + row[field], 0);
  const activeMinutes = rows.reduce((sum, row) => sum + row.relevantMin + row.supportingMin + row.distractionMin + row.unknownMin, 0);
  return ActivityAnalyticsSchema.parse({
    fromUtc,
    toUtc,
    blockCount: rows.length,
    verifiedBlockCount: rows.filter((row) => row.verificationState === 'verified').length,
    startLatencyMin: average(rows.map((row) => row.startLatencyMin)),
    overrunMin: total('overrunMin'),
    relevantMin: total('relevantMin'),
    supportingMin: total('supportingMin'),
    distractionMin: total('distractionMin'),
    idleMin: total('idleMin'),
    unknownMin: total('unknownMin'),
    contextSwitchRate: activeMinutes > 0 ? rows.reduce((sum, row) => sum + row.contextSwitches, 0) / (activeMinutes / 60) : null,
    returnLatencyMin: average(rows.map((row) => row.returnLatencyMin)),
    longestFocusSessionMin: rows.length ? Math.max(...rows.map((row) => row.longestFocusSessionMin)) : 0,
    continuity: average(rows.map((row) => row.continuity)),
    focusQuality: average(rows.map((row) => row.focusQuality)),
    confidence: average(rows.map((row) => row.confidence)),
  });
}

type PersonalAnalyticsRow = {
  summary: BlockActivitySummary;
  startUtc: string;
  endUtc: string;
  taskId: string | null;
  projectName: string | null;
  taskClass: string;
  taskEstimateMin: number | null;
};

function boundedRatio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function keyLabel(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}

function personalAnalyticsRows(db: DB, fromUtc: string, toUtc: string): PersonalAnalyticsRow[] {
  return db
    .select({ summary: blockActivitySummaries, block: blocks, task: tasks })
    .from(blockActivitySummaries)
    .innerJoin(blocks, eq(blockActivitySummaries.blockId, blocks.id))
    .leftJoin(tasks, eq(blocks.taskId, tasks.id))
    .where(and(lt(blocks.startUtc, toUtc), gt(blocks.endUtc, fromUtc)))
    .all()
    .map(({ summary, block, task }) => ({
      summary: toSummary(summary),
      startUtc: block.startUtc,
      endUtc: block.endUtc,
      taskId: block.taskId,
      projectName: task?.projectName ?? null,
      taskClass: keyLabel(task?.difficulty, 'Unclassified'),
      taskEstimateMin: task?.durationMin ?? null,
    }));
}

/**
 * Read-only Phase 3 reporting. Every metric is derived from scheduled blocks and
 * sanitized block summaries; this boundary prevents raw ActivityWatch detail from
 * entering analytics, recommendations, or scheduler input.
 */
export function getActivityPersonalAnalytics(db: DB, fromUtc: string, toUtc: string): ActivityPersonalAnalytics {
  const timezone = getSettings(db).timezone;
  const rows = personalAnalyticsRows(db, fromUtc, toUtc);
  const observedMinutes = (row: PersonalAnalyticsRow) => row.summary.relevantMin + row.summary.supportingMin;
  const calendarMinutes = (row: PersonalAnalyticsRow) => Math.max(0, (Date.parse(row.endUtc) - Date.parse(row.startUtc)) / 60_000);
  const observedRows = rows.filter((row) => observedMinutes(row) > 0 || row.summary.coverage > 0);
  const verifiedRows = rows.filter((row) => row.summary.verificationState === 'verified');
  const distinctDays = new Set(rows.map((row) => DateTime.fromISO(row.startUtc, { zone: 'utc' }).setZone(timezone).toISODate())).size;
  const averageFor = <T>(items: T[], value: (item: T) => number | null): number | null => average(items.map(value));

  const taskEstimates = new Map<string, number>();
  let unlinkedEstimateMin = 0;
  for (const row of rows) {
    if (row.taskId && row.taskEstimateMin !== null) taskEstimates.set(row.taskId, row.taskEstimateMin);
    else if (!row.taskId) unlinkedEstimateMin += calendarMinutes(row);
  }
  const taskEstimateMin = [...taskEstimates.values()].reduce((sum, value) => sum + value, unlinkedEstimateMin);
  const totalCalendarMin = rows.reduce((sum, row) => sum + calendarMinutes(row), 0);
  const totalObservedMin = rows.reduce((sum, row) => sum + observedMinutes(row), 0);

  type HeatmapAccumulator = { observedMin: number; quality: number[]; confidence: number[]; sampleCount: number };
  const heatmap = new Map<string, HeatmapAccumulator>();
  const addHeatmap = (series: string, row: PersonalAnalyticsRow) => {
    const local = DateTime.fromISO(row.startUtc, { zone: 'utc' }).setZone(timezone);
    const key = `${series}\u0000${local.weekday}\u0000${local.hour}`;
    const entry = heatmap.get(key) ?? { observedMin: 0, quality: [], confidence: [], sampleCount: 0 };
    entry.observedMin += observedMinutes(row);
    if (row.summary.focusQuality !== null) entry.quality.push(row.summary.focusQuality);
    if (row.summary.confidence !== null) entry.confidence.push(row.summary.confidence);
    entry.sampleCount += 1;
    heatmap.set(key, entry);
  };
  for (const row of rows) {
    addHeatmap('overall', row);
    addHeatmap(`project:${keyLabel(row.projectName, 'No project')}`, row);
    addHeatmap(`task:${row.taskClass}`, row);
  }
  const cellsFor = (series: string) => [...heatmap.entries()]
    .filter(([key]) => key.startsWith(`${series}\u0000`))
    .map(([key, value]) => {
      const [, weekday, hour] = key.split('\u0000');
      return { weekday: Number(weekday), hour: Number(hour), observedMin: value.observedMin, focusQuality: average(value.quality), sampleCount: value.sampleCount, confidence: average(value.confidence) };
    })
    .sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
  const seriesFor = (prefix: 'project' | 'task') => [...new Set([...heatmap.keys()]
    .filter((key) => key.startsWith(`${prefix}:`))
    .map((key) => key.split('\u0000')[0]!))]
    .sort()
    .map((key) => ({ key, label: key.slice(prefix.length + 1), cells: cellsFor(key) }));

  const capacityByHour = new Map<number, PersonalAnalyticsRow[]>();
  for (const row of rows) {
    const hour = DateTime.fromISO(row.startUtc, { zone: 'utc' }).setZone(timezone).hour;
    const group = capacityByHour.get(hour) ?? [];
    group.push(row);
    capacityByHour.set(hour, group);
  }
  const capacityCurve = [...capacityByHour.entries()].map(([hour, group]) => {
    const activeMinutes = group.reduce((sum, row) => sum + observedMinutes(row) + row.summary.distractionMin + row.summary.unknownMin, 0);
    return {
      hour,
      observedMin: group.reduce((sum, row) => sum + observedMinutes(row), 0),
      focusQuality: averageFor(group, (row) => row.summary.focusQuality),
      contextSwitchRate: activeMinutes > 0 ? group.reduce((sum, row) => sum + row.summary.contextSwitches, 0) / (activeMinutes / 60) : null,
      sampleCount: group.length,
    };
  }).sort((a, b) => a.hour - b.hour);

  const bands = [
    { label: 'Under 30m', minMinutes: 0, maxMinutes: 29.999 },
    { label: '30–59m', minMinutes: 30, maxMinutes: 59.999 },
    { label: '60–89m', minMinutes: 60, maxMinutes: 89.999 },
    { label: '90m+', minMinutes: 90, maxMinutes: null },
  ];
  const sessionLengthBands = bands.map((band) => {
    const group = rows.filter((row) => row.summary.longestFocusSessionMin >= band.minMinutes && (band.maxMinutes === null || row.summary.longestFocusSessionMin <= band.maxMinutes));
    return { ...band, maxMinutes: band.maxMinutes === null ? null : Math.floor(band.maxMinutes), sampleCount: group.length, focusQuality: averageFor(group, (row) => row.summary.focusQuality), continuity: averageFor(group, (row) => row.summary.continuity) };
  });

  const categoryMap = new Map<string, PersonalAnalyticsRow[]>();
  for (const row of rows) {
    const category = keyLabel(row.summary.primaryCategory, 'Unknown');
    const group = categoryMap.get(category) ?? [];
    group.push(row);
    categoryMap.set(category, group);
  }
  const categories = [...categoryMap.entries()].map(([category, group]) => ({
    category,
    blockCount: group.length,
    observedMin: group.reduce((sum, row) => sum + observedMinutes(row), 0),
    distractionMin: group.reduce((sum, row) => sum + row.summary.distractionMin, 0),
    contextSwitches: group.reduce((sum, row) => sum + row.summary.contextSwitches, 0),
  })).sort((a, b) => b.observedMin - a.observedMin);

  const taskClassMap = new Map<string, PersonalAnalyticsRow[]>();
  const projectMap = new Map<string, PersonalAnalyticsRow[]>();
  for (const row of rows) {
    const taskClassRows = taskClassMap.get(row.taskClass) ?? [];
    taskClassRows.push(row);
    taskClassMap.set(row.taskClass, taskClassRows);
    const project = keyLabel(row.projectName, 'No project');
    const projectRows = projectMap.get(project) ?? [];
    projectRows.push(row);
    projectMap.set(project, projectRows);
  }

  const transitionMap = new Map<string, number>();
  const chronological = [...rows].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  for (let index = 1; index < chronological.length; index++) {
    const from = keyLabel(chronological[index - 1]!.summary.primaryCategory, 'Unknown');
    const to = keyLabel(chronological[index]!.summary.primaryCategory, 'Unknown');
    if (from !== to) transitionMap.set(`${from}\u0000${to}`, (transitionMap.get(`${from}\u0000${to}`) ?? 0) + 1);
  }
  const betweenBlockTransitions = [...transitionMap.entries()].map(([key, count]) => {
    const [from, to] = key.split('\u0000');
    return { from: from!, to: to!, count };
  }).sort((a, b) => b.count - a.count || a.from.localeCompare(b.from));

  const rangeStartMs = Date.parse(fromUtc) - 30 * 60_000;
  const rangeEndMs = Date.parse(toUtc);
  const meetingIntervals = db.select({ startUtc: events.startUtc, endUtc: events.endUtc }).from(events).all()
    .filter((event) => Date.parse(event.endUtc) >= rangeStartMs && Date.parse(event.startUtc) <= rangeEndMs);
  const meetingAdjacent = rows.filter((row) => {
    const startMs = Date.parse(row.startUtc);
    return meetingIntervals.some((event) => {
      const gap = startMs - Date.parse(event.endUtc);
      return gap >= 0 && gap <= 30 * 60_000;
    });
  });
  const notMeetingAdjacent = rows.filter((row) => !meetingAdjacent.includes(row));
  const delayedRows = rows.filter((row) => row.summary.startLatencyMin !== null && row.summary.startLatencyMin >= 10);
  const overrunRows = rows.filter((row) => row.summary.overrunMin > 0);
  const scheduledTaskCounts = new Map<string, number>();
  for (const row of rows) if (row.taskId) scheduledTaskCounts.set(row.taskId, (scheduledTaskCounts.get(row.taskId) ?? 0) + 1);
  const splitRows = rows.filter((row) => row.taskId !== null && (scheduledTaskCounts.get(row.taskId) ?? 0) > 1);
  const longRows = rows.filter((row) => !splitRows.includes(row));

  const gateOpen = verifiedRows.length >= 20 && new Set(verifiedRows.map((row) => DateTime.fromISO(row.startUtc, { zone: 'utc' }).setZone(timezone).toISODate())).size >= 10;
  const previewCandidates: Array<{ dimension: 'hour' | 'project' | 'task_class'; key: string; label: string; rows: PersonalAnalyticsRow[] }> = [
    ...[...capacityByHour.entries()].map(([hour, group]) => ({ dimension: 'hour' as const, key: String(hour), label: `${String(hour).padStart(2, '0')}:00`, rows: group })),
    ...[...taskClassMap.entries()].map(([taskClass, group]) => ({ dimension: 'task_class' as const, key: taskClass, label: taskClass, rows: group })),
    ...[...projectMap.entries()].map(([project, group]) => ({ dimension: 'project' as const, key: project, label: project, rows: group })),
  ];
  const schedulerPreviews = previewCandidates.flatMap((candidate) => {
    const group = candidate.rows.filter((row) => row.summary.verificationState === 'verified');
    if (group.length < 3) return [];
    const quality = averageFor(group, (row) => row.summary.focusQuality);
    const latency = averageFor(group, (row) => row.summary.startLatencyMin);
    const direction = quality !== null && quality >= 70 && (latency === null || latency <= 5) ? 'prefer' as const
      : quality !== null && (quality < 55 || (latency !== null && latency >= 15)) ? 'avoid' as const : 'neutral' as const;
    const potentialScoreImpactPct = gateOpen && direction !== 'neutral' ? Math.min(15, Math.max(1, Math.round(Math.abs((quality ?? 60) - 60) / 3))) : 0;
    return [{
      dimension: candidate.dimension,
      key: candidate.key,
      label: candidate.label,
      direction,
      rationale: gateOpen ? `Based on ${group.length} verified blocks; this remains a preview until you accept a proposal.` : `Needs 20 verified blocks across 10 days before any scheduler influence; this is evidence only.`,
      sampleCount: group.length,
      distinctDays: new Set(group.map((row) => DateTime.fromISO(row.startUtc, { zone: 'utc' }).setZone(timezone).toISODate())).size,
      confidence: averageFor(group, (row) => row.summary.confidence),
      potentialScoreImpactPct,
      appliedScoreImpactPct: 0 as const,
    }];
  }).sort((a, b) => b.potentialScoreImpactPct - a.potentialScoreImpactPct || b.sampleCount - a.sampleCount).slice(0, 8);

  const weeklyInsights = [] as ActivityPersonalAnalytics['weeklyInsights'];
  const bestCapacity = [...capacityCurve].filter((point) => point.sampleCount >= 3 && point.focusQuality !== null).sort((a, b) => (b.focusQuality ?? 0) - (a.focusQuality ?? 0))[0];
  if (bestCapacity) weeklyInsights.push({ id: `focus-window:${bestCapacity.hour}`, title: `Strong focus window around ${String(bestCapacity.hour).padStart(2, '0')}:00`, detail: `Average focus quality was ${Math.round(bestCapacity.focusQuality!)}% across ${bestCapacity.sampleCount} observed blocks.`, sampleCount: bestCapacity.sampleCount, confidence: averageFor(rows.filter((row) => DateTime.fromISO(row.startUtc, { zone: 'utc' }).setZone(timezone).hour === bestCapacity.hour), (row) => row.summary.confidence), proposalOnly: true });
  const calendarToObservedRatio = boundedRatio(totalObservedMin, totalCalendarMin);
  if (rows.length >= 3 && calendarToObservedRatio !== null && calendarToObservedRatio < 0.8) weeklyInsights.push({ id: 'calendar-observed-gap', title: 'Observed work is below scheduled time', detail: `${Math.round(calendarToObservedRatio * 100)}% of scheduled block time was relevant or supporting activity. Review the evidence before changing estimates or schedule density.`, sampleCount: rows.length, confidence: averageFor(rows, (row) => row.summary.confidence), proposalOnly: true });
  const adjacentLatency = averageFor(meetingAdjacent, (row) => row.summary.startLatencyMin);
  const nonAdjacentLatency = averageFor(notMeetingAdjacent, (row) => row.summary.startLatencyMin);
  if (meetingAdjacent.length >= 3 && adjacentLatency !== null && nonAdjacentLatency !== null && adjacentLatency - nonAdjacentLatency >= 5) weeklyInsights.push({ id: 'meeting-transition', title: 'Meeting-adjacent blocks start later', detail: `Blocks starting within 30 minutes of a meeting averaged ${Math.round(adjacentLatency)} minutes of start latency versus ${Math.round(nonAdjacentLatency)} minutes otherwise. Consider a buffer proposal; no calendar changes are made automatically.`, sampleCount: meetingAdjacent.length, confidence: averageFor(meetingAdjacent, (row) => row.summary.confidence), proposalOnly: true });

  return ActivityPersonalAnalyticsSchema.parse({
    fromUtc,
    toUtc,
    timezone,
    sample: { blockCount: rows.length, observedBlockCount: observedRows.length, verifiedBlockCount: verifiedRows.length, distinctDays, averageConfidence: averageFor(rows, (row) => row.summary.confidence) },
    calibration: { taskEstimateMin, calendarMin: totalCalendarMin, observedWorkMin: totalObservedMin, estimateErrorRatio: boundedRatio(totalObservedMin - taskEstimateMin, taskEstimateMin), calendarToObservedRatio: boundedRatio(totalObservedMin, totalCalendarMin), sampleCount: rows.length },
    focusHeatmaps: { overall: cellsFor('overall'), byProject: seriesFor('project'), byTaskClass: seriesFor('task') },
    capacityCurve,
    sessionLengthBands,
    categories,
    betweenBlockTransitions,
    distraction: { affectedBlockCount: rows.filter((row) => row.summary.distractionMin > 0).length, totalMinutes: rows.reduce((sum, row) => sum + row.summary.distractionMin, 0), averageReturnLatencyMin: averageFor(rows.filter((row) => row.summary.distractionMin > 0), (row) => row.summary.returnLatencyMin) },
    spontaneousWork: { unplannedPromptCount: db.select().from(activityRecommendations).all().filter((row) => row.kind === 'unplanned_work' && row.createdAtUtc >= fromUtc && row.createdAtUtc < toUtc).length, observedMinutes: null },
    meetingAdjacency: { adjacentBlockCount: meetingAdjacent.length, nonAdjacentBlockCount: notMeetingAdjacent.length, adjacentStartLatencyMin: adjacentLatency, nonAdjacentStartLatencyMin: nonAdjacentLatency },
    overrunRisk: { affectedBlockCount: overrunRows.length, rate: boundedRatio(overrunRows.length, rows.length), averageMinutes: averageFor(overrunRows, (row) => row.summary.overrunMin) },
    delayedStartRisk: { affectedBlockCount: delayedRows.length, rate: boundedRatio(delayedRows.length, rows.length), averageMinutes: averageFor(delayedRows, (row) => row.summary.startLatencyMin) },
    splitVsLong: {
      splitBlockCount: splitRows.length,
      longBlockCount: longRows.length,
      splitFocusQuality: averageFor(splitRows, (row) => row.summary.focusQuality),
      longFocusQuality: averageFor(longRows, (row) => row.summary.focusQuality),
      splitObservedMin: splitRows.reduce((sum, row) => sum + observedMinutes(row), 0),
      longObservedMin: longRows.reduce((sum, row) => sum + observedMinutes(row), 0),
    },
    schedulerPreviews,
    weeklyInsights,
  });
}

function toRecommendation(row: typeof activityRecommendations.$inferSelect): ActivityRecommendation {
  return {
    id: row.id,
    blockId: row.blockId,
    kind: row.kind as ActivityRecommendation['kind'],
    title: row.title,
    detail: row.detail,
    status: row.status as ActivityRecommendation['status'],
    createdAtUtc: row.createdAtUtc,
    expiresAtUtc: row.expiresAtUtc,
  };
}

export function listActivityRecommendations(db: DB): ActivityRecommendation[] {
  const now = nowUtcIso();
  db.update(activityRecommendations)
    .set({ status: 'expired', updatedAtUtc: now })
    .where(and(eq(activityRecommendations.status, 'active'), lt(activityRecommendations.expiresAtUtc, now)))
    .run();
  return db.select().from(activityRecommendations).orderBy(desc(activityRecommendations.createdAtUtc)).all().map(toRecommendation);
}

export function updateActivityRecommendation(db: DB, id: string, status: 'accepted' | 'dismissed'): ActivityRecommendation | null {
  const row = db.select().from(activityRecommendations).where(eq(activityRecommendations.id, id)).get();
  if (!row || row.status !== 'active') return null;
  db.update(activityRecommendations).set({ status, updatedAtUtc: nowUtcIso() }).where(eq(activityRecommendations.id, id)).run();
  const updated = db.select().from(activityRecommendations).where(eq(activityRecommendations.id, id)).get();
  return updated ? toRecommendation(updated) : null;
}

const ACTIVITY_AI_PREVIEW_TTL_MS = 15 * 60_000;

export class ActivityAiPreviewError extends Error {
  constructor(readonly code: 'not_found' | 'expired' | 'consumed' | 'invalid_payload' | 'ai_not_configured') {
    super(code.replace(/_/g, ' '));
  }
}

export type ActivityAiGateway = Pick<ModelGateway, 'configured' | 'generateText'>;

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function summaryAggregate(rows: PersonalAnalyticsRow[]) {
  const scheduledMin = rows.reduce((sum, row) => sum + Math.max(0, (Date.parse(row.endUtc) - Date.parse(row.startUtc)) / 60_000), 0);
  const relevantMin = rows.reduce((sum, row) => sum + row.summary.relevantMin, 0);
  const supportingMin = rows.reduce((sum, row) => sum + row.summary.supportingMin, 0);
  const distractionMin = rows.reduce((sum, row) => sum + row.summary.distractionMin, 0);
  const idleMin = rows.reduce((sum, row) => sum + row.summary.idleMin, 0);
  const unknownMin = rows.reduce((sum, row) => sum + row.summary.unknownMin, 0);
  const activeMin = relevantMin + supportingMin + distractionMin + unknownMin;
  return {
    scheduledMin: rounded(scheduledMin),
    relevantMin: rounded(relevantMin),
    supportingMin: rounded(supportingMin),
    distractionMin: rounded(distractionMin),
    idleMin: rounded(idleMin),
    unknownMin: rounded(unknownMin),
    focusRatio: activeMin > 0 ? rounded((relevantMin + supportingMin) / activeMin) : null,
    startLatencyMin: average(rows.map((row) => row.summary.startLatencyMin)),
    contextSwitchRate: activeMin > 0 ? rounded(rows.reduce((sum, row) => sum + row.summary.contextSwitches, 0) / (activeMin / 60)) : null,
    overrunMin: rounded(rows.reduce((sum, row) => sum + row.summary.overrunMin, 0)),
    focusQuality: average(rows.map((row) => row.summary.focusQuality)),
    confidence: average(rows.map((row) => row.summary.confidence)),
  };
}

function scopeAggregates(rows: PersonalAnalyticsRow[], key: (row: PersonalAnalyticsRow) => string) {
  const groups = new Map<string, PersonalAnalyticsRow[]>();
  for (const row of rows) {
    const label = key(row);
    const group = groups.get(label) ?? [];
    group.push(row);
    groups.set(label, group);
  }
  return [...groups.entries()]
    .map(([label, group]) => ({
      label,
      ...summaryAggregate(group),
      blockCount: group.length,
      verifiedBlockCount: group.filter((row) => row.summary.verificationState === 'verified').length,
      sampleCount: group.filter((row) => row.summary.coverage > 0 || row.summary.relevantMin + row.summary.supportingMin > 0).length,
    }))
    .sort((a, b) => b.relevantMin + b.supportingMin - (a.relevantMin + a.supportingMin) || a.label.localeCompare(b.label));
}

/** Maps local application names to a deliberately broad, non-identifying family. */
function applicationFamily(application: string | null): 'browser' | 'editor' | 'terminal' | 'communication' | 'document' | 'system' | 'other' {
  const name = application?.trim().toLowerCase() ?? '';
  if (/chrome|edge|firefox|brave|safari|opera|arc|browser/.test(name)) return 'browser';
  if (/visual studio|\bcode\b|vscode|intellij|pycharm|webstorm|sublime|neovim|\bvim\b/.test(name)) return 'editor';
  if (/terminal|powershell|\bpwsh\b|\bcmd\b|git bash|alacritty|iterm/.test(name)) return 'terminal';
  if (/slack|teams|discord|zoom|outlook|thunderbird/.test(name)) return 'communication';
  if (/word|excel|powerpoint|notion|obsidian|onenote|libreoffice/.test(name)) return 'document';
  if (/explorer|finder|settings|system/.test(name)) return 'system';
  return 'other';
}

/** Only called after the UI has opted into broad application-family totals. */
function applicationFamilyTotals(db: DB, fromUtc: string, toUtc: string) {
  const fromMs = Date.parse(fromUtc);
  const toMs = Date.parse(toUtc);
  const totals = new Map<string, number>();
  const rows = db.select({ startUtc: computerActivityEvents.startUtc, durationSec: computerActivityEvents.durationSec, application: computerActivityEvents.application, category: computerActivityEvents.category, isAfk: computerActivityEvents.isAfk }).from(computerActivityEvents).all();
  for (const row of rows) {
    if (row.isAfk || row.category === 'sensitive' || row.category === 'ignore') continue;
    const startMs = Date.parse(row.startUtc);
    const endMs = startMs + Math.max(0, row.durationSec) * 1_000;
    const overlapMs = Math.max(0, Math.min(endMs, toMs) - Math.max(startMs, fromMs));
    if (!overlapMs) continue;
    const family = applicationFamily(row.application);
    totals.set(family, (totals.get(family) ?? 0) + overlapMs / 60_000);
  }
  return [...totals.entries()]
    .map(([family, activeMin]) => ({ family: family as 'browser' | 'editor' | 'terminal' | 'communication' | 'document' | 'system' | 'other', activeMin: rounded(activeMin) }))
    .sort((a, b) => b.activeMin - a.activeMin || a.family.localeCompare(b.family));
}

/**
 * Creates the exact aggregate-only review document. It does not call the model
 * and it never reads raw titles, URLs, domains, paths, or event timelines.
 */
export function createActivityAiPreview(db: DB, input: ActivityAiPreviewInput): ActivityAiPreview {
  const now = nowUtcIso();
  db.delete(activityAiPreviews).where(lt(activityAiPreviews.expiresAtUtc, now)).run();
  const rows = personalAnalyticsRows(db, input.fromUtc, input.toUtc);
  const settings = getSettings(db);
  const observedRows = rows.filter((row) => row.summary.coverage > 0 || row.summary.relevantMin + row.summary.supportingMin > 0);
  const payload = ActivityAiAggregatePayloadSchema.parse({
    schemaVersion: 'activity-ai-preview-v1',
    range: { fromUtc: input.fromUtc, toUtc: input.toUtc, timezone: settings.timezone },
    formulaVersions: [...new Set(rows.map((row) => row.summary.formulaVersion))].sort(),
    sample: {
      blockCount: rows.length,
      observedBlockCount: observedRows.length,
      verifiedBlockCount: rows.filter((row) => row.summary.verificationState === 'verified').length,
      distinctDays: new Set(rows.map((row) => DateTime.fromISO(row.startUtc, { zone: 'utc' }).setZone(settings.timezone).toISODate())).size,
      averageConfidence: average(rows.map((row) => row.summary.confidence)),
    },
    totals: summaryAggregate(rows),
    byProject: scopeAggregates(rows, (row) => keyLabel(row.projectName, 'No project')),
    byTaskClass: scopeAggregates(rows, (row) => row.taskClass),
    applicationFamilies: input.includeApplicationFamilies ? applicationFamilyTotals(db, input.fromUtc, input.toUtc) : null,
  });
  const payloadJson = JSON.stringify(payload);
  const payloadHash = createHash('sha256').update(payloadJson).digest('hex');
  const id = randomUUID();
  const expiresAtUtc = new Date(Date.now() + ACTIVITY_AI_PREVIEW_TTL_MS).toISOString();
  db.insert(activityAiPreviews).values({ id, payloadJson, payloadHash, status: 'active', expiresAtUtc, createdAtUtc: now }).run();
  return ActivityAiPreviewSchema.parse({ id, payloadHash, expiresAtUtc, payload });
}

/** Sends only the exact, reviewed payload that was stored by createActivityAiPreview. */
export async function analyzeActivityAiPreview(db: DB, input: ActivityAiAnalyzeInput, gateway: ActivityAiGateway, model: string): Promise<ActivityAiAnalysis> {
  if (!gateway.configured()) throw new ActivityAiPreviewError('ai_not_configured');
  const now = nowUtcIso();
  const row = db.select().from(activityAiPreviews).where(and(eq(activityAiPreviews.id, input.previewId), eq(activityAiPreviews.payloadHash, input.payloadHash))).get();
  if (!row) throw new ActivityAiPreviewError('not_found');
  if (row.expiresAtUtc <= now) throw new ActivityAiPreviewError('expired');
  if (row.status !== 'active') throw new ActivityAiPreviewError('consumed');

  // Claim before the request: an interrupted request requires a fresh review,
  // which is safer than silently retrying an already-approved transmission.
  const claimed = db.update(activityAiPreviews)
    .set({ status: 'consumed', usedAtUtc: now })
    .where(and(eq(activityAiPreviews.id, row.id), eq(activityAiPreviews.payloadHash, input.payloadHash), eq(activityAiPreviews.status, 'active'), gt(activityAiPreviews.expiresAtUtc, now)))
    .run();
  if (claimed.changes !== 1) throw new ActivityAiPreviewError('consumed');

  let payload: ActivityAiAggregatePayload;
  try {
    payload = ActivityAiAggregatePayloadSchema.parse(JSON.parse(row.payloadJson));
  } catch {
    throw new ActivityAiPreviewError('invalid_payload');
  }
  const prompt = [
    'You are reviewing a user-approved, aggregate-only computer activity summary.',
    'Give an evidence-based, concise reflection in 3-6 bullets. Use association language, not causal or medical claims. Do not invent missing data, do not request detailed activity, and do not propose automatic task or schedule changes.',
    'Treat focus quality and confidence as behavioral heuristics. Mention sample-size limits when relevant.',
    'The following JSON is the complete and only reviewed payload. Do not infer any titles, URLs, domains, paths, individual events, or timeline details.',
    '',
    row.payloadJson,
  ].join('\n');
  const result = await gateway.generateText({ task: 'activity_aggregate_analysis', promptVersion: 'activity-aggregate-v1', model, prompt, retries: 0 });
  return ActivityAiAnalysisSchema.parse({ previewId: row.id, payloadHash: row.payloadHash, content: result.value.trim(), generatedAtUtc: nowUtcIso() });
}
