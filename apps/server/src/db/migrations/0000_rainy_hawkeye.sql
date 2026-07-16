CREATE TABLE `analytics_daily` (
	`date` text PRIMARY KEY NOT NULL,
	`planned_min` integer DEFAULT 0 NOT NULL,
	`completed_min` integer DEFAULT 0 NOT NULL,
	`missed_min` integer DEFAULT 0 NOT NULL,
	`external_busy_min` integer DEFAULT 0 NOT NULL,
	`by_project` text DEFAULT '{}' NOT NULL,
	`by_label` text DEFAULT '{}' NOT NULL,
	`by_habit` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`habit_instance_id` text,
	`gcal_event_id` text,
	`calendar_id` text,
	`start_utc` text NOT NULL,
	`end_utc` text NOT NULL,
	`status` text DEFAULT 'pending_create' NOT NULL,
	`locked` integer DEFAULT 0 NOT NULL,
	`chunk_index` integer DEFAULT 0 NOT NULL,
	`last_pushed_hash` text,
	`gcal_updated` text,
	`created_at_utc` text,
	`updated_at_utc` text
);
--> statement-breakpoint
CREATE INDEX `idx_blocks_task` ON `blocks` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_blocks_event` ON `blocks` (`gcal_event_id`);--> statement-breakpoint
CREATE INDEX `idx_blocks_start` ON `blocks` (`start_utc`);--> statement-breakpoint
CREATE TABLE `briefs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`created_at_utc` text NOT NULL,
	`content` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `habit_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`habit_id` text NOT NULL,
	`date` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_habit_instance` ON `habit_instances` (`habit_id`,`date`);--> statement-breakpoint
CREATE TABLE `habits` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`duration_min` integer NOT NULL,
	`rrule` text NOT NULL,
	`preferred_start` text,
	`window_start` text DEFAULT '06:00' NOT NULL,
	`window_end` text DEFAULT '22:00' NOT NULL,
	`priority` integer DEFAULT 2 NOT NULL,
	`kind` text DEFAULT 'habit' NOT NULL,
	`weekly_target_min` integer,
	`notes` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at_utc` text
);
--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`provider` text PRIMARY KEY NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`expiry_utc` text,
	`scopes` text
);
--> statement-breakpoint
CREATE TABLE `objectives` (
	`id` text PRIMARY KEY NOT NULL,
	`week_start` text NOT NULL,
	`title` text NOT NULL,
	`target_minutes` integer,
	`target_count` integer,
	`link_kind` text,
	`link_value` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedule_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ran_at_utc` text NOT NULL,
	`trigger` text NOT NULL,
	`created` integer DEFAULT 0 NOT NULL,
	`moved` integer DEFAULT 0 NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`at_risk` text DEFAULT '[]' NOT NULL,
	`unplaceable` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts_utc` text NOT NULL,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at_utc` text
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`project_id` text,
	`project_name` text,
	`priority` integer DEFAULT 1 NOT NULL,
	`due_date` text,
	`due_datetime_utc` text,
	`duration_min` integer,
	`labels` text DEFAULT '[]' NOT NULL,
	`url` text,
	`is_completed` integer DEFAULT 0 NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	`skip_scheduling` integer DEFAULT 0 NOT NULL,
	`force_schedule` integer DEFAULT 0 NOT NULL,
	`created_at_utc` text,
	`last_pushed_hash` text,
	`synced_at_utc` text
);
