import { z } from 'zod';

// ---------- Settings ----------

export const HHMM = /^\d{2}:\d{2}$/;

export const TimeRangeSchema = z.object({
  start: z.string().regex(HHMM),
  end: z.string().regex(HHMM),
});
export type TimeRange = z.infer<typeof TimeRangeSchema>;

export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export const WorkingHoursSchema = z.object({
  mon: z.array(TimeRangeSchema),
  tue: z.array(TimeRangeSchema),
  wed: z.array(TimeRangeSchema),
  thu: z.array(TimeRangeSchema),
  fri: z.array(TimeRangeSchema),
  sat: z.array(TimeRangeSchema),
  sun: z.array(TimeRangeSchema),
});
export type WorkingHours = z.infer<typeof WorkingHoursSchema>;

/** A named energy band within a day: peak = deep-focus time, low = shallow-work time. */
export const EnergyRangeSchema = z.object({
  start: z.string().regex(HHMM),
  end: z.string().regex(HHMM),
  level: z.enum(['peak', 'low']),
});
export type EnergyRange = z.infer<typeof EnergyRangeSchema>;

export const EnergyWindowsSchema = z.object({
  mon: z.array(EnergyRangeSchema),
  tue: z.array(EnergyRangeSchema),
  wed: z.array(EnergyRangeSchema),
  thu: z.array(EnergyRangeSchema),
  fri: z.array(EnergyRangeSchema),
  sat: z.array(EnergyRangeSchema),
  sun: z.array(EnergyRangeSchema),
});
export type EnergyWindows = z.infer<typeof EnergyWindowsSchema>;

export const EMPTY_ENERGY_WINDOWS: EnergyWindows = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };

export const SettingsSchema = z.object({
  timezone: z.string(),
  workingHours: WorkingHoursSchema,
  defaultDurationMin: z.number().int().min(5).max(480),
  bufferMin: z.number().int().min(0).max(120),
  granularityMin: z.number().int().min(5).max(60),
  horizonDays: z.number().int().min(1).max(60),
  /** Split tasks longer than maxChunkMin into multiple sittings. */
  splitEnabled: z.boolean(),
  maxChunkMin: z.number().int().min(15).max(480),
  minChunkMin: z.number().int().min(15).max(480),
  /** same_day: pack a task's chunks back-to-back; spread: one chunk per day. */
  chunkGapPolicy: z.enum(['same_day', 'spread']),
  /** off: ignore energy; chronotype: use a preset; custom: use energyWindows. */
  energyMode: z.enum(['off', 'chronotype', 'custom']),
  chronotype: z.enum(['morning', 'balanced', 'evening']),
  energyWindows: EnergyWindowsSchema,
  /** A task counts as "deep work" at or above this duration (or by priority/label). */
  deepWorkMinMin: z.number().int().min(15).max(480),
  deepLabel: z.string(),
  shallowLabel: z.string(),
  /** Learn duration calibration + best hours from what you complete vs miss. */
  learningEnabled: z.boolean(),
  onTaskCompleted: z.enum(['rename', 'delete']),
  onBlockDeleted: z.enum(['reschedule', 'unschedule']),
  /** When you drag a scheduled block in Google Calendar, also move the task's due date to match. */
  updateDueOnMove: z.boolean(),
  autoRescheduleMissed: z.boolean(),
  /** due_only: schedule tasks that have a due date (or were force-scheduled); all: schedule everything */
  schedulePolicy: z.enum(['due_only', 'all']),
  /** off: the planner only drafts proposals for review; full: auto-apply every cycle like before. */
  autoApply: z.enum(['off', 'full']),
  /** How ambitiously the planner fills a day with tasks (habits/external events don't count against this). */
  dayFullness: z.enum(['light', 'balanced', 'packed']),
  busyCalendarIds: z.array(z.string()),
  appCalendarId: z.string().nullable(),
  aiEnabled: z.boolean(),
  aiModel: z.string(),
  /** Master switch for XP/levels/streaks/achievements. */
  gamificationEnabled: z.boolean(),
  /** one_block: any completed block/habit holds the streak; half_planned: need >=50% of planned blocks done. */
  streakRule: z.enum(['one_block', 'half_planned']),
  celebrationToasts: z.boolean(),
  /** UI sound effects: completion chime, reminder ping, level-up fanfare, focus-timer done. */
  soundEffects: z.boolean(),
  /** Second Brain vault folder, absolute path. null = default `data/vault`. */
  notesVaultPath: z.string().nullable(),
  /** Days a deleted note sits in `.trash` before it's eligible for auto-purge. */
  notesTrashRetentionDays: z.number().int().min(1).max(365),
  /** Snapshots kept per note (written before each overwrite) before the oldest is pruned. */
  notesSnapshotRetention: z.number().int().min(0).max(200),
  /** Vault-relative folder daily notes are created in, e.g. "Daily". */
  notesDailyFolder: z.string().min(1),
  /** Vault-relative folder templates are read from, e.g. "Templates". A file named "Daily.md" in here overrides the built-in daily-note template. */
  notesTemplatesFolder: z.string().min(1),
  /** Vault-relative folder weekly digests are written to, e.g. "Digests". */
  notesDigestFolder: z.string().min(1),
  /** System-prompt seed for Vault Chat — who you are, so answers are framed the way you'd want. */
  aiAboutMe: z.string(),
  /** Embedding model used for the Second Brain semantic index. `auto` selects a provider-appropriate default. */
  aiEmbeddingModel: z.string().min(1),
  /** Graph: min cosine similarity for a semantic edge between two notes. */
  graphSemanticThreshold: z.number().min(0).max(1),
  /** Graph: max semantic edges kept per note (top-K by similarity), 0 disables the layer. */
  graphSemanticTopK: z.number().int().min(0).max(20),
  /** Graph: min number of shared tags for a tag-co-occurrence edge. */
  graphTagCoocMin: z.number().int().min(1).max(10),
  /** Graph: a node untouched for this many days fades to minimum opacity (freshness encoding). */
  graphFreshnessFadeDays: z.number().int().min(1).max(3650),
  /** Graph: min cosine similarity for a note pair to be proposed as a suggested [[wikilink]] (G6 §7 ghost edges). */
  graphSuggestThreshold: z.number().min(0).max(1),
});
export type Settings = z.infer<typeof SettingsSchema>;
export type StreakRule = Settings['streakRule'];

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  mon: [{ start: '09:00', end: '17:00' }],
  tue: [{ start: '09:00', end: '17:00' }],
  wed: [{ start: '09:00', end: '17:00' }],
  thu: [{ start: '09:00', end: '17:00' }],
  fri: [{ start: '09:00', end: '17:00' }],
  sat: [],
  sun: [],
};

export const DEFAULT_SETTINGS: Settings = {
  timezone: 'UTC', // replaced with the OS timezone on first boot
  workingHours: DEFAULT_WORKING_HOURS,
  defaultDurationMin: 30,
  bufferMin: 15,
  granularityMin: 15,
  horizonDays: 14,
  splitEnabled: true,
  maxChunkMin: 90,
  minChunkMin: 30,
  chunkGapPolicy: 'same_day',
  energyMode: 'off',
  chronotype: 'balanced',
  energyWindows: EMPTY_ENERGY_WINDOWS,
  deepWorkMinMin: 60,
  deepLabel: 'deep',
  shallowLabel: 'shallow',
  learningEnabled: true,
  onTaskCompleted: 'rename',
  onBlockDeleted: 'reschedule',
  updateDueOnMove: false,
  autoRescheduleMissed: true,
  schedulePolicy: 'due_only',
  autoApply: 'off',
  dayFullness: 'balanced',
  busyCalendarIds: [],
  appCalendarId: null,
  aiEnabled: true,
  aiModel: 'gemini-3.5-flash-lite',
  gamificationEnabled: true,
  streakRule: 'one_block',
  celebrationToasts: true,
  soundEffects: true,
  notesVaultPath: null,
  notesTrashRetentionDays: 30,
  notesSnapshotRetention: 20,
  notesDailyFolder: 'Daily',
  notesTemplatesFolder: 'Templates',
  notesDigestFolder: 'Digests',
  aiAboutMe:
    'Software engineering student and game developer (Unity/C#), also works with web stacks. Juggles university, a co-op placement, side projects, community leadership, and content creation. Notes mix project logs, university material, game design ideas, career/job-hunt notes, and daily planning — in both Arabic and English. Prefers direct, practical answers and step-by-step breakdowns.',
  aiEmbeddingModel: 'auto',
  graphSemanticThreshold: 0.78,
  graphSemanticTopK: 5,
  graphTagCoocMin: 1,
  graphFreshnessFadeDays: 45,
  graphSuggestThreshold: 0.82,
};

// ---------- Habits ----------

export const HabitInputSchema = z.object({
  name: z.string().min(1),
  durationMin: z.number().int().min(5).max(480),
  /** weekdays the habit recurs on; all 7 = daily */
  days: z.array(z.enum(WEEKDAY_KEYS)).min(1),
  preferredStart: z.string().regex(HHMM).nullable(),
  windowStart: z.string().regex(HHMM),
  windowEnd: z.string().regex(HHMM),
  priority: z.number().int().min(1).max(4),
  kind: z.enum(['habit', 'learning']),
  /** learning goals: extra sessions are added until this many minutes/week are planned */
  weeklyTargetMin: z.number().int().positive().nullable(),
  notes: z.string(),
  active: z.boolean(),
});
export type HabitInput = z.infer<typeof HabitInputSchema>;

/** Per-day status of one habit across the current week (Mon–Sun). */
export interface HabitWeekDay {
  /** local date YYYY-MM-DD */
  date: string;
  /**
   * off = not scheduled that weekday; missed = scheduled in the past with no
   * completion recorded (matches the streak rule); upcoming = scheduled later
   * this week.
   */
  status: 'done' | 'skipped' | 'missed' | 'pending' | 'upcoming' | 'off';
}

export interface HabitDTO extends HabitInput {
  id: string;
  /** planned/done/missed counts for the current week */
  weekPlannedMin: number;
  weekDoneMin: number;
  streakDays: number;
  /** today's occurrence status; null when the habit isn't scheduled today */
  todayStatus: 'pending' | 'done' | 'skipped' | 'missed' | null;
  /** Mon–Sun of the current week */
  weekHistory: HabitWeekDay[];
}

// ---------- Objectives ----------

export const ObjectiveInputSchema = z.object({
  /** local Monday date YYYY-MM-DD */
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1),
  targetMinutes: z.number().int().positive().nullable(),
  targetCount: z.number().int().positive().nullable(),
  linkKind: z.enum(['project', 'label', 'habit']).nullable(),
  linkValue: z.string().nullable(),
  notes: z.string(),
});
export type ObjectiveInput = z.infer<typeof ObjectiveInputSchema>;

export const ObjectivePatchSchema = ObjectiveInputSchema.extend({
  status: z.enum(['active', 'done', 'dropped']),
  manualMinutes: z.number().int().min(0),
  manualCount: z.number().int().min(0),
}).partial();
export type ObjectivePatch = z.infer<typeof ObjectivePatchSchema>;

export interface ObjectiveDTO extends ObjectiveInput {
  id: string;
  status: 'active' | 'done' | 'dropped';
  /** total progress: link-derived + manually logged */
  progressMinutes: number;
  plannedMinutes: number;
  progressCount: number;
  /** manually logged portion of the totals above */
  manualMinutes: number;
  manualCount: number;
}

// ---------- Goals (quarterly SMART goals) ----------

export const GoalInputSchema = z.object({
  title: z.string().min(1), // Specific
  description: z.string(),
  targetValue: z.number().int().positive().nullable(), // Measurable
  targetUnit: z.string().nullable(),
  achievable: z.string(), // Achievable rationale
  relevance: z.string(), // Relevant — why it matters
  year: z.number().int().min(2020).max(2100), // Time-bound
  quarter: z.number().int().min(1).max(4),
  customDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  linkKind: z.enum(['project', 'label']).nullable(),
  linkValue: z.string().nullable(),
});
export type GoalInput = z.infer<typeof GoalInputSchema>;

export const GoalMilestoneInputSchema = z.object({ title: z.string().min(1) });
export type GoalMilestoneInput = z.infer<typeof GoalMilestoneInputSchema>;

export interface GoalMilestoneDTO {
  id: string;
  goalId: string;
  title: string;
  done: boolean;
  sortOrder: number;
  completedAtUtc: string | null;
}

export type GoalStatus = 'active' | 'achieved' | 'dropped';

export interface GoalDTO extends GoalInput {
  id: string;
  status: GoalStatus;
  currentValue: number;
  createdAtUtc: string | null;
  milestones: GoalMilestoneDTO[];
  // server-computed
  progressMinutes: number;
  plannedMinutes: number;
  progressCount: number;
  /** resolved deadline: customDeadline ?? quarter end, YYYY-MM-DD */
  deadline: string;
  daysRemaining: number;
  /** 0..100, elapsed share of the quarter-start -> deadline window */
  periodElapsedPct: number;
}

// ---------- Task manager: projects, labels, tasks, attachments, reminders ----------

export const TaskStatusSchema = z.enum(['backlog', 'todo', 'in_progress', 'done', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/** How hard a task is. Feeds the scheduler's energy matching: hard => deep work (prefers peak-focus windows), easy => shallow (prefers low-energy windows), medium => existing heuristic. */
export const TaskDifficultySchema = z.enum(['easy', 'medium', 'hard']);
export type TaskDifficulty = z.infer<typeof TaskDifficultySchema>;

export const TaskLinkSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
});
export type TaskLink = z.infer<typeof TaskLinkSchema>;

export const TaskInputSchema = z.object({
  content: z.string().min(1),
  description: z.string().optional(),
  projectId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  priority: z.number().int().min(1).max(4).optional(),
  dueDate: z.string().nullable().optional(),
  dueDatetimeUtc: z.string().nullable().optional(),
  durationMin: z.number().int().positive().nullable().optional(),
  difficulty: TaskDifficultySchema.nullable().optional(),
  labels: z.array(z.string()).optional(),
  links: z.array(TaskLinkSchema).optional(),
  color: z.string().nullable().optional(),
  status: TaskStatusSchema.optional(),
  skipScheduling: z.boolean().optional(),
  /** local YYYY-MM-DD — "picked for today/tomorrow" in the Plan Day ritual. */
  plannedForDate: z.string().nullable().optional(),
  /** Favorited — surfaced in the sidebar's Favorites section. */
  pinned: z.boolean().optional(),
});
export type TaskInput = z.infer<typeof TaskInputSchema>;

export const TaskPatchSchema = TaskInputSchema.partial();
export type TaskPatch = z.infer<typeof TaskPatchSchema>;

/** New order for a set of sibling tasks (same parent); sortOrder is set to array index. */
export const TaskReorderSchema = z.object({
  ids: z.array(z.string()).min(1),
});
export type TaskReorderInput = z.infer<typeof TaskReorderSchema>;

// ---------- Task dependencies (ordering constraints) ----------

/** Add a "must finish before" edge: the task being patched can't be scheduled until `blockerId` is done. */
export const DependencyInputSchema = z.object({
  blockerId: z.string().min(1),
});
export type DependencyInput = z.infer<typeof DependencyInputSchema>;

/** Lightweight reference to another task, used in dependency lists so the panel doesn't pull a full TaskDTO. */
export interface TaskRefDTO {
  id: string;
  content: string;
  status: TaskStatus;
}

/** Where a task currently sits relative to the scheduler, mirrored on TaskViewDTO and TaskDTO. */
export type TaskScheduleView = 'unscheduled' | 'at_risk' | 'unplaceable' | 'missed' | 'scheduled';

export interface TaskDTO {
  id: string;
  content: string;
  description: string;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  parentId: string | null;
  priority: number;
  dueDate: string | null;
  dueDatetimeUtc: string | null;
  durationMin: number | null;
  difficulty: TaskDifficulty | null;
  labels: string[];
  links: TaskLink[];
  color: string | null;
  status: TaskStatus;
  skipScheduling: boolean;
  forceSchedule: boolean;
  plannedForDate: string | null;
  sortOrder: number;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  subtaskCount: number;
  subtaskDoneCount: number;
  attachmentCount: number;
  reminderCount: number;
  blockStart: string | null;
  scheduledMin: number;
  view: TaskScheduleView | null;
  /** True while any dependency this task waits on isn't done/cancelled yet — the scheduler won't place it. */
  isBlocked: boolean;
  /** Favorited — surfaced in the sidebar's Favorites section. */
  pinned: boolean;
}

export interface TaskDetailDTO extends TaskDTO {
  children: TaskDTO[];
  attachments: AttachmentDTO[];
  reminders: ReminderDTO[];
  /** Tasks that must finish before this one can be scheduled. */
  dependsOn: TaskRefDTO[];
  /** Tasks waiting on this one. */
  blocks: TaskRefDTO[];
}

export const ProjectInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  color: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  archived: z.boolean().optional(),
  /** Favorited — surfaced in the sidebar's Favorites section. */
  pinned: z.boolean().optional(),
});
export type ProjectInput = z.infer<typeof ProjectInputSchema>;

export interface ProjectDetailDTO {
  id: string;
  name: string;
  description: string;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  archived: boolean;
  createdAt: string | null;
  taskCount: number;
  doneCount: number;
  /** Favorited — surfaced in the sidebar's Favorites section. */
  pinned: boolean;
}

export const LabelInputSchema = z.object({
  name: z.string().min(1),
  color: z.string().nullable().optional(),
});
export type LabelInput = z.infer<typeof LabelInputSchema>;

export interface LabelDTO {
  id: string;
  name: string;
  color: string | null;
  taskCount: number;
}

export interface AttachmentDTO {
  id: string;
  taskId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string | null;
}

export const ReminderInputSchema = z.object({
  remindAtUtc: z.string(),
  message: z.string().optional(),
});
export type ReminderInput = z.infer<typeof ReminderInputSchema>;

export interface ReminderDTO {
  id: string;
  taskId: string;
  remindAtUtc: string;
  message: string;
  firedAt: string | null;
  createdAt: string | null;
}

export interface ReminderFiredEventDTO {
  reminderId: string;
  taskId: string;
  taskContent: string;
  message: string;
  remindAtUtc: string;
}

// ---------- Calendar events (meetings) ----------

/**
 * A native, fixed-time calendar entry (meeting/appointment). Unlike tasks, events
 * are never moved by the scheduler and never appear in the task work-lists — they
 * are commitments you place directly on the calendar.
 */
export const EventInputSchema = z.object({
  title: z.string().min(1),
  startUtc: z.string(),
  endUtc: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  /** Video/meeting join link; empty string clears it. */
  meetingUrl: z.string().optional(),
  color: z.string().nullable().optional(),
  priority: z.number().int().min(1).max(4).optional(),
  difficulty: TaskDifficultySchema.nullable().optional(),
  /** Fire a reminder this many minutes before it starts; null = no reminder. */
  reminderMinutesBefore: z.number().int().min(0).max(10080).nullable().optional(),
});
export type EventInput = z.infer<typeof EventInputSchema>;

export const EventPatchSchema = EventInputSchema.partial();
export type EventPatch = z.infer<typeof EventPatchSchema>;

export interface EventDTO {
  id: string;
  title: string;
  description: string;
  location: string;
  meetingUrl: string | null;
  color: string | null;
  priority: number;
  difficulty: TaskDifficulty | null;
  startUtc: string;
  endUtc: string;
  reminderMinutesBefore: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// ---------- Schedule / tasks ----------

/** Machine code for a placement rationale, mapped to a human label in the engine. */
export type ReasonCode =
  | 'earliest_fit'
  | 'sticky'
  | 'preferred_start'
  | 'habit_window'
  | 'weekly_target'
  | 'deadline_pressure'
  | 'deadline_missed'
  | 'picked_today'
  | 'pinned'
  | 'over_budget'
  | 'energy_match'
  | 'learned_hour'
  | 'learned_duration'
  | 'batching'
  | 'chunk'
  | 'objective_boost'
  | 'forecast_risk';

/** A single human-readable "why this slot" note attached to a scheduled block. */
export interface BlockReason {
  code: ReasonCode;
  label: string;
  detail?: string;
}

export interface ScheduleItemDTO {
  id: string;
  kind: 'task' | 'habit' | 'external' | 'event';
  title: string;
  start: string; // UTC ISO
  end: string;
  status?: 'pending_create' | 'scheduled' | 'done' | 'missed' | 'cancelled';
  locked?: boolean;
  taskId?: string;
  habitId?: string;
  /** Set on `kind: 'event'` items — the native event's id. */
  eventId?: string;
  projectName?: string;
  projectColor?: string | null;
  color?: string | null;
  links?: TaskLink[];
  /** Free-text location (events). */
  location?: string | null;
  /** Video/meeting join link (events). */
  meetingUrl?: string | null;
  /** Notes/agenda (events). */
  description?: string | null;
  editable: boolean;
  /** Priority 1..4 (4 = P1/urgent). Tasks & events. */
  priority?: number;
  /** Difficulty. Tasks & events. */
  difficulty?: TaskDifficulty | null;
  /** Task due date (local YYYY-MM-DD), if any. */
  dueDate?: string | null;
  /** "Why this slot" notes emitted by the scheduler (Phase 1+). */
  reasons?: BlockReason[];
  /** Part i of n when a task was split into chunks (Phase 3+). */
  chunk?: { index: number; count: number };
  /** True when the latest plan flagged this block's task as at-risk (Phase 2+). */
  atRisk?: boolean;
}

export interface TaskViewDTO {
  id: string;
  content: string;
  priority: number; // 1..4 (4 = P1/urgent)
  dueDate: string | null;
  dueDatetimeUtc: string | null;
  durationMin: number;
  projectName: string | null;
  labels: string[];
  links: TaskLink[];
  color: string | null;
  status: TaskStatus;
  view: TaskScheduleView;
  blockStart: string | null;
  isBlocked: boolean;
}

// ---------- Sync status ----------

/** Why a task is in trouble — surfaced proactively on the Today page (Phase 2+). */
export type PlanWarningKind = 'past_deadline' | 'placed_after_deadline' | 'capacity_shortfall' | 'unplaceable';

export interface PlanWarningDTO {
  kind: PlanWarningKind;
  taskId: string;
  taskContent?: string;
  deadline?: string; // UTC ISO
  shortfallMin?: number;
  date?: string; // local date the crunch falls on
}

export interface ScheduleRunDTO {
  ranAt: string;
  trigger: string;
  created: number;
  moved: number;
  deleted: number;
  atRisk: string[]; // task ids
  unplaceable: string[]; // task ids
  warnings?: PlanWarningDTO[];
}

/** Whether the planner's desired state matches the calendar, or a draft/drift needs review. */
export type ScheduleSyncState = 'in_sync' | 'drift' | 'proposal_pending';

export interface SyncStatusDTO {
  googleAuthed: boolean;
  appCalendarReady: boolean;
  /** True when Google is unreachable (no internet). Sync is paused and auto-resumes; not an error. */
  offline: boolean;
  running: boolean;
  lastCycleAt: string | null;
  lastGooglePullAt: string | null;
  lastError: string | null;
  lastRun: ScheduleRunDTO | null;
  recentLog: { ts: string; source: string; kind: string; detail: string }[];
  schedule: {
    state: ScheduleSyncState;
    driftCreated: number;
    driftMoved: number;
    driftDeleted: number;
    proposalId: string | null;
    lastAppliedAt: string | null;
  };
}

// ---------- Plan proposals (propose -> approve scheduling) ----------

export type ProposalItemChange = 'new' | 'moved' | 'unchanged' | 'removed';
export type ProposalStatus = 'draft' | 'applied' | 'discarded' | 'stale';

export interface ProposalItemDTO {
  key: string;
  taskId?: string;
  habitId?: string;
  title: string;
  start: string; // UTC ISO
  end: string;
  prevStart?: string;
  prevEnd?: string;
  change: ProposalItemChange;
  reasons: BlockReason[];
  chunk?: { index: number; count: number };
  /** local YYYY-MM-DD this item falls on, for day-grouping in the review UI */
  date: string;
}

/** Why a task surfaced as a Plan Day candidate. */
export type CandidateReason = 'due_today' | 'overdue' | 'missed' | 'picked' | 'suggested';

export interface ProposalCandidateDTO {
  taskId: string;
  content: string;
  priority: number;
  dueDate: string | null;
  durationMin: number;
  reason: CandidateReason;
  /** true when the task is currently plannedForDate === scopeDate (already picked for this day). */
  picked: boolean;
}

export interface ProposalDTO {
  id: string;
  createdAt: string;
  status: ProposalStatus;
  /** the day the ritual/proposal focused on (today or tomorrow) */
  scopeDate: string;
  summary: { created: number; moved: number; deleted: number; unchanged: number };
  items: ProposalItemDTO[];
  notScheduled: { taskId: string; content?: string; kind: PlanWarningKind }[];
  warnings: PlanWarningDTO[];
  dayLoads: { date: string; capacityMin: number; committedMin: number }[];
  /** Plan Day ritual triage pool for scopeDate — due/overdue/missed/already-picked + top backlog. */
  candidates: ProposalCandidateDTO[];
}

/** Body for POST /plan/proposal/:id/refine. */
export interface ProposalRefineInput {
  /** DesiredBlock keys to freeze in place for this draft (accumulates — no unpin yet). */
  pins?: string[];
  /** Task ids to drop from this draft only (accumulates — not persisted as skipScheduling). */
  rejectTaskIds?: string[];
  /** Task ids to pick for the proposal's scopeDate (sets tasks.plannedForDate). */
  pickTaskIds?: string[];
  /** Task ids to unpick — clears plannedForDate if it still equals this draft's scopeDate. */
  unpickTaskIds?: string[];
}

export interface SetupStatusDTO {
  googleCredsPresent: boolean;
  google: boolean;
  calendarChosen: boolean;
}

// ---------- Today / analytics ----------

export interface TodayPlanDTO {
  date: string; // local date
  timezone: string;
  now: string;
  capacityMin: number; // remaining working minutes today
  plannedMin: number; // remaining planned block minutes today
  overloaded: boolean;
  /** Count of non-deleted tasks due today (regardless of whether they've been time-blocked). */
  dueTodayCount: number;
  /** Of dueTodayCount, how many are marked done. */
  dueTodayDoneCount: number;
  /** true once today's Plan Day ritual has been confirmed (a proposal was applied today). */
  plannedToday: boolean;
  blocks: ScheduleItemDTO[];
  missedYesterday: TaskViewDTO[];
  missedToday: TaskViewDTO[];
  tomorrow: ScheduleItemDTO[];
  objectives: ObjectiveDTO[];
  /** Proactive deadline/capacity warnings from the latest plan (Phase 2+). */
  warnings: PlanWarningDTO[];
  /** Task ids the latest plan flagged as at-risk (drives the amber ring). */
  atRiskTaskIds: string[];
}

export interface AnalyticsDailyDTO {
  date: string;
  plannedMin: number;
  completedMin: number;
  missedMin: number;
  externalBusyMin: number;
  byProject: Record<string, { planned: number; done: number }>;
  byLabel: Record<string, { planned: number; done: number }>;
  byHabit: Record<string, { planned: number; done: number }>;
}

export interface WeeklyAnalyticsDTO {
  weekStart: string;
  days: AnalyticsDailyDTO[];
  totals: { plannedMin: number; completedMin: number; missedMin: number; externalBusyMin: number };
  byProject: Record<string, { planned: number; done: number }>;
}

export interface BriefDTO {
  id: number;
  date: string;
  createdAt: string;
  content: string;
}

export interface LearningStatsDTO {
  enabled: boolean;
  globalMultiplier: number;
  globalWeight: number;
  bestHours: { hour: number; rate: number }[];
  worstHours: { hour: number; rate: number }[];
  hourWeight: number;
}

export interface ProjectDTO {
  id: string;
  name: string;
}

export interface CalendarListEntryDTO {
  id: string;
  summary: string;
  primary: boolean;
}

// ---------- Daily rituals: highlight + shutdown ----------

/** A live snapshot of the day's block outcomes, shown during the shutdown flow. */
export interface DailySummary {
  doneCount: number;
  missedCount: number;
  /** blocks still scheduled/pending (not yet done or missed) */
  remainingCount: number;
  /** every block that fell on the day: done + missed + remaining */
  plannedCount: number;
  completedMin: number;
  plannedMin: number;
}

export const DailyHighlightSchema = z.object({
  highlight: z.string().max(280).optional(),
  highlightTaskId: z.string().nullable().optional(),
  highlightDone: z.boolean().optional(),
});
export type DailyHighlightInput = z.infer<typeof DailyHighlightSchema>;

export const DailyShutdownSchema = z.object({
  reflection: z.string().max(4000),
  rating: z.number().int().min(1).max(5).nullable(),
  intention: z.string().max(2000),
});
export type DailyShutdownInput = z.infer<typeof DailyShutdownSchema>;

export interface DailyPlanDTO {
  date: string; // local YYYY-MM-DD
  highlight: string;
  highlightTaskId: string | null;
  highlightDone: boolean;
  reflection: string;
  rating: number | null;
  intention: string;
  /** UTC ISO when the day was shut down, or null if the ritual isn't done yet. */
  shutdownDoneAt: string | null;
  summary: DailySummary;
}

// ---------- Weekly review ----------

export const WeeklyReviewSchema = z.object({
  wins: z.string().max(4000),
  challenges: z.string().max(4000),
  nextWeekFocus: z.string().max(4000),
  rating: z.number().int().min(1).max(5).nullable(),
});
export type WeeklyReviewInput = z.infer<typeof WeeklyReviewSchema>;

export interface WeeklyReviewSummary {
  plannedMin: number;
  completedMin: number;
  missedMin: number;
  /** completedMin / plannedMin, 0..1 (0 when nothing was planned) */
  completionRate: number;
  objectivesDone: number;
  objectivesTotal: number;
  /** days in the week the streak rule counted as "met" */
  daysMet: number;
  /** days in the week that have been evaluated (non-rest) */
  daysEvaluated: number;
}

export interface WeeklyReviewDTO {
  weekStart: string; // local Monday YYYY-MM-DD
  wins: string;
  challenges: string;
  nextWeekFocus: string;
  rating: number | null;
  /** UTC ISO when the review was completed, or null. */
  reviewedAt: string | null;
  summary: WeeklyReviewSummary;
  objectives: ObjectiveDTO[];
}

// ---------- Gamification ----------

export type XpEventKind =
  | 'block_done'
  | 'habit_done'
  | 'streak_day'
  | 'achievement'
  | 'freeze_purchase'
  | 'backfill'
  | 'shutdown'
  | 'weekly_review';

export interface XpEventDTO {
  seq: number;
  kind: XpEventKind;
  amount: number;
  dateLocal: string;
  title?: string;
  achievementId?: string;
  createdAt: string;
}

export interface AchievementDTO {
  id: string;
  name: string;
  description: string;
  icon: string;
  xp: number;
  unlockedAt: string | null;
}

export type DayResultKind = 'met' | 'freeze' | 'missed' | 'rest';

export interface DayResultDTO {
  date: string;
  result: DayResultKind;
  doneCount: number;
  missedCount: number;
  plannedCount: number;
  streakAfter: number;
}

export interface GamificationSummaryDTO {
  enabled: boolean;
  totalXp: number;
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  streak: {
    current: number;
    longest: number;
    freezes: number;
    todayMet: boolean;
    todayCounts: { done: number; missed: number; planned: number };
  };
  latestSeq: number;
  recentAchievements: AchievementDTO[];
}

// ---------- Whiteboards ----------

/** A named whiteboard canvas, browsable/switchable from the board sidebar. */
export interface BoardDTO {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string | null;
  updatedAt: string | null;
  /** Set only when returned from a search query and the match came from canvas text (not the name). */
  matchSnippet?: string | null;
}

export const BoardInputSchema = z.object({
  name: z.string().min(1),
});
export type BoardInput = z.infer<typeof BoardInputSchema>;

export const BoardPatchSchema = z.object({
  name: z.string().min(1).optional(),
  sortOrder: z.number().optional(),
});
export type BoardPatch = z.infer<typeof BoardPatchSchema>;

/**
 * The Excalidraw scene for a board. `elements`/`appState` are kept as `unknown` here
 * so the shared package (used by both server and web) doesn't depend on Excalidraw's types.
 */
export interface BoardSceneDTO {
  elements: unknown[];
  appState: Record<string, unknown>;
}

export const BoardSceneInputSchema = z.object({
  elements: z.array(z.unknown()),
  appState: z.record(z.string(), z.unknown()),
});
export type BoardSceneInput = z.infer<typeof BoardSceneInputSchema>;

/** A binary file (image) pasted onto a board, sent/received as a base64 data URL. */
export interface BoardFileDTO {
  id: string;
  mimeType: string;
  dataUrl: string;
}

export const BoardFileInputSchema = z.object({
  id: z.string().min(1),
  mimeType: z.string().min(1),
  dataUrl: z.string().min(1),
});
export type BoardFileInput = z.infer<typeof BoardFileInputSchema>;

// ---------- Voice capture ----------

export const VoiceIntentSchema = z.enum(['task', 'note', 'unknown']);
export type VoiceIntent = z.infer<typeof VoiceIntentSchema>;

export const VoiceTaskDraftSchema = z.object({
  content: z.string().min(1),
  description: z.string(),
  projectId: z.string().nullable(),
  priority: z.number().int().min(1).max(4).nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  dueDatetimeUtc: z.string().datetime({ offset: true }).nullable(),
  durationMin: z.number().int().min(5).max(480).nullable(),
  difficulty: TaskDifficultySchema.nullable(),
  labels: z.array(z.string()),
});
export type VoiceTaskDraft = z.infer<typeof VoiceTaskDraftSchema>;

export const VoiceNoteDraftSchema = z.object({
  title: z.string().min(1),
  /** Cleaned Markdown body without a duplicate top-level title. */
  body: z.string().min(1),
});
export type VoiceNoteDraft = z.infer<typeof VoiceNoteDraftSchema>;

export const VoiceInterpretationSchema = z.object({
  transcript: z.string().min(1),
  language: z.string().min(1),
  intent: VoiceIntentSchema,
  task: VoiceTaskDraftSchema.nullable(),
  note: VoiceNoteDraftSchema.nullable(),
  warnings: z.array(z.string()),
});
export type VoiceInterpretationDTO = z.infer<typeof VoiceInterpretationSchema>;

// ---------- Notes (Second Brain vault) ----------

/**
 * A markdown note in the vault. `id` is the vault-relative path (forward-slash
 * separated, e.g. "Projects/Foo.md") — the file itself is the identity, per the
 * files-first principle. The SQLite `notes` table is just a rebuildable cache.
 */
export interface NoteSummaryDTO {
  id: string;
  title: string;
  tags: string[];
  pinned: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface NoteDTO extends NoteSummaryDTO {
  /** Raw file content, frontmatter included verbatim — never parsed apart from the editable text. */
  content: string;
}

export const NoteCreateSchema = z.object({
  /** Vault-relative path; ".md" is appended if missing. */
  path: z.string().min(1),
  content: z.string().optional(),
});
export type NoteCreateInput = z.infer<typeof NoteCreateSchema>;

export const NoteSaveSchema = z.object({
  content: z.string(),
  /** The updatedAt the client last loaded — mismatch means someone else saved first (stale-write conflict). */
  expectedUpdatedAt: z.string().nullable().optional(),
});
export type NoteSaveInput = z.infer<typeof NoteSaveSchema>;

export const NoteMoveSchema = z.object({
  /** New vault-relative path (rename and/or move — same operation). */
  path: z.string().min(1),
});
export type NoteMoveInput = z.infer<typeof NoteMoveSchema>;

export interface NoteConflictDTO {
  error: 'conflict';
  serverContent: string;
  serverUpdatedAt: string | null;
}

export interface BacklinkDTO {
  id: string;
  title: string;
  snippet: string;
}

export interface UnlinkedMentionDTO {
  id: string;
  title: string;
  snippet: string;
}

export interface OutgoingLinkDTO {
  /** The raw `[[Target]]` text. */
  title: string;
  /** Resolved note id, or null if no note with that title exists yet. */
  id: string | null;
}

export interface NoteDetailDTO extends NoteDTO {
  backlinks: BacklinkDTO[];
  unlinkedMentions: UnlinkedMentionDTO[];
  outgoingLinks: OutgoingLinkDTO[];
}

export interface NoteSearchResultDTO {
  id: string;
  title: string;
  snippet: string;
  /** How this result was found. "both" ranks highest — keyword and meaning agree. */
  matchType: 'keyword' | 'semantic' | 'both';
}

export interface RelatedNoteDTO {
  id: string;
  title: string;
  /** Cosine similarity, 0..1, between the open note and this one's closest chunk. */
  score: number;
}

export const NoteChatSchema = z.object({
  message: z.string().min(1),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    )
    .optional(),
});
export type NoteChatInput = z.infer<typeof NoteChatSchema>;

export interface NoteChatCitationDTO {
  id: string;
  title: string;
}

export interface NoteChatResponseDTO {
  answer: string;
  citations: NoteChatCitationDTO[];
  /** G4 (GraphRAG): 'local' = retrieved matching notes + their 1-hop neighbourhood; 'global' = answered from community summaries. */
  scope: 'local' | 'global';
  /** G4: note ids of the retrieved subgraph — the client flies the graph to and highlights these ("spatial citations"). */
  focusNoteIds: string[];
}

export interface NoteSuggestionsDTO {
  /** Suggested wikilink targets — existing note titles or new ones, never auto-inserted. */
  links: string[];
  /** Suggested #tags, without the leading "#". */
  tags: string[];
}

/** person / project / technology / idea — the categories the concept extractor assigns (G3). */
export type ConceptType = 'person' | 'project' | 'technology' | 'idea';

/** note = a vault file (circle); concept = an AI-extracted entity bridging notes (diamond, G3). */
export type NoteGraphNodeKind = 'note' | 'concept';

export interface NoteGraphNodeDTO {
  id: string;
  title: string;
  tags: string[];
  /** Vault-relative folder the note lives in, "" for the vault root. */
  folder: string;
  pinned: boolean;
  /** Number of explicit wikilink connections (G2 encoding); for a concept, its distinct-note mention count. */
  degree: number;
  /** PageRank over the explicit-link graph, 0..1-ish, normalized so the max node ≈ 1. */
  pagerank: number;
  /** Betweenness centrality over the explicit-link graph (bridge detection). */
  betweenness: number;
  /** Count of open `- [ ]` checkbox tasks in the note body. */
  openTasks: number;
  /** Whole days since the note was last modified — drives the freshness/opacity encoding. */
  freshnessDays: number;
  /** Node kind (G3). Concept nodes carry the entity name in `title` and a `conceptType`. */
  kind: NoteGraphNodeKind;
  /** Set only on concept nodes — the extractor category. */
  conceptType: ConceptType | null;
  /** G4: the note's coarse (top-level) community id, for the "color by community" mode. Null on concepts / before detection. */
  communityId: string | null;
  /** G4: the coarse community's label (AI or fallback), for legends and the G6 §5 "cluster" filter. */
  communityLabel: string | null;
}

/** explicit = [[wikilink]]; semantic = embedding similarity; tag = shared tags; concept = note↔extracted-entity; suggested = AI-proposed link (G6 §7 ghost edge). */
export type NoteGraphEdgeType = 'explicit' | 'semantic' | 'tag' | 'concept' | 'suggested';

export interface ConceptDTO {
  id: string;
  name: string;
  type: ConceptType;
  aliases: string[];
  /** Distinct notes mentioning this concept. */
  mentionCount: number;
}

/** Progress for the Settings "extract concepts" backfill. */
export interface ConceptStatusDTO {
  totalNotes: number;
  extractedNotes: number;
  conceptCount: number;
  aiEnabled: boolean;
  running: boolean;
}

export interface NoteGraphEdgeDTO {
  source: string;
  target: string;
  type: NoteGraphEdgeType;
  /** Type-specific strength: explicit = link count, semantic = cosine, tag = shared-tag count. */
  weight: number;
}

/** The flagship graph feature. G2: metrics-encoded nodes + typed (explicit/semantic/tag) edges. */
export interface NoteGraphDTO {
  nodes: NoteGraphNodeDTO[];
  edges: NoteGraphEdgeDTO[];
  /** Whether the cached metrics/edges index is populated (false = a recompute was just triggered). */
  indexReady: boolean;
}

// ── G6 §5 — Ask the graph in natural language ────────────────────────────────

/**
 * A compiled graph query (G6 §5): the AI turns a natural-language ask into these concrete filters, which the
 * client shows as editable chips and applies to the visible node set. All fields are optional/additive.
 */
export interface GraphQueryFilterDTO {
  tags: string[];
  folders: string[];
  /** Community labels (matched case-insensitively against detected community names). */
  communityLabels: string[];
  edgeTypes: NoteGraphEdgeType[];
  /** Keep only notes untouched for at least this many days (the "haven't touched in 3 months" case). */
  untouchedMinDays: number | null;
  minPagerank: number | null;
  minDegree: number | null;
  minBetweenness: number | null;
  /** True = only notes with open tasks. */
  hasOpenTasks: boolean;
  /** Free-text substring to match in title/tags. */
  text: string | null;
}

export const GraphQuerySchema = z.object({ message: z.string().min(1) });
export type GraphQueryInput = z.infer<typeof GraphQuerySchema>;

export interface GraphQueryResponseDTO {
  filter: GraphQueryFilterDTO;
  /** Short human echo of what the AI understood, e.g. "gamedev notes untouched for 90+ days". */
  interpretation: string;
}

// ── G6 §6 — Connection explorer ──────────────────────────────────────────────

export interface GraphPathStepDTO {
  /** Node id at this step (note id or "concept:<id>"). */
  id: string;
  title: string;
  kind: NoteGraphNodeKind;
  /** Edge type joining this node to the previous step (null on the first node). */
  viaType: NoteGraphEdgeType | null;
}

export interface GraphPathResultDTO {
  /** Fewest-hops path (or [] if the two nodes are disconnected). */
  shortest: GraphPathStepDTO[];
  /** Strongest-connection path (weighted); may equal `shortest`. */
  strongest: GraphPathStepDTO[];
  /** One-line narration of the strongest path (AI, or a deterministic fallback). */
  narration: string;
}

export const GraphPathSchema = z.object({ source: z.string().min(1), target: z.string().min(1) });
export type GraphPathInput = z.infer<typeof GraphPathSchema>;

/** "Why related?" evidence between two notes (G6 §6). */
export interface GraphWhyDTO {
  kind: 'semantic' | 'tag' | 'concept' | 'explicit' | 'none';
  /** For semantic/suggested pairs: the best-matching passage from each note. */
  sourcePassage: string | null;
  targetPassage: string | null;
  score: number | null;
  /** For tag/concept: the shared tags / concept names. */
  shared: string[];
}

export const GraphWhySchema = z.object({ source: z.string().min(1), target: z.string().min(1) });
export type GraphWhyInput = z.infer<typeof GraphWhySchema>;

// ── G6 §7 — Suggested edges ──────────────────────────────────────────────────

/** An AI/embedding-proposed link the user can Accept (writes a real [[wikilink]]) or Dismiss (persisted). */
export interface SuggestedEdgeDTO {
  source: string;
  sourceTitle: string;
  target: string;
  targetTitle: string;
  /** Model/embedding confidence (cosine similarity). */
  confidence: number;
}

export const SuggestedEdgeActionSchema = z.object({ source: z.string().min(1), target: z.string().min(1) });
export type SuggestedEdgeActionInput = z.infer<typeof SuggestedEdgeActionSchema>;

// ── G6 §8 — Insights panel (always actionable) ────────────────────────────────

/** A semantically-near note surfaced as a link candidate for an orphan. */
export interface InsightNeighborDTO {
  id: string;
  title: string;
  /** Cosine similarity of the closest chunk pair. */
  score: number;
}

/** An unlinked note (degree 0) with its top semantic neighbours — one click links it. */
export interface OrphanInsightDTO {
  id: string;
  title: string;
  neighbors: InsightNeighborDTO[];
}

/** A concept mentioned across many notes but with no dedicated note of its own. */
export interface BlindSpotInsightDTO {
  conceptId: string;
  name: string;
  type: ConceptType;
  /** Number of notes that mention this concept. */
  noteCount: number;
}

/** A high-betweenness note whose links span two or more detected communities. */
export interface BridgeInsightDTO {
  id: string;
  title: string;
  betweenness: number;
  /** Labels of the distinct communities this note connects. */
  communities: string[];
}

/** A central note (high PageRank) left untouched past the staleness cutoff. */
export interface StaleCentralInsightDTO {
  id: string;
  title: string;
  pagerank: number;
  freshnessDays: number;
}

/** A note pair whose embeddings are near-identical — a likely duplicate. */
export interface DuplicateInsightDTO {
  source: string;
  sourceTitle: string;
  target: string;
  targetTitle: string;
  similarity: number;
}

export interface GraphInsightsDTO {
  orphans: OrphanInsightDTO[];
  blindSpots: BlindSpotInsightDTO[];
  bridges: BridgeInsightDTO[];
  staleCentral: StaleCentralInsightDTO[];
  duplicates: DuplicateInsightDTO[];
  /** Orphan neighbours + duplicates need embeddings; false ⇒ AI index not built yet. */
  embeddingsReady: boolean;
  /** The staleness cutoff (days) used for stale-but-central, echoed for the UI copy. */
  staleDays: number;
}

export interface TemplateSummaryDTO {
  /** Vault-relative path within the templates folder, e.g. "Templates/Meeting.md". */
  id: string;
  title: string;
}

export const NoteFromTemplateSchema = z.object({
  path: z.string().min(1),
  /** Vault-relative path of the template to instantiate from. */
  templateId: z.string().min(1),
});
export type NoteFromTemplateInput = z.infer<typeof NoteFromTemplateSchema>;

export interface NoteTrashEntryDTO {
  /** The dated trash folder name — pass back to restore/purge. */
  trashId: string;
  /** Original vault-relative path before deletion. */
  originalPath: string;
  deletedAt: string;
}
