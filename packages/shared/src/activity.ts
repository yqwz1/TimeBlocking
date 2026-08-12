import { z } from 'zod';

export const ActivityModeSchema = z.enum(['off', 'shadow', 'advisory']);
export type ActivityMode = z.infer<typeof ActivityModeSchema>;

export const ActivityCapabilitiesSchema = z.object({
  window: z.boolean(),
  afk: z.boolean(),
  browser: z.boolean(),
  editor: z.boolean(),
  input: z.boolean(),
});
export type ActivityCapabilities = z.infer<typeof ActivityCapabilitiesSchema>;

export const ActivityStatusSchema = z.object({
  configured: z.boolean(),
  mode: ActivityModeSchema,
  health: z.enum(['disconnected', 'healthy', 'unavailable']),
  port: z.number().int().min(1).max(65_535).nullable(),
  version: z.string().nullable(),
  capabilities: ActivityCapabilitiesSchema,
  requiredSourcesAvailable: z.boolean(),
  lastSuccessfulSyncAt: z.string().datetime().nullable(),
  lastErrorCode: z.string().nullable(),
});
export type ActivityStatus = z.infer<typeof ActivityStatusSchema>;

export const ActivityConnectInputSchema = z.object({
  port: z.number().int().min(1).max(65_535).default(5600),
  // The explicit mode keeps ActivityWatch disabled unless the user opts into shadow collection.
  mode: ActivityModeSchema.default('off'),
});
export type ActivityConnectInput = z.infer<typeof ActivityConnectInputSchema>;

export const ActivityVerificationStateSchema = z.enum(['unobserved', 'insufficient_data', 'observed', 'verified', 'needs_review', 'corrected']);
export type ActivityVerificationState = z.infer<typeof ActivityVerificationStateSchema>;

/** A small, safe-to-render projection attached to a scheduled block. */
export const ActivityVerificationBadgeSchema = z.object({
  state: ActivityVerificationStateSchema,
  confidence: z.number().min(0).max(100).nullable(),
  focusQuality: z.number().min(0).max(100).nullable(),
});
export type ActivityVerificationBadge = z.infer<typeof ActivityVerificationBadgeSchema>;

export const BlockActivitySummarySchema = z.object({
  blockId: z.string(),
  formulaVersion: z.string(),
  actualStartUtc: z.string().datetime().nullable(),
  actualEndUtc: z.string().datetime().nullable(),
  startLatencyMin: z.number().nullable(),
  coverage: z.number().min(0).max(100),
  relevantMin: z.number().min(0),
  supportingMin: z.number().min(0),
  distractionMin: z.number().min(0),
  idleMin: z.number().min(0),
  unknownMin: z.number().min(0),
  contextSwitches: z.number().int().min(0),
  returnLatencyMin: z.number().nullable(),
  longestFocusSessionMin: z.number().min(0),
  continuity: z.number().min(0).max(1),
  focusRatio: z.number().min(0).max(1).nullable(),
  focusQuality: z.number().min(0).max(100).nullable(),
  primaryCategory: z.string().nullable(),
  overrunMin: z.number().min(0),
  confidence: z.number().min(0).max(100).nullable(),
  verificationState: ActivityVerificationStateSchema,
  correction: z.record(z.unknown()).nullable(),
  updatedAtUtc: z.string().datetime(),
});
export type BlockActivitySummary = z.infer<typeof BlockActivitySummarySchema>;

/** Corrections are evidence annotations only; they never alter block or task status. */
export const ActivityCorrectionInputSchema = z.object({
  actualStartUtc: z.string().datetime().nullable().optional(),
  actualEndUtc: z.string().datetime().nullable().optional(),
  projectId: z.string().min(1).max(200).nullable().optional(),
  primaryCategory: z.string().min(1).max(100).nullable().optional(),
  verificationState: ActivityVerificationStateSchema.optional(),
  note: z.string().trim().max(1_000).optional(),
}).refine((value) => !(value.actualStartUtc && value.actualEndUtc) || value.actualStartUtc <= value.actualEndUtc, {
  message: 'Actual end must be after actual start.',
});
export type ActivityCorrectionInput = z.infer<typeof ActivityCorrectionInputSchema>;

export const ActivityAnalyticsSchema = z.object({
  fromUtc: z.string().datetime(),
  toUtc: z.string().datetime(),
  blockCount: z.number().int().min(0),
  verifiedBlockCount: z.number().int().min(0),
  startLatencyMin: z.number().nullable(),
  overrunMin: z.number().min(0),
  relevantMin: z.number().min(0),
  supportingMin: z.number().min(0),
  distractionMin: z.number().min(0),
  idleMin: z.number().min(0),
  unknownMin: z.number().min(0),
  contextSwitchRate: z.number().min(0).nullable(),
  returnLatencyMin: z.number().nullable(),
  longestFocusSessionMin: z.number().min(0),
  continuity: z.number().min(0).max(1).nullable(),
  focusQuality: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(100).nullable(),
});
export type ActivityAnalytics = z.infer<typeof ActivityAnalyticsSchema>;

export const ActivityRecommendationKindSchema = z.enum(['unplanned_work', 'return_to_block', 'extension', 'start_block']);
export type ActivityRecommendationKind = z.infer<typeof ActivityRecommendationKindSchema>;
export const ActivityRecommendationSchema = z.object({
  id: z.string(),
  blockId: z.string().nullable(),
  kind: ActivityRecommendationKindSchema,
  title: z.string(),
  detail: z.string().nullable(),
  status: z.enum(['active', 'accepted', 'dismissed', 'expired']),
  createdAtUtc: z.string().datetime(),
  expiresAtUtc: z.string().datetime().nullable(),
});
export type ActivityRecommendation = z.infer<typeof ActivityRecommendationSchema>;

/**
 * Phase 3 is intentionally built from block-level evidence and calendar metadata.
 * It does not expose raw ActivityWatch events, titles, domains, or timelines.
 */
export const ActivityAnalyticsSampleSchema = z.object({
  blockCount: z.number().int().min(0),
  observedBlockCount: z.number().int().min(0),
  verifiedBlockCount: z.number().int().min(0),
  distinctDays: z.number().int().min(0),
  averageConfidence: z.number().min(0).max(100).nullable(),
});
export type ActivityAnalyticsSample = z.infer<typeof ActivityAnalyticsSampleSchema>;

export const ActivityFocusHeatmapCellSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  hour: z.number().int().min(0).max(23),
  observedMin: z.number().min(0),
  focusQuality: z.number().min(0).max(100).nullable(),
  sampleCount: z.number().int().min(0),
  confidence: z.number().min(0).max(100).nullable(),
});
export type ActivityFocusHeatmapCell = z.infer<typeof ActivityFocusHeatmapCellSchema>;

export const ActivityFocusHeatmapSeriesSchema = z.object({
  key: z.string(),
  label: z.string(),
  cells: z.array(ActivityFocusHeatmapCellSchema),
});
export type ActivityFocusHeatmapSeries = z.infer<typeof ActivityFocusHeatmapSeriesSchema>;

export const ActivityCalibrationSchema = z.object({
  taskEstimateMin: z.number().min(0),
  calendarMin: z.number().min(0),
  observedWorkMin: z.number().min(0),
  estimateErrorRatio: z.number().nullable(),
  calendarToObservedRatio: z.number().nullable(),
  sampleCount: z.number().int().min(0),
});
export type ActivityCalibration = z.infer<typeof ActivityCalibrationSchema>;

export const ActivityCapacityPointSchema = z.object({
  hour: z.number().int().min(0).max(23),
  observedMin: z.number().min(0),
  focusQuality: z.number().min(0).max(100).nullable(),
  contextSwitchRate: z.number().min(0).nullable(),
  sampleCount: z.number().int().min(0),
});
export type ActivityCapacityPoint = z.infer<typeof ActivityCapacityPointSchema>;

export const ActivitySessionBandSchema = z.object({
  label: z.string(),
  minMinutes: z.number().min(0),
  maxMinutes: z.number().min(0).nullable(),
  sampleCount: z.number().int().min(0),
  focusQuality: z.number().min(0).max(100).nullable(),
  continuity: z.number().min(0).max(1).nullable(),
});
export type ActivitySessionBand = z.infer<typeof ActivitySessionBandSchema>;

export const ActivityCategoryMetricSchema = z.object({
  category: z.string(),
  blockCount: z.number().int().min(0),
  observedMin: z.number().min(0),
  distractionMin: z.number().min(0),
  contextSwitches: z.number().int().min(0),
});
export type ActivityCategoryMetric = z.infer<typeof ActivityCategoryMetricSchema>;

/** Transitions between adjacent scheduled blocks; not a hidden raw-event sequence. */
export const ActivityTransitionSchema = z.object({
  from: z.string(),
  to: z.string(),
  count: z.number().int().min(0),
});
export type ActivityTransition = z.infer<typeof ActivityTransitionSchema>;

export const ActivityMeetingAdjacencySchema = z.object({
  adjacentBlockCount: z.number().int().min(0),
  nonAdjacentBlockCount: z.number().int().min(0),
  adjacentStartLatencyMin: z.number().nullable(),
  nonAdjacentStartLatencyMin: z.number().nullable(),
});
export type ActivityMeetingAdjacency = z.infer<typeof ActivityMeetingAdjacencySchema>;

export const ActivityRiskMetricSchema = z.object({
  affectedBlockCount: z.number().int().min(0),
  rate: z.number().min(0).max(1).nullable(),
  averageMinutes: z.number().min(0).nullable(),
});
export type ActivityRiskMetric = z.infer<typeof ActivityRiskMetricSchema>;

export const ActivitySplitComparisonSchema = z.object({
  splitBlockCount: z.number().int().min(0),
  longBlockCount: z.number().int().min(0),
  splitFocusQuality: z.number().min(0).max(100).nullable(),
  longFocusQuality: z.number().min(0).max(100).nullable(),
  splitObservedMin: z.number().min(0),
  longObservedMin: z.number().min(0),
});
export type ActivitySplitComparison = z.infer<typeof ActivitySplitComparisonSchema>;

export const ActivitySchedulerPreviewSchema = z.object({
  dimension: z.enum(['hour', 'project', 'task_class']),
  key: z.string(),
  label: z.string(),
  direction: z.enum(['prefer', 'avoid', 'neutral']),
  rationale: z.string(),
  sampleCount: z.number().int().min(0),
  distinctDays: z.number().int().min(0),
  confidence: z.number().min(0).max(100).nullable(),
  potentialScoreImpactPct: z.number().min(0).max(15),
  appliedScoreImpactPct: z.literal(0),
});
export type ActivitySchedulerPreview = z.infer<typeof ActivitySchedulerPreviewSchema>;

export const ActivityWeeklyInsightSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  sampleCount: z.number().int().min(0),
  confidence: z.number().min(0).max(100).nullable(),
  proposalOnly: z.literal(true),
});
export type ActivityWeeklyInsight = z.infer<typeof ActivityWeeklyInsightSchema>;

export const ActivityPersonalAnalyticsSchema = z.object({
  fromUtc: z.string().datetime(),
  toUtc: z.string().datetime(),
  timezone: z.string(),
  sample: ActivityAnalyticsSampleSchema,
  calibration: ActivityCalibrationSchema,
  focusHeatmaps: z.object({
    overall: z.array(ActivityFocusHeatmapCellSchema),
    byProject: z.array(ActivityFocusHeatmapSeriesSchema),
    byTaskClass: z.array(ActivityFocusHeatmapSeriesSchema),
  }),
  capacityCurve: z.array(ActivityCapacityPointSchema),
  sessionLengthBands: z.array(ActivitySessionBandSchema),
  categories: z.array(ActivityCategoryMetricSchema),
  betweenBlockTransitions: z.array(ActivityTransitionSchema),
  distraction: z.object({
    affectedBlockCount: z.number().int().min(0),
    totalMinutes: z.number().min(0),
    averageReturnLatencyMin: z.number().nullable(),
  }),
  spontaneousWork: z.object({
    unplannedPromptCount: z.number().int().min(0),
    observedMinutes: z.number().nullable(),
  }),
  meetingAdjacency: ActivityMeetingAdjacencySchema,
  overrunRisk: ActivityRiskMetricSchema,
  delayedStartRisk: ActivityRiskMetricSchema,
  splitVsLong: ActivitySplitComparisonSchema,
  schedulerPreviews: z.array(ActivitySchedulerPreviewSchema),
  weeklyInsights: z.array(ActivityWeeklyInsightSchema),
});
export type ActivityPersonalAnalytics = z.infer<typeof ActivityPersonalAnalyticsSchema>;

/**
 * This is the complete, allowlisted payload that may leave the device for an
 * optional activity AI review. It deliberately has no event, title, URL,
 * domain, path, or chronological-timeline fields.
 */
export const ActivityAiAggregateTotalsSchema = z.object({
  scheduledMin: z.number().min(0),
  relevantMin: z.number().min(0),
  supportingMin: z.number().min(0),
  distractionMin: z.number().min(0),
  idleMin: z.number().min(0),
  unknownMin: z.number().min(0),
  focusRatio: z.number().min(0).max(1).nullable(),
  startLatencyMin: z.number().nullable(),
  contextSwitchRate: z.number().min(0).nullable(),
  overrunMin: z.number().min(0),
  focusQuality: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(100).nullable(),
});
export type ActivityAiAggregateTotals = z.infer<typeof ActivityAiAggregateTotalsSchema>;

export const ActivityAiScopeAggregateSchema = ActivityAiAggregateTotalsSchema.extend({
  label: z.string().min(1).max(200),
  blockCount: z.number().int().min(0),
  verifiedBlockCount: z.number().int().min(0),
  sampleCount: z.number().int().min(0),
});
export type ActivityAiScopeAggregate = z.infer<typeof ActivityAiScopeAggregateSchema>;

/** Broad, non-identifying application classes. Individual application names never leave the device. */
export const ActivityAiApplicationFamilySchema = z.enum(['browser', 'editor', 'terminal', 'communication', 'document', 'system', 'other']);
export const ActivityAiApplicationFamilyTotalSchema = z.object({
  family: ActivityAiApplicationFamilySchema,
  activeMin: z.number().min(0),
});

export const ActivityAiAggregatePayloadSchema = z.object({
  schemaVersion: z.literal('activity-ai-preview-v1'),
  range: z.object({ fromUtc: z.string().datetime(), toUtc: z.string().datetime(), timezone: z.string().min(1).max(100) }),
  formulaVersions: z.array(z.string().min(1).max(100)).max(20),
  sample: z.object({
    blockCount: z.number().int().min(0),
    observedBlockCount: z.number().int().min(0),
    verifiedBlockCount: z.number().int().min(0),
    distinctDays: z.number().int().min(0),
    averageConfidence: z.number().min(0).max(100).nullable(),
  }),
  totals: ActivityAiAggregateTotalsSchema,
  byProject: z.array(ActivityAiScopeAggregateSchema).max(100),
  byTaskClass: z.array(ActivityAiScopeAggregateSchema).max(100),
  // null means the user did not explicitly opt into this optional field.
  applicationFamilies: z.array(ActivityAiApplicationFamilyTotalSchema).max(7).nullable(),
});
export type ActivityAiAggregatePayload = z.infer<typeof ActivityAiAggregatePayloadSchema>;

export const ActivityAiPreviewInputSchema = z.object({
  fromUtc: z.string().datetime(),
  toUtc: z.string().datetime(),
  includeApplicationFamilies: z.boolean().default(false),
}).refine((value) => value.fromUtc < value.toUtc, { message: 'The preview start must be before its end.' });
export type ActivityAiPreviewInput = z.infer<typeof ActivityAiPreviewInputSchema>;

export const ActivityAiPreviewSchema = z.object({
  id: z.string().uuid(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAtUtc: z.string().datetime(),
  payload: ActivityAiAggregatePayloadSchema,
});
export type ActivityAiPreview = z.infer<typeof ActivityAiPreviewSchema>;

export const ActivityAiAnalyzeInputSchema = z.object({
  previewId: z.string().uuid(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ActivityAiAnalyzeInput = z.infer<typeof ActivityAiAnalyzeInputSchema>;

export const ActivityAiAnalysisSchema = z.object({
  previewId: z.string().uuid(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string().min(1).max(8_000),
  generatedAtUtc: z.string().datetime(),
});
export type ActivityAiAnalysis = z.infer<typeof ActivityAiAnalysisSchema>;
