CREATE TABLE `daily_plans` (
	`date` text PRIMARY KEY NOT NULL,
	`highlight` text DEFAULT '' NOT NULL,
	`highlight_task_id` text,
	`highlight_done` integer DEFAULT 0 NOT NULL,
	`reflection` text DEFAULT '' NOT NULL,
	`rating` integer,
	`intention` text DEFAULT '' NOT NULL,
	`shutdown_done_at_utc` text,
	`done_count` integer DEFAULT 0 NOT NULL,
	`missed_count` integer DEFAULT 0 NOT NULL,
	`planned_count` integer DEFAULT 0 NOT NULL,
	`completed_min` integer DEFAULT 0 NOT NULL,
	`created_at_utc` text,
	`updated_at_utc` text
);
--> statement-breakpoint
CREATE TABLE `weekly_reviews` (
	`week_start` text PRIMARY KEY NOT NULL,
	`wins` text DEFAULT '' NOT NULL,
	`challenges` text DEFAULT '' NOT NULL,
	`next_week_focus` text DEFAULT '' NOT NULL,
	`rating` integer,
	`reviewed_at_utc` text,
	`planned_min` integer DEFAULT 0 NOT NULL,
	`completed_min` integer DEFAULT 0 NOT NULL,
	`missed_min` integer DEFAULT 0 NOT NULL,
	`objectives_done` integer DEFAULT 0 NOT NULL,
	`objectives_total` integer DEFAULT 0 NOT NULL,
	`created_at_utc` text,
	`updated_at_utc` text
);
