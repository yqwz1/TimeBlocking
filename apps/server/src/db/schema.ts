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
    pinned: integer('pinned').notNull().default(0),
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
  pinned: integer('pinned').notNull().default(0),
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
  manualMinutes: integer('manual_minutes').notNull().default(0),
  manualCount: integer('manual_count').notNull().default(0),
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

/**
 * Second Brain vault cache. `id` is the vault-relative file path — the markdown
 * file itself is the source of truth; this table (plus `note_links` and the
 * `notes_fts` virtual table below) is a rebuildable index over it.
 */
export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(), // vault-relative path, e.g. "Projects/Foo.md"
    title: text('title').notNull(),
    tags: text('tags').notNull().default('[]'), // JSON string[]
    frontmatter: text('frontmatter').notNull().default('{}'), // JSON object, cached for display only
    contentHash: text('content_hash').notNull(),
    createdAtUtc: text('created_at_utc'),
    updatedAtUtc: text('updated_at_utc'),
  },
  (t) => [index('idx_notes_title').on(t.title)],
);

/** A revocable public read-only share for a single note. At most one active link per note. */
export const noteShares = sqliteTable(
  'note_shares',
  {
    noteId: text('note_id').primaryKey(),
    token: text('token').notNull(),
    createdAtUtc: text('created_at_utc').notNull(),
    revokedAtUtc: text('revoked_at_utc'),
  },
  (t) => [uniqueIndex('idx_note_shares_token').on(t.token)],
);

/** One row per `[[wikilink]]` found in a note. `targetId` is resolved by title match; null until a matching note exists. */
export const noteLinks = sqliteTable(
  'note_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: text('source_id').notNull(),
    targetTitle: text('target_title').notNull(),
    targetId: text('target_id'),
    snippet: text('snippet').notNull().default(''), // context around the [[wikilink]] occurrence, for the backlinks panel
  },
  (t) => [
    index('idx_note_links_source').on(t.sourceId),
    index('idx_note_links_target').on(t.targetId),
    index('idx_note_links_target_title').on(t.targetTitle),
  ],
);

/**
 * Chunk-level embedding cache for the Second Brain intelligence layer (Phase 3), rebuildable
 * from the vault files at any time. `contentHash` is a hash of the note's BODY only (frontmatter
 * excluded), so a note is only re-chunked/re-embedded (a paid API call) when its actual content
 * changed — not on frontmatter-only edits like pinning.
 */
export const noteChunks = sqliteTable(
  'note_chunks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    noteId: text('note_id').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    text: text('text').notNull(),
    embedding: text('embedding').notNull(), // JSON number[]
    contentHash: text('content_hash').notNull(),
  },
  (t) => [index('idx_note_chunks_note').on(t.noteId)],
);

/**
 * The Graph (G2) — cached per-note metrics over the explicit-link graph. Rebuildable from
 * `note_links` + the vault at any time. `communityId`/`timeSpentMin` are reserved for G4.
 */
export const nodeMetrics = sqliteTable('node_metrics', {
  noteId: text('note_id').primaryKey(),
  degree: integer('degree').notNull().default(0),
  pagerank: real('pagerank').notNull().default(0),
  betweenness: real('betweenness').notNull().default(0),
  communityId: text('community_id'),
  openTasks: integer('open_tasks').notNull().default(0),
  timeSpentMin: integer('time_spent_min').notNull().default(0),
  updatedAtUtc: text('updated_at_utc'),
});

/**
 * The Graph (G2) — cached typed edges. `type` is explicit|semantic|tag (concept/temporal/suggested
 * arrive in later phases); `status` is reserved for the G6 suggested-edge lifecycle
 * (explicit|suggested|accepted|dismissed). One row per (source, target, type).
 */
export const graphEdges = sqliteTable(
  'graph_edges',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    source: text('source').notNull(),
    target: text('target').notNull(),
    type: text('type').notNull(),
    weight: real('weight').notNull().default(1),
    status: text('status').notNull().default('explicit'),
  },
  (t) => [
    uniqueIndex('idx_graph_edges_unique').on(t.source, t.target, t.type),
    index('idx_graph_edges_source').on(t.source),
    index('idx_graph_edges_target').on(t.target),
  ],
);

/**
 * The Graph (G3) — canonical AI-extracted concepts (people/projects/technologies/ideas). `normKey`
 * (`type|lower(name)`) is the auto-dedup key; `aliases` (JSON) holds names merged into this concept.
 */
export const concepts = sqliteTable(
  'concepts',
  {
    id: text('id').primaryKey(), // uuid
    name: text('name').notNull(),
    type: text('type').notNull(),
    aliases: text('aliases').notNull().default('[]'), // JSON string[]
    normKey: text('norm_key').notNull(),
    createdAtUtc: text('created_at_utc'),
  },
  (t) => [uniqueIndex('idx_concepts_norm').on(t.normKey)],
);

/** One row per (concept, note) mention. `count` = occurrences in that note. */
export const conceptMentions = sqliteTable(
  'concept_mentions',
  {
    conceptId: text('concept_id').notNull(),
    noteId: text('note_id').notNull(),
    count: integer('count').notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.conceptId, t.noteId] }),
    index('idx_concept_mentions_note').on(t.noteId),
    index('idx_concept_mentions_concept').on(t.conceptId),
  ],
);

/** Per-note extraction staleness — body hash last extracted, so only changed notes are re-extracted. */
export const conceptExtractions = sqliteTable('concept_extractions', {
  noteId: text('note_id').primaryKey(),
  contentHash: text('content_hash').notNull(),
});

/** Concept normKeys the user has blacklisted — never recreated on extraction. */
export const conceptBlacklist = sqliteTable('concept_blacklist', {
  normKey: text('norm_key').primaryKey(),
});

/**
 * The Graph (G4) — hierarchical communities over the combined document + concept graph (Louvain at three
 * resolutions, `level` 0 = coarse .. 2 = fine). `id` is a content hash of `level`+sorted member note ids,
 * so an unchanged community keeps its id — and thus its AI-generated `label`/`summary` — across recomputes.
 * `parent_id` links each community to its coarser parent (majority membership). Fully rebuildable cache.
 */
export const communities = sqliteTable(
  'communities',
  {
    id: text('id').primaryKey(),
    level: integer('level').notNull(),
    parentId: text('parent_id'),
    label: text('label').notNull(),
    summary: text('summary').notNull().default(''),
    members: text('members').notNull().default('[]'), // JSON note-id string[]
    memberCount: integer('member_count').notNull().default(0),
    aiGenerated: integer('ai_generated').notNull().default(0), // 0 = deterministic fallback label, 1 = AI-named
    updatedAtUtc: text('updated_at_utc'),
  },
  (t) => [index('idx_communities_level').on(t.level)],
);

/**
 * The Graph (G6 §7) — note pairs the user dismissed as suggested links, so they are never re-proposed.
 * Persistent (unlike `graph_edges`, which is rebuilt each recompute). Accepted suggestions instead become
 * real `[[wikilinks]]` in the note, so they need no row here. Stored order-independent (min id, max id).
 */
export const suggestedEdgeDismissals = sqliteTable(
  'suggested_edge_dismissals',
  {
    source: text('source').notNull(),
    target: text('target').notNull(),
    dismissedAtUtc: text('dismissed_at_utc'),
  },
  (t) => [primaryKey({ columns: [t.source, t.target] })],
);

/** Rebuildable graph layout cache. Physics stays in a Web Worker; settled positions make cold-open instant. */
export const layoutCache = sqliteTable(
  'layout_cache',
  {
    mode: text('mode').notNull(),
    nodeId: text('node_id').notNull(),
    x: real('x').notNull(),
    y: real('y').notNull(),
    pinned: integer('pinned').notNull().default(0),
    updatedAtUtc: text('updated_at_utc'),
  },
  (t) => [primaryKey({ columns: [t.mode, t.nodeId] }), index('idx_layout_cache_mode').on(t.mode)],
);

/** Durable state for debounced, incremental, restart-safe Second Brain indexing jobs. */
export const graphJobs = sqliteTable('graph_jobs', {
  name: text('name').primaryKey(),
  status: text('status').notNull().default('idle'),
  progress: real('progress').notNull().default(0),
  cursor: text('cursor'),
  queuedAtUtc: text('queued_at_utc'),
  startedAtUtc: text('started_at_utc'),
  completedAtUtc: text('completed_at_utc'),
  error: text('error'),
});

/** Phase 7 study layer: SM-2 state for Q:: / A:: flashcards extracted from notes. */
export const studyCards = sqliteTable(
  'study_cards',
  {
    id: text('id').primaryKey(),
    noteId: text('note_id').notNull(),
    kind: text('kind').notNull().default('qa'),
    prompt: text('prompt').notNull(),
    answer: text('answer').notNull(),
    dueDate: text('due_date').notNull(), // local YYYY-MM-DD
    easeFactor: real('ease_factor').notNull().default(2.5),
    intervalDays: integer('interval_days').notNull().default(0),
    repetitions: integer('repetitions').notNull().default(0),
    lastReviewedAtUtc: text('last_reviewed_at_utc'),
    createdAtUtc: text('created_at_utc'),
    updatedAtUtc: text('updated_at_utc'),
  },
  (t) => [index('idx_study_cards_due').on(t.dueDate), index('idx_study_cards_note').on(t.noteId)],
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

/** Stable, local source registry used by the personal-intelligence runtime. Source bodies remain in their native stores. */
export const knowledgeRecords = sqliteTable(
  'knowledge_records',
  {
    id: text('id').primaryKey(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    sourceVersion: text('source_version').notNull(),
    title: text('title').notNull(),
    excerpt: text('excerpt').notNull().default(''),
    contentHash: text('content_hash'),
    occurredAtUtc: text('occurred_at_utc'),
    sensitivity: text('sensitivity').notNull().default('normal'),
    createdAtUtc: text('created_at_utc').notNull(),
    updatedAtUtc: text('updated_at_utc').notNull(),
    deletedAtUtc: text('deleted_at_utc'),
  },
  (t) => [
    uniqueIndex('idx_knowledge_source').on(t.sourceType, t.sourceId),
    index('idx_knowledge_source_type').on(t.sourceType),
    index('idx_knowledge_occurred').on(t.occurredAtUtc),
  ],
);

/** Durable people/projects/topics promoted from rebuildable note concepts only after review. */
export const knowledgeEntities = sqliteTable(
  'knowledge_entities',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    canonicalName: text('canonical_name').notNull(),
    aliases: text('aliases').notNull().default('[]'),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('candidate'),
    sensitivity: text('sensitivity').notNull().default('normal'),
    mergedIntoId: text('merged_into_id'),
    createdAtUtc: text('created_at_utc').notNull(),
    updatedAtUtc: text('updated_at_utc').notNull(),
  },
  (t) => [index('idx_knowledge_entity_kind').on(t.kind), index('idx_knowledge_entity_status').on(t.status)],
);

export const knowledgeRelations = sqliteTable(
  'knowledge_relations',
  {
    id: text('id').primaryKey(),
    sourceEntityId: text('source_entity_id').notNull(),
    targetEntityId: text('target_entity_id').notNull(),
    type: text('type').notNull(),
    confidence: real('confidence').notNull().default(0.5),
    status: text('status').notNull().default('candidate'),
    validFromUtc: text('valid_from_utc'),
    validToUtc: text('valid_to_utc'),
    evidenceIds: text('evidence_ids').notNull().default('[]'),
    createdAtUtc: text('created_at_utc').notNull(),
    updatedAtUtc: text('updated_at_utc').notNull(),
  },
  (t) => [
    uniqueIndex('idx_knowledge_relation_unique').on(t.sourceEntityId, t.targetEntityId, t.type),
    index('idx_knowledge_relation_source').on(t.sourceEntityId),
    index('idx_knowledge_relation_target').on(t.targetEntityId),
  ],
);

export const memoryClaims = sqliteTable(
  'memory_claims',
  {
    id: text('id').primaryKey(),
    memoryClass: text('memory_class').notNull(),
    claim: text('claim').notNull(),
    normalizedClaim: text('normalized_claim').notNull(),
    status: text('status').notNull().default('candidate'),
    confidence: real('confidence').notNull().default(0.5),
    sensitivity: text('sensitivity').notNull().default('normal'),
    validFromUtc: text('valid_from_utc'),
    validToUtc: text('valid_to_utc'),
    expiresAtUtc: text('expires_at_utc'),
    lastUsedAtUtc: text('last_used_at_utc'),
    supersedesId: text('supersedes_id'),
    contradictedById: text('contradicted_by_id'),
    createdAtUtc: text('created_at_utc').notNull(),
    updatedAtUtc: text('updated_at_utc').notNull(),
  },
  (t) => [index('idx_memory_status').on(t.status), index('idx_memory_class').on(t.memoryClass)],
);

export const memoryEvidence = sqliteTable(
  'memory_evidence',
  {
    memoryId: text('memory_id').notNull(),
    knowledgeRecordId: text('knowledge_record_id').notNull(),
    excerpt: text('excerpt').notNull().default(''),
    createdAtUtc: text('created_at_utc').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.memoryId, t.knowledgeRecordId] }),
    index('idx_memory_evidence_record').on(t.knowledgeRecordId),
  ],
);

export const assistantThreads = sqliteTable('assistant_threads', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  status: text('status').notNull().default('active'),
  createdAtUtc: text('created_at_utc').notNull(),
  updatedAtUtc: text('updated_at_utc').notNull(),
  lastMessageAtUtc: text('last_message_at_utc'),
});

export const assistantMessages = sqliteTable(
  'assistant_messages',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    citations: text('citations').notNull().default('[]'),
    memoriesUsed: text('memories_used').notNull().default('[]'),
    uncertainties: text('uncertainties').notNull().default('[]'),
    proposedActionIds: text('proposed_action_ids').notNull().default('[]'),
    createdAtUtc: text('created_at_utc').notNull(),
  },
  (t) => [index('idx_assistant_messages_thread').on(t.threadId, t.createdAtUtc)],
);

export const assistantSummaries = sqliteTable('assistant_summaries', {
  threadId: text('thread_id').primaryKey(),
  throughMessageId: text('through_message_id').notNull(),
  summary: text('summary').notNull(),
  updatedAtUtc: text('updated_at_utc').notNull(),
});

export const assistantFeedback = sqliteTable(
  'assistant_feedback',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id').notNull(),
    rating: text('rating').notNull(),
    detail: text('detail').notNull().default(''),
    createdAtUtc: text('created_at_utc').notNull(),
  },
  (t) => [uniqueIndex('idx_assistant_feedback_message').on(t.messageId)],
);

/** General durable queue: every handler leases a job before work and may safely retry after a restart. */
export const durableJobs = sqliteTable(
  'durable_jobs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    payload: text('payload').notNull().default('{}'),
    status: text('status').notNull().default('queued'),
    dedupeKey: text('dedupe_key'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    availableAtUtc: text('available_at_utc').notNull(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAtUtc: text('lease_expires_at_utc'),
    checkpoint: text('checkpoint').notNull().default('{}'),
    progress: real('progress').notNull().default(0),
    lastError: text('last_error'),
    createdAtUtc: text('created_at_utc').notNull(),
    updatedAtUtc: text('updated_at_utc').notNull(),
    completedAtUtc: text('completed_at_utc'),
  },
  (t) => [
    uniqueIndex('idx_durable_jobs_dedupe').on(t.dedupeKey),
    index('idx_durable_jobs_claim').on(t.status, t.availableAtUtc, t.leaseExpiresAtUtc),
  ],
);

export const indexVersions = sqliteTable(
  'index_versions',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    model: text('model').notNull(),
    dimensions: integer('dimensions'),
    status: text('status').notNull().default('building'),
    recordCount: integer('record_count').notNull().default(0),
    activatedAtUtc: text('activated_at_utc'),
    createdAtUtc: text('created_at_utc').notNull(),
  },
  (t) => [index('idx_index_versions_kind_status').on(t.kind, t.status)],
);

/** Embeddings are written under a building version, then atomically activated by flipping index_versions.status. */
export const knowledgeEmbeddings = sqliteTable(
  'knowledge_embeddings',
  {
    indexVersionId: text('index_version_id').notNull(),
    recordId: text('record_id').notNull(),
    contentHash: text('content_hash').notNull(),
    vector: text('vector').notNull(),
    createdAtUtc: text('created_at_utc').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.indexVersionId, t.recordId] }),
    index('idx_knowledge_embeddings_record').on(t.recordId),
  ],
);

export const domainEvents = sqliteTable(
  'domain_events',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    payload: text('payload').notNull().default('{}'),
    occurredAtUtc: text('occurred_at_utc').notNull(),
    processedAtUtc: text('processed_at_utc'),
  },
  (t) => [index('idx_domain_events_unprocessed').on(t.processedAtUtc, t.seq)],
);

export const aiRuns = sqliteTable(
  'ai_runs',
  {
    id: text('id').primaryKey(),
    task: text('task').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    cacheKey: text('cache_key'),
    status: text('status').notNull(),
    latencyMs: integer('latency_ms').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    billableTokens: integer('billable_tokens').notNull().default(0),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    estimatedUsd: real('estimated_usd'),
    routeTier: text('route_tier').notNull().default('cheap-cloud'),
    parentAttemptId: text('parent_attempt_id'),
    cacheStatus: text('cache_status').notNull().default('miss'),
    escalationReason: text('escalation_reason'),
    toolNames: text('tool_names').notNull().default('[]'),
    contextBreakdown: text('context_breakdown').notNull().default('{}'),
    retrievedRecordIds: text('retrieved_record_ids').notNull().default('[]'),
    error: text('error'),
    createdAtUtc: text('created_at_utc').notNull(),
  },
  (t) => [index('idx_ai_runs_task_created').on(t.task, t.createdAtUtc)],
);

export const aiResponseCache = sqliteTable('ai_response_cache', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  expiresAtUtc: text('expires_at_utc').notNull(),
  createdAtUtc: text('created_at_utc').notNull(),
});

/** Content-addressed vectors shared by note and knowledge indexing. Raw source text is never persisted here. */
export const aiEmbeddingCache = sqliteTable(
  'ai_embedding_cache',
  {
    model: text('model').notNull(),
    dimensions: integer('dimensions').notNull(),
    contentHash: text('content_hash').notNull(),
    vector: text('vector').notNull(),
    createdAtUtc: text('created_at_utc').notNull(),
  },
  (t) => [primaryKey({ columns: [t.model, t.dimensions, t.contentHash] })],
);

export const actionProposals = sqliteTable(
  'action_proposals',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    status: text('status').notNull().default('draft'),
    title: text('title').notNull(),
    preview: text('preview').notNull(),
    payload: text('payload').notNull().default('{}'),
    reasoning: text('reasoning').notNull().default(''),
    evidenceIds: text('evidence_ids').notNull().default('[]'),
    riskLevel: text('risk_level').notNull().default('low'),
    expiresAtUtc: text('expires_at_utc').notNull(),
    affectedRecords: text('affected_records').notNull().default('[]'),
    freshnessVersion: text('freshness_version').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    error: text('error'),
    createdAtUtc: text('created_at_utc').notNull(),
    updatedAtUtc: text('updated_at_utc').notNull(),
    executedAtUtc: text('executed_at_utc'),
  },
  (t) => [uniqueIndex('idx_action_idempotency').on(t.idempotencyKey), index('idx_action_status').on(t.status)],
);

export const connectorAccounts = sqliteTable(
  'connector_accounts',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    accountLabel: text('account_label').notNull(),
    status: text('status').notNull().default('disconnected'),
    selectedScopes: text('selected_scopes').notNull().default('[]'),
    selectedSources: text('selected_sources').notNull().default('[]'),
    aiProcessingEnabled: integer('ai_processing_enabled').notNull().default(0),
    credentialRef: text('credential_ref'),
    lastCursor: text('last_cursor'),
    lastSyncedAtUtc: text('last_synced_at_utc'),
    lastError: text('last_error'),
    createdAtUtc: text('created_at_utc').notNull(),
    updatedAtUtc: text('updated_at_utc').notNull(),
  },
  (t) => [uniqueIndex('idx_connector_provider_label').on(t.provider, t.accountLabel)],
);

/** Selectively retained communication metadata and bounded excerpts, never a permanent full-body mirror. */
export const connectorItems = sqliteTable(
  'connector_items',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerItemId: text('provider_item_id').notNull(),
    sourceLabel: text('source_label').notNull(),
    subject: text('subject').notNull().default(''),
    participants: text('participants').notNull().default('[]'),
    summary: text('summary').notNull().default(''),
    evidenceExcerpt: text('evidence_excerpt').notNull().default(''),
    contentHash: text('content_hash').notNull(),
    deepLink: text('deep_link'),
    occurredAtUtc: text('occurred_at_utc'),
    deletedAtUtc: text('deleted_at_utc'),
    createdAtUtc: text('created_at_utc').notNull(),
    updatedAtUtc: text('updated_at_utc').notNull(),
  },
  (t) => [
    uniqueIndex('idx_connector_item_provider').on(t.accountId, t.providerItemId),
    index('idx_connector_items_occurred').on(t.occurredAtUtc),
  ],
);

export const commitments = sqliteTable(
  'commitments',
  {
    id: text('id').primaryKey(),
    direction: text('direction').notNull(),
    title: text('title').notNull(),
    details: text('details').notNull().default(''),
    personEntityId: text('person_entity_id'),
    dueAtUtc: text('due_at_utc'),
    status: text('status').notNull().default('open'),
    evidenceIds: text('evidence_ids').notNull().default('[]'),
    createdAtUtc: text('created_at_utc').notNull(),
    updatedAtUtc: text('updated_at_utc').notNull(),
  },
  (t) => [index('idx_commitments_status_due').on(t.status, t.dueAtUtc)],
);

export const decisions = sqliteTable(
  'decisions',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    decision: text('decision').notNull(),
    rationale: text('rationale').notNull().default(''),
    alternatives: text('alternatives').notNull().default('[]'),
    participantEntityIds: text('participant_entity_ids').notNull().default('[]'),
    outcome: text('outcome'),
    decidedAtUtc: text('decided_at_utc').notNull(),
    evidenceIds: text('evidence_ids').notNull().default('[]'),
    createdAtUtc: text('created_at_utc').notNull(),
    updatedAtUtc: text('updated_at_utc').notNull(),
  },
  (t) => [index('idx_decisions_decided').on(t.decidedAtUtc)],
);

export const proactiveInsights = sqliteTable(
  'proactive_insights',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    priority: text('priority').notNull().default('medium'),
    status: text('status').notNull().default('new'),
    evidenceIds: text('evidence_ids').notNull().default('[]'),
    cooldownKey: text('cooldown_key').notNull(),
    surfacedAtUtc: text('surfaced_at_utc'),
    expiresAtUtc: text('expires_at_utc'),
    helpful: integer('helpful'),
    createdAtUtc: text('created_at_utc').notNull(),
  },
  (t) => [uniqueIndex('idx_proactive_cooldown').on(t.cooldownKey), index('idx_proactive_status').on(t.status)],
);

/** Future purchases and the latest cached AI recommendation for each item. */
export const wishlistItems = sqliteTable(
  'wishlist_items',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    notes: text('notes').notNull().default(''),
    productUrl: text('product_url'),
    imageUrl: text('image_url'),
    imageFileName: text('image_file_name'),
    retailer: text('retailer'),
    category: text('category').notNull().default('Other'),
    priority: integer('priority').notNull().default(1),
    status: text('status').notNull().default('considering'),
    priceMinor: integer('price_minor'),
    targetDate: text('target_date'),
    purchasedAt: text('purchased_at'),
    actualPriceMinor: integer('actual_price_minor'),
    goalIds: text('goal_ids').notNull().default('[]'),
    advice: text('advice'),
    adviceInputHash: text('advice_input_hash'),
    adviceAnalyzedAtUtc: text('advice_analyzed_at_utc'),
    createdAtUtc: text('created_at_utc').notNull(),
    updatedAtUtc: text('updated_at_utc').notNull(),
  },
  (t) => [
    index('idx_wishlist_status').on(t.status),
    index('idx_wishlist_category').on(t.category),
    index('idx_wishlist_target_date').on(t.targetDate),
    index('idx_wishlist_purchased_at').on(t.purchasedAt),
  ],
);

/** One planning budget per YYYY-MM calendar month. Currency is wishlist-wide. */
export const wishlistBudgets = sqliteTable('wishlist_budgets', {
  month: text('month').primaryKey(),
  amountMinor: integer('amount_minor').notNull().default(0),
  updatedAtUtc: text('updated_at_utc').notNull(),
});

/** Serialized WorkOut engine invocations. Results remain inspectable after restart. */
export const workoutJobs = sqliteTable(
  'workout_jobs',
  {
    id: text('id').primaryKey(),
    command: text('command').notNull(),
    payload: text('payload').notNull().default('{}'),
    status: text('status').notNull().default('queued'),
    progress: real('progress').notNull().default(0),
    result: text('result'),
    error: text('error'),
    createdAtUtc: text('created_at_utc').notNull(),
    updatedAtUtc: text('updated_at_utc').notNull(),
    completedAtUtc: text('completed_at_utc'),
  },
  (t) => [index('idx_workout_jobs_status').on(t.status), index('idx_workout_jobs_created').on(t.createdAtUtc)],
);
