import { z } from 'zod';

const NullableNumber = z.number().nullable();

export const WorkoutJobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'interrupted']);
export type WorkoutJobStatus = z.infer<typeof WorkoutJobStatusSchema>;

export const WorkoutJobSchema = z.object({
  id: z.string(),
  command: z.string(),
  status: WorkoutJobStatusSchema,
  progress: z.number().min(0).max(1),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  createdAtUtc: z.string(),
  updatedAtUtc: z.string(),
  completedAtUtc: z.string().nullable(),
});
export type WorkoutJobDTO = z.infer<typeof WorkoutJobSchema>;

export const WorkoutStatusSchema = z.object({
  engineAvailable: z.boolean(),
  sets: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  latestSession: z.string().nullable(),
  adherencePct: z.number().nullable(),
  adherence: z.record(z.number()),
  hevyConnected: z.boolean(),
  summaryAvailable: z.boolean(),
  activeJob: WorkoutJobSchema.nullable(),
});
export type WorkoutStatusDTO = z.infer<typeof WorkoutStatusSchema>;

export const WorkoutActionSchema = z.object({
  priority: z.number(),
  kind: z.string(),
  icon: z.string(),
  title: z.string(),
  detail: z.string(),
  tab: z.string(),
});

export const WorkoutRecentPrSchema = z.object({
  type: z.string(),
  value: z.number(),
  date: z.string(),
}).passthrough();

export const WorkoutNextTargetSchema = z.object({
  rec_type: z.string().optional(),
  weight: NullableNumber.optional(),
  reps: NullableNumber.optional(),
  n_sets: z.number().nullable().optional(),
  sets: z.array(z.object({ weight: z.number(), reps: z.number() }).passthrough()).optional(),
  rationale: z.string().optional(),
  predicted_reps: NullableNumber.optional(),
  predicted_range: z.tuple([z.number(), z.number()]).nullable().optional(),
  prediction_confidence: NullableNumber.optional(),
  prediction_basis: z.string().optional(),
  last_rpe: NullableNumber.optional(),
  last_reserve: NullableNumber.optional(),
}).passthrough();

export const WorkoutForecastSchema = z.object({
  trend: z.string(),
  horizon_weeks: z.number(),
  e1rm_in_horizon: NullableNumber,
  band: z.tuple([z.number(), z.number()]).nullable(),
  note: z.string().nullable().optional(),
}).passthrough();

export const WorkoutIndividualizationSchema = z.object({
  grace_state: z.string(),
  confidence: z.number(),
  n_fresh: z.number(),
  individ_1rm: NullableNumber,
  individ_1rm_basis: z.string(),
  anchor: z.object({
    M: NullableNumber.optional(),
    ex_type: z.string().optional(),
    n_eff: NullableNumber.optional(),
    spread: NullableNumber.optional(),
    basis: z.string().optional(),
  }).passthrough().nullable().optional(),
}).passthrough();

export const WorkoutPlateauSchema = z.object({
  verdict: z.string(),
  // Short-history lifts have a verdict but no meaningful plateau onset yet.
  // The Python schema-v4 engine omits the field in that state.
  onset: z.string().nullable().optional(),
  segment: z.object({
    sse: NullableNumber.optional(),
    k: z.number().nullable().optional(),
    onset: z.string().nullable().optional(),
    left_slope_wk: NullableNumber.optional(),
    right_slope_wk: NullableNumber.optional(),
  }).passthrough().nullable().optional(),
  ceiling: z.object({
    ceiling: NullableNumber.optional(),
    current: NullableNumber.optional(),
    pct_of_ceiling: NullableNumber.optional(),
  }).passthrough().nullable().optional(),
}).passthrough();

export const WorkoutMuscleDetailSchema = z.object({
  sets_per_week: z.number(),
  sets_per_week_ewma: z.number(),
  sets_recent_7d: z.number(),
  active_weeks_4wk: z.number(),
  status: z.string(),
  mev: NullableNumber,
  mav: NullableNumber,
  mrv: NullableNumber,
  region: z.string().nullable(),
  last_trained: z.string().nullable(),
  days_since: NullableNumber,
});
export type WorkoutMuscleDetail = z.infer<typeof WorkoutMuscleDetailSchema>;

export const WorkoutExerciseSchema = z.object({
  name: z.string(),
  muscle: z.string(),
  epoch: z.number(),
  n_sessions: z.number(),
  last_trained: z.string().nullable(),
  best_e1rm: NullableNumber,
  best_e1rm_set: z.string().nullable(),
  heaviest: z.string().nullable(),
  e1rm_trend_per_week: NullableNumber,
  trend_confidence: z.string(),
  status: z.string(),
  recent_pr: WorkoutRecentPrSchema.nullable(),
  next_target: WorkoutNextTargetSchema.nullable(),
  forecast: WorkoutForecastSchema.nullable(),
  individualization: WorkoutIndividualizationSchema,
  plateau: WorkoutPlateauSchema,
  series: z.array(z.tuple([z.string(), z.number()])),
});
export type WorkoutExerciseDTO = z.infer<typeof WorkoutExerciseSchema>;

export const WorkoutRecordSchema = z.object({
  name: z.string(),
  muscle: z.string(),
  last_trained: z.string().nullable(),
  heaviest: z.record(z.unknown()).nullable(),
  best_e1rm: z.record(z.unknown()).nullable(),
  best_reps: z.record(z.unknown()).nullable(),
  best_session_volume: z.record(z.unknown()).nullable(),
  recent_pr: z.unknown().nullable(),
});

export const WorkoutGoalSchema = z.object({
  goal_id: z.number(),
  exercise: z.string(),
  metric: z.string(),
  target_value: z.number(),
  target_reps: z.number().nullable(),
  target_date: z.string().nullable(),
  current: z.number().nullable(),
  projected_date: z.string().nullable(),
  weeks_needed: z.number().nullable(),
  verdict: z.string(),
});

export const WorkoutVolumeRecommendationSchema = z.object({
  muscle: z.string(),
  current_sets: z.number(),
  target_sets: z.number(),
  final_target: z.number(),
  delta: z.number(),
  action: z.string(),
  recovery: z.string(),
  recovery_score: NullableNumber,
  confidence: z.string(),
  signals: z.array(z.string()),
  reason: z.string(),
  status: z.string(),
}).passthrough();

export const WorkoutDataQualitySchema = z.object({
  rpe_present: z.boolean(),
  bodyweight_present: z.boolean(),
  anomalies_corrected: z.array(z.object({
    exercise: z.string(),
    date: z.string(),
    field: z.string(),
    raw: z.unknown(),
    corrected: z.unknown(),
    rule: z.string(),
  }).passthrough()),
  unit_epochs: z.array(z.object({
    exercise: z.string(),
    epochs: z.number(),
    note: z.string(),
  }).passthrough()),
  import: z.object({ inserted: z.number(), updated: z.number(), rows_seen: z.number() }).passthrough(),
}).passthrough();

export const WorkoutFatigueSchema = z.object({
  readiness: z.string(),
  readiness_state: z.string(),
  reasons: z.array(z.string()),
  acwr_global: NullableNumber.optional(),
  acwr_by_muscle: z.record(z.number()).optional(),
  acwr_state_by_muscle: z.record(z.string()).optional(),
  monotony: NullableNumber,
  strain: NullableNumber,
  intra_session_dropoff: z.record(z.number()).optional(),
  intra_session_dropoff_avg: NullableNumber.optional(),
  frequency: z.object({ sessions_7d: z.number(), sessions_28d: z.number(), per_week_28d: z.number() }),
}).passthrough();

export const WorkoutForecastAccuracySchema = z.object({
  n: z.number(),
  note: z.string().optional(),
  model_mae: NullableNumber.optional(),
  flat_mae: NullableNumber.optional(),
  linear_mae: NullableNumber.optional(),
  beats_flat: z.boolean().optional(),
  beats_linear: z.boolean().optional(),
  band_level: NullableNumber.optional(),
  band_coverage: NullableNumber.optional(),
  calib: z.object({ rel_halfwidth: NullableNumber, level: z.number(), n: z.number() }).passthrough(),
}).passthrough();

export const WorkoutExerciseHistorySetSchema = z.object({
  index: z.number().int(),
  type: z.string().nullable(),
  weight: NullableNumber,
  reps: z.number().int().nullable(),
  rpe: NullableNumber,
  rir: NullableNumber,
  rest_seconds: NullableNumber,
  e1rm: NullableNumber,
  volume: NullableNumber,
  epoch: z.number().int(),
  is_working: z.boolean(),
  quality_flag: z.string().nullable(),
});

export const WorkoutExerciseHistorySessionSchema = z.object({
  date: z.string(),
  title: z.string(),
  duration_min: NullableNumber,
  total_volume: z.number(),
  working_sets: z.number().int(),
  top_weight: NullableNumber,
  top_reps: z.number().int().nullable(),
  top_e1rm: NullableNumber,
  sets: z.array(WorkoutExerciseHistorySetSchema),
});

export const WorkoutExerciseHistorySchema = z.object({
  schema_version: z.literal(1),
  exercise: z.string(),
  muscle: z.string(),
  epochs: z.array(z.object({
    epoch: z.number().int(),
    first_date: z.string(),
    last_date: z.string(),
    sessions: z.number().int(),
  })),
  sessions: z.array(WorkoutExerciseHistorySessionSchema),
});
export type WorkoutExerciseHistoryDTO = z.infer<typeof WorkoutExerciseHistorySchema>;
export const WorkoutExerciseHistoryQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, {
  message: '`from` must be on or before `to`.',
});

export const WorkoutSummarySchema = z.object({
  schema_version: z.literal(4),
  generated_at: z.string(),
  window: z.object({
    latest_session: z.string(),
    weeks_covered: z.number(),
    first_session: z.string().nullable(),
  }),
  data_quality: WorkoutDataQualitySchema,
  adherence: z.record(z.number()),
  week_summary: z.object({
    sessions: z.number(),
    total_hard_sets: z.number(),
    sets_by_muscle_7d: z.record(z.number()),
    muscle_status_4wk_avg: z.record(z.string()),
    muscle_detail: z.record(WorkoutMuscleDetailSchema),
    ratios: z.record(z.number()),
  }),
  history: z.array(z.object({ month: z.string(), sessions: z.number(), hard_sets: z.number(), volume: z.number() })),
  calendar: z.array(z.object({
    date: z.string(),
    sets: z.number(),
    volume: z.number(),
    n_exercises: z.number(),
    muscles: z.array(z.string()),
  })),
  sessions: z.record(z.object({
    title: z.string(),
    duration_min: NullableNumber,
    total_sets: z.number(),
    volume: z.number(),
    exercises: z.array(z.object({
      name: z.string(),
      muscle: z.string(),
      n_sets: z.number(),
      top_weight: NullableNumber,
      top_reps: NullableNumber,
      e1rm: NullableNumber,
    })),
  })),
  bodyweight: z.array(z.object({ date: z.string(), weight: z.number(), unit: z.string() })),
  fatigue: WorkoutFatigueSchema,
  forecast_accuracy: WorkoutForecastAccuracySchema.optional(),
  recovery_accuracy: z.record(z.unknown()).optional(),
  rir_rep_accuracy: z.record(z.unknown()).optional(),
  conformal_accuracy: z.record(z.unknown()).optional(),
  grace_overview: z.record(z.number()),
  next_actions: z.array(WorkoutActionSchema),
  volume_plan: z.object({
    recommendations: z.array(WorkoutVolumeRecommendationSchema),
  }).passthrough(),
  exercises: z.array(WorkoutExerciseSchema),
  records: z.array(WorkoutRecordSchema),
  powerlifting: z.record(z.unknown()),
  goals: z.array(WorkoutGoalSchema),
  headline_flags: z.array(z.string()),
}).passthrough();
export type WorkoutSummaryDTO = z.infer<typeof WorkoutSummarySchema>;

export const WorkoutCredentialInputSchema = z.object({ apiKey: z.string().trim().min(1).max(500) });
export const WorkoutSyncInputSchema = z.object({ full: z.boolean().default(false), date: z.string().date().optional() });
export const WorkoutBodyweightInputSchema = z.object({
  weight: z.number().positive().max(500),
  date: z.string().date().optional(),
  note: z.string().max(1_000).optional(),
});
export const WorkoutGoalInputSchema = z.object({
  exercise: z.string().trim().min(1).max(200),
  metric: z.enum(['e1rm', 'weight_for_reps', 'bodyweight']),
  value: z.number().positive(),
  reps: z.number().int().positive().max(100).optional(),
  targetDate: z.string().date().optional(),
});
export const WorkoutNoteInputSchema = z.object({ category: z.string().trim().min(1).max(80), text: z.string().trim().min(1).max(10_000) });
export const WorkoutPredictInputSchema = z.object({ exercise: z.string().trim().min(1).max(200), weight: z.number().positive() });
export const WorkoutRoutinePushInputSchema = z.object({ previewHash: z.string().length(64), confirm: z.literal(true), date: z.string().date().optional() });

export interface WorkoutEngineResult<T = unknown> {
  ok: boolean;
  schemaVersion: number;
  data?: T;
  warnings?: string[];
  error?: string;
}
