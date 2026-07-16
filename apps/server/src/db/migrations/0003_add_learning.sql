CREATE TABLE `block_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`task_id` text,
	`project_id` text,
	`outcome` text NOT NULL,
	`estimated_min` integer,
	`planned_min` integer DEFAULT 0 NOT NULL,
	`overrun_min` integer DEFAULT 0 NOT NULL,
	`hour_local` integer DEFAULT 0 NOT NULL,
	`dow_local` integer DEFAULT 0 NOT NULL,
	`recorded_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `learned_stats` (
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`value` real NOT NULL,
	`weight` real NOT NULL,
	`updated_at_utc` text,
	PRIMARY KEY(`scope`, `key`)
);
