import type { BlockReason, EnergyWindows, TaskDifficulty, WorkingHours } from '@timeblock/shared';

export type { BlockReason };

/** Epoch-ms interval, half-open [start, end). */
export interface Interval {
  start: number;
  end: number;
}

export interface PlanTaskInput {
  id: string;
  priority: number; // 1..4 (4 = urgent)
  dueDate: string | null; // local YYYY-MM-DD
  dueDatetimeUtc: string | null;
  /** local YYYY-MM-DD — "picked for today/tomorrow" in the Plan Day ritual; a soft deadline that applies only when it's earlier than any real due date. */
  plannedForDate: string | null;
  durationMin: number;
  /** How hard the task is; hard => deep work, easy => shallow (see classifyTask). Optional: undefined means "unset". */
  difficulty?: TaskDifficulty | null;
  createdAtUtc: string | null;
  labels: string[];
  projectId: string | null;
  /** 0..1 urgency lift from a behind-pace weekly objective this task advances (Phase 6). */
  objectiveBoost?: number;
  /** The task's existing future, unlocked chunk blocks (for all-or-nothing stickiness). */
  currentChunks: { chunkIndex: number; startUtc: string; endUtc: string }[];
}

export interface PlanHabitInput {
  id: string;
  name: string;
  durationMin: number;
  rrule: string; // FREQ=DAILY | FREQ=WEEKLY;BYDAY=MO,WE,FR
  preferredStart: string | null; // HH:mm local
  windowStart: string; // HH:mm local
  windowEnd: string;
  priority: number;
  kind: 'habit' | 'learning';
  weeklyTargetMin: number | null;
  /** Local dates that must not get a new instance (done/skipped/locked/in-progress). */
  excludedDates: string[];
  /** Minutes already credited per week (done instances), keyed by local Monday date. */
  creditMin: Record<string, number>;
}

/** Learned calibration passed into the pure planner (loaded in buildPlanInput). */
export interface PlanLearned {
  enabled: boolean;
  multipliers: { global: { value: number; weight: number }; byProject: Record<string, { value: number; weight: number }> };
  hourSuccess: { rates: number[]; totalWeight: number };
}

export interface PlanInput {
  nowUtc: string;
  timezone: string;
  horizonDays: number;
  granularityMin: number;
  bufferMin: number;
  splitEnabled: boolean;
  maxChunkMin: number;
  minChunkMin: number;
  chunkGapPolicy: 'same_day' | 'spread';
  energy: {
    mode: 'off' | 'chronotype' | 'custom';
    windows: EnergyWindows;
    deepWorkMinMin: number;
    deepLabel: string;
    shallowLabel: string;
  };
  learned: PlanLearned;
  workingHours: WorkingHours;
  /** External busy + immovable blocks (locked / in-progress), UTC ISO. */
  busy: { startUtc: string; endUtc: string }[];
  tasks: PlanTaskInput[];
  habits: PlanHabitInput[];
  /** true on poll cycles (keep valid placements); false on Recalculate (clean repack). */
  sticky: boolean;
  /** Per-day task-minutes budget as a fraction of that day's working-hour capacity; null = unbounded (packed). Habits/external events don't count against it. */
  dayBudget: { maxTaskFraction: number } | null;
}

export interface DesiredBlock {
  /** task:<taskId>:<chunk> | habit:<habitId>:<localDate> */
  key: string;
  taskId?: string;
  habitId?: string;
  habitName?: string;
  date?: string;
  startUtc: string;
  endUtc: string;
  /** "Why this slot" notes — never part of the diff/hash, so they never cause Google churn. */
  reasons: BlockReason[];
  /** Present when the task was split; index is 0-based, count is total chunks. */
  chunk?: { index: number; count: number };
}

export interface PlanResult {
  blocks: DesiredBlock[];
  atRisk: string[]; // task ids placed after (or already past) their deadline
  unplaceable: string[]; // task ids with no free slot in the horizon
  risks: import('./feasibility.js').TaskRisk[]; // structured deadline/capacity warnings (Phase 2+)
  dayLoads: import('./feasibility.js').DayLoad[]; // per-day capacity vs committed (Phase 2+)
}
