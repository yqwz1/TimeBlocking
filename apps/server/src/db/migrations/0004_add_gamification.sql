CREATE TABLE `achievements_unlocked` (
	`id` text PRIMARY KEY NOT NULL,
	`unlocked_at_utc` text NOT NULL,
	`xp_awarded` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `day_results` (
	`date` text PRIMARY KEY NOT NULL,
	`result` text NOT NULL,
	`done_count` integer DEFAULT 0 NOT NULL,
	`missed_count` integer DEFAULT 0 NOT NULL,
	`planned_count` integer DEFAULT 0 NOT NULL,
	`streak_after` integer DEFAULT 0 NOT NULL,
	`freezes_after` integer DEFAULT 0 NOT NULL,
	`decided_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gamification_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `xp_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`source_id` text NOT NULL,
	`amount` integer NOT NULL,
	`date_local` text NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_xp_source` ON `xp_events` (`kind`,`source_id`);--> statement-breakpoint
CREATE INDEX `idx_xp_date` ON `xp_events` (`date_local`);
