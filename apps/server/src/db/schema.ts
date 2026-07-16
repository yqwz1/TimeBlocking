import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const oauthTokens = sqliteTable('oauth_tokens', {
  provider: text('provider').primaryKey(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiryUtc: text('expiry_utc'),
  scopes: text('scopes'),
});

/** The app's native task store. Tasks are created, edited and completed locally. */
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    content: text('content').notNull(),
    description: text('description').notNull().default(''),
    projectId: text('project_id'),
    projectName: text('project_name'),
    priority: integer('priority').notNull().default(1), // 1..4, 4 = urgent (UI P1)
    dueDate: text('due_date'), // YYYY-MM-DD (local)
    dueDatetimeUtc: text('due_datetime_utc'),
    durationMin: integer('duration_min'),
    difficulty: text('difficulty'), // easy|medium|hard — feeds scheduler energy matching (hard=deep, easy=shallow)
    labels: text('labels').notNull().default('[]'), // JSON string[] of label names
    url: text('url'),
    isCompleted: integer('is_completed').notNull().default(0),
    isDeleted: integer('is_deleted').notNull().default(0),
    skipScheduling: integer('skip_scheduling').notNull().default(0),
    forceSchedule: integer('force_schedule').notNull().default(0),
    plannedForDate: text('planned_for_date'), // local YYYY-MM-DD — "picked for today/tomorrow" in the Plan Day ritual; a soft deadline independent of schedulePolicy
    createdAtUtc: text('created_at_utc'),
    lastPushedHash: text('last_pushed_hash'),
    syncedAtUtc: text('synced_at_utc'),
    parentId: text('parent_id'), // self-referencing: subtasks / sub-subtasks
    status: text('status').notNull().default('todo'), // backlog|todo|in_progress|done|cancelled
    color: text('color'),
    links: text('links').notNull().default('[]'), // JSON {url,title}[]
    sortOrder: real('sort_order').notNull().default(0),
    completedAtUtc: text('completed_at_utc'),
    updatedAtUtc: text('updated_at_utc'),
  },
  (t) => [index('idx_tasks_parent').on(t.parentId), index('idx_tasks_status').on(t.status)],
);

/**
 * Ordering constraint between two tasks: `blockedId` cannot be scheduled until
 * `blockerId` is done (or cancelled). Enforced in scheduler scope, not just UI.
 */
export const taskDependencies = sqliteTable(
  'task_dependencies',
  {
    id: text('id').primaryKey(),
    blockerId: text('blocker_id').notNull(), // must be done first
    blockedId: text('blocked_id').notNull(), // waits on blockerId
    createdAtUtc: text('created_at_utc'),
  },
  (t) => [
    uniqueIndex('idx_task_dep_pair').on(t.blockerId, t.blockedId),
    index('idx_task_dep_blocked').on(t.blockedId),
    index('idx_task_dep_blocker').on(t.blockerId),
  ],
);

/** Named containers for tasks. `projectId = NULL` on a task means the virtual Inbox. */
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  color: text('color'),
  icon: text('icon'),
  sortOrder: integer('sort_order').notNull().default(0),
  archived: integer('archived').notNull().default(0),
  createdAtUtc: text('created_at_utc'),
});

/** Label registry (colors, rename). `tasks.labels` stores names, not ids. */
export const labels = sqliteTable(
  'labels',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    color: text('color'),
    createdAtUtc: text('created_at_utc'),
  },
  (t) => [uniqueIndex('idx_labels_name').on(t.name)],
);

/** Files attached to a task. Bytes live on disk at data/attachments/<taskId>/<id>-<fileName>. */
export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    createdAtUtc: text('created_at_utc'),
  },
  (t) => [index('idx_attachments_task').on(t.taskId)],
);

/** A one-shot reminder for a task, fired once by the sync loop's tick. */
export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    remindAtUtc: text('remind_at_utc').notNull(),
    message: text('message').notNull().default(''),
    firedAtUtc: text('fired_at_utc'),
    createdAtUtc: text('created_at_utc'),
  },
  (t) => [index('idx_reminders_task').on(t.taskId), index('idx_reminders_remind_at').on(t.remindAtUtc)],
);

/**
 * Native calendar events (meetings/appointments). Fixed-time entries the scheduler
 * never touches. Pushed one-way to the app's Google Calendar; `gcalEventId` maps the
 * pushed event so edits/deletes can patch/remove it.
 */
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    location: text('location').notNull().default(''),
    meetingUrl: text('meeting_url'),
    color: text('color'),
    priority: integer('priority').notNull().default(1), // 1..4, 4 = urgent
    difficulty: text('difficulty'), // easy|medium|hard
    startUtc: text('start_utc').notNull(),
    endUtc: text('end_utc').notNull(),
    reminderMinutesBefore: integer('reminder_minutes_before'), // null = no reminder
    reminderFiredAtUtc: text('reminder_fired_at_utc'),
    gcalEventId: text('gcal_event_id'),
    calendarId: text('calendar_id'),
    lastPushedHash: text('last_pushed_hash'),
    createdAtUtc: text('created_at_utc'),
    updatedAtUtc: text('updated_at_utc'),
  },
  (t) => [index('idx_events_start').on(t.startUtc)],
);

/** Schedule state + task <-> Google-event mapping. */
export const blocks = sqliteTable(
  'blocks',
  {
    id: text('id').primaryKey(), // UUID
    taskId: text('task_id'),
    habitInstanceId: text('habit_instance_id'),
    gcalEventId: text('gcal_event_id'),
    calendarId: text('calendar_id'),
    startUtc: text('start_utc').notNull(),
    endUtc: text('end_utc').notNull(),
    status: text('status').notNull().default('pending_create'), // pending_create|scheduled|done|missed|cancelled
    locked: integer('locked').notNull().default(0),
    chunkIndex: integer('chunk_index').notNull().default(0),
    reasons: text('reasons').notNull().default('[]'), // JSON BlockReason[] — "why this slot" (never part of the diff/hash)
    lastPushedHash: text('last_pushed_hash'),
    gcalUpdated: text('gcal_updated'),
    createdAtUtc: text('created_at_utc'),
    updatedAtUtc: text('updated_at_utc'),
  },
  (t) => [
    index('idx_blocks_task').on(t.taskId),
    index('idx_blocks_event').on(t.gcalEventId),
    index('idx_blocks_start').on(t.startUtc),
  ],
);

export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAtUtc: text('updated_at_utc'),
});

export const habits = sqliteTable('habits', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  durationMin: integer('duration_min').notNull(),
  rrule: text('rrule').notNull(), // FREQ=DAILY | FREQ=WEEKLY;BYDAY=MO,WE,FR
  preferredStart: text('preferred_start'), // HH:mm local
  windowStart: text('window_start').notNull().default('06:00'),
  windowEnd: text('window_end').notNull().default('22:00'),
  priority: integer('priority').notNull().default(2),
  kind: text('kind').notNull().default('habit'), // habit|learning
  weeklyTargetMin: integer('weekly_target_min'),
  notes: text('notes').notNull().default(''),
  active: integer('active').notNull().default(1),
  createdAtUtc: text('created_at_utc'),
});

export const habitInstances = sqliteTable(
  'habit_instances',
  {
    id: text('id').primaryKey(),
    habitId: text('habit_id').notNull(),
    date: text('date').notNull(), // local YYYY-MM-DD
    status: text('status').notNull().default('planned'), // planned|done|skipped|missed
  },
  (t) => [uniqueIndex('idx_habit_instance').on(t.habitId, t.date)],
);

export const objectives = sqliteTable('objectives', {
  id: text('id').primaryKey(),
  weekStart: text('week_start').notNull(), // local Monday YYYY-MM-DD
  title: text('title').notNull(),
  targetMinutes: integer('target_minutes'),
  targetCount: integer('target_count'),
  linkKind: text('link_kind'), // project|label|habit
  linkValue: text('link_value'),
  status: text('status').notNull().default('active'), // active|done|dropped
  notes: text('notes').notNull().default(''),
});

/** Quarterly SMART goal. Milestones live in `goalMilestones`; optional project/label link auto-tracks progress. */
export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  title: text('title').notNull(), // Specific
  description: text('description').notNull().default(''),
  targetValue: integer('target_value'), // Measurable — nullable
  targetUnit: text('target_unit'),
  currentValue: integer('current_value').notNull().default(0),
  achievable: text('achievable').notNull().default(''), // Achievable rationale
  relevance: text('relevance').notNull().default(''), // Relevant — why it matters
  year: integer('year').notNull(), // Time-bound
  quarter: integer('quarter').notNull(), // 1..4
  customDeadline: text('custom_deadline'), // optional YYYY-MM-DD override
  linkKind: text('link_kind'), // project|label
  linkValue: text('link_value'),
  status: text('status').notNull().default('active'), // active|achieved|dropped
  createdAtUtc: text('created_at_utc'),
});

export const goalMilestones = sqliteTable(
  'goal_milestones',
  {
    id: text('id').primaryKey(),
    goalId: text('goal_id').notNull(),
    title: text('title').notNull(),
    done: integer('done').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    completedAtUtc: text('completed_at_utc'),
  },
  (t) => [index('idx_goal_milestones_goal').on(t.goalId)],
);

export const analyticsDaily = sqliteTable('analytics_daily', {
  date: text('date').primaryKey(), // local YYYY-MM-DD
  plannedMin: integer('planned_min').notNull().default(0),
  completedMin: integer('completed_min').notNull().default(0),
  missedMin: integer('missed_min').notNull().default(0),
  externalBusyMin: integer('external_busy_min').notNull().default(0),
  byProject: text('by_project').notNull().default('{}'),
  byLabel: text('by_label').notNull().default('{}'),
  byHabit: text('by_habit').notNull().default('{}'),
});

export const syncLog = sqliteTable('sync_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tsUtc: text('ts_utc').notNull(),
  source: text('source').notNull(), // google|scheduler|recalc|system
  kind: text('kind').notNull(), // info|conflict|error
  detail: text('detail').notNull(),
});

export const scheduleRuns = sqliteTable('schedule_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ranAtUtc: text('ran_at_utc').notNull(),
  trigger: text('trigger').notNull(), // poll|recalculate|startup|manual
  created: integer('created').notNull().default(0),
  moved: integer('moved').notNull().default(0),
  deleted: integer('deleted').notNull().default(0),
  atRisk: text('at_risk').notNull().default('[]'),
  unplaceable: text('unplaceable').notNull().default('[]'),
  risks: text('risks').notNull().default('[]'), // JSON TaskRisk[] (Phase 2+)
  dayLoads: text('day_loads').notNull().default('[]'), // JSON DayLoad[] (Phase 2+)
});

export const briefs = sqliteTable('briefs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(), // local YYYY-MM-DD
  createdAtUtc: text('created_at_utc').notNull(),
  content: text('content').notNull(),
});

/** One row per completed/missed block — the raw signal the learning layer aggregates. */
export const blockOutcomes = sqliteTable('block_outcomes', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(), // task|habit
  taskId: text('task_id'),
  projectId: text('project_id'),
  outcome: text('outcome').notNull(), // done|missed
  estimatedMin: integer('estimated_min'),
  plannedMin: integer('planned_min').notNull().default(0),
  overrunMin: integer('overrun_min').notNull().default(0),
  hourLocal: integer('hour_local').notNull().default(0),
  dowLocal: integer('dow_local').notNull().default(0),
  recordedAtUtc: text('recorded_at_utc').notNull(),
});

/** EWMA-decayed aggregates keyed by scope + key (e.g. global/duration_multiplier, global/hour_success:9). */
export const learnedStats = sqliteTable(
  'learned_stats',
  {
    scope: text('scope').notNull(), // global | project:<id>
    key: text('key').notNull(), // duration_multiplier | hour_success:<h>
    value: real('value').notNull(),
    weight: real('weight').notNull(),
    updatedAtUtc: text('updated_at_utc'),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

/** Append-only XP ledger. `seq` doubles as the client's monotonic toast cursor. */
export const xpEvents = sqliteTable(
  'xp_events',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    kind: text('kind').notNull(), // block_done|habit_done|streak_day|achievement|freeze_purchase|backfill
    sourceId: text('source_id').notNull(), // blockId|habitInstanceId|dateLocal|achievementId|outcomeId
    amount: integer('amount').notNull(), // negative for freeze_purchase
    dateLocal: text('date_local').notNull(), // local YYYY-MM-DD this XP counts toward
    meta: text('meta').notNull().default('{}'), // JSON: { title?, achievementId?, plannedMin? }
    createdAtUtc: text('created_at_utc').notNull(),
  },
  (t) => [uniqueIndex('idx_xp_source').on(t.kind, t.sourceId), index('idx_xp_date').on(t.dateLocal)],
);

/** One row per fully-evaluated local day. Written once, after local midnight. */
export const dayResults = sqliteTable('day_results', {
  date: text('date').primaryKey(), // local YYYY-MM-DD
  result: text('result').notNull(), // met|freeze|missed|rest
  doneCount: integer('done_count').notNull().default(0),
  missedCount: integer('missed_count').notNull().default(0),
  plannedCount: integer('planned_count').notNull().default(0),
  streakAfter: integer('streak_after').notNull().default(0),
  freezesAfter: integer('freezes_after').notNull().default(0),
  decidedAtUtc: text('decided_at_utc').notNull(),
});

/** Unlocked achievements. Definitions live in code (gamification/achievements.ts). */
export const achievementsUnlocked = sqliteTable('achievements_unlocked', {
  id: text('id').primaryKey(), // definition id, e.g. 'streak_7'
  unlockedAtUtc: text('unlocked_at_utc').notNull(),
  xpAwarded: integer('xp_awarded').notNull().default(0),
});

/** Small KV for derived gamification state (mirrors sync_state). */
export const gamificationState = sqliteTable('gamification_state', {
  key: text('key').primaryKey(), // current_streak|longest_streak|freezes|last_evaluated_date|backfill_done
  value: text('value').notNull(),
});

/** One row per local day holding the daily highlight + end-of-day shutdown ritual. */
export const dailyPlans = sqliteTable('daily_plans', {
  date: text('date').primaryKey(), // local YYYY-MM-DD
  highlight: text('highlight').notNull().default(''),
  highlightTaskId: text('highlight_task_id'),
  highlightDone: integer('highlight_done').notNull().default(0),
  reflection: text('reflection').notNull().default(''),
  rating: integer('rating'), // 1..5 day rating, null until shutdown
  intention: text('intention').notNull().default(''), // note/prep for tomorrow
  shutdownDoneAtUtc: text('shutdown_done_at_utc'), // set when the day is shut down
  // Snapshot of the day taken at shutdown (so the record stays stable afterwards).
  doneCount: integer('done_count').notNull().default(0),
  missedCount: integer('missed_count').notNull().default(0),
  plannedCount: integer('planned_count').notNull().default(0),
  completedMin: integer('completed_min').notNull().default(0),
  createdAtUtc: text('created_at_utc'),
  updatedAtUtc: text('updated_at_utc'),
});

/**
 * A drafted (not-yet-applied) schedule. Only `desired` (the planner's DesiredBlock[])
 * is stored — the actual Google/DB write ops are recomputed fresh at apply time so
 * staleness against intervening calendar changes self-heals instead of replaying stale ops.
 */
export const planProposals = sqliteTable('plan_proposals', {
  id: text('id').primaryKey(),
  createdAtUtc: text('created_at_utc').notNull(),
  status: text('status').notNull().default('draft'), // draft|applied|discarded|stale
  scopeDate: text('scope_date').notNull(), // local YYYY-MM-DD the ritual focused on
  desired: text('desired').notNull().default('[]'), // JSON DesiredBlock[]
  pins: text('pins').notNull().default('[]'), // JSON string[] of pinned DesiredBlock keys
  rejectedTaskIds: text('rejected_task_ids').notNull().default('[]'), // JSON string[]
  summary: text('summary').notNull().default('{}'), // JSON {created,moved,deleted,unchanged}
  risks: text('risks').notNull().default('[]'), // JSON TaskRisk[]
  dayLoads: text('day_loads').notNull().default('[]'), // JSON DayLoad[]
  appliedAtUtc: text('applied_at_utc'),
});

/** A named whiteboard canvas. Scene data lives in `whiteboardScenes`, images in `whiteboardFiles`. */
export const whiteboards = sqliteTable('whiteboards', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAtUtc: text('created_at_utc'),
  updatedAtUtc: text('updated_at_utc'),
});

/** Excalidraw scene payload for one whiteboard (elements + a small appState subset), stored as JSON. */
export const whiteboardScenes = sqliteTable('whiteboard_scenes', {
  boardId: text('board_id').primaryKey(),
  elements: text('elements').notNull().default('[]'),
  appState: text('app_state').notNull().default('{}'),
  updatedAtUtc: text('updated_at_utc'),
});

/** Images/files placed on a whiteboard. Bytes live on disk at data/whiteboards/<boardId>/<id>-<fileId>. */
export const whiteboardFiles = sqliteTable(
  'whiteboard_files',
  {
    id: text('id').primaryKey(), // matches the Excalidraw BinaryFileData id referenced by scene elements
    boardId: text('board_id').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes'),
    createdAtUtc: text('created_at_utc'),
  },
  (t) => [index('idx_wb_files_board').on(t.boardId)],
);

/** One row per local week (Monday) holding the weekly review ritual. */
export const weeklyReviews = sqliteTable('weekly_reviews', {
  weekStart: text('week_start').primaryKey(), // local Monday YYYY-MM-DD
  wins: text('wins').notNull().default(''),
  challenges: text('challenges').notNull().default(''),
  nextWeekFocus: text('next_week_focus').notNull().default(''),
  rating: integer('rating'), // 1..5 week rating, null until completed
  reviewedAtUtc: text('reviewed_at_utc'), // set when the review is completed
  // Snapshot of the week taken at completion.
  plannedMin: integer('planned_min').notNull().default(0),
  completedMin: integer('completed_min').notNull().default(0),
  missedMin: integer('missed_min').notNull().default(0),
  objectivesDone: integer('objectives_done').notNull().default(0),
  objectivesTotal: integer('objectives_total').notNull().default(0),
  createdAtUtc: text('created_at_utc'),
  updatedAtUtc: text('updated_at_utc'),
});
