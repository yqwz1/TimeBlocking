CREATE TABLE `workout_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`command` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`result` text,
	`error` text,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL,
	`completed_at_utc` text
);
--> statement-breakpoint
CREATE INDEX `idx_workout_jobs_status` ON `workout_jobs` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_workout_jobs_created` ON `workout_jobs` (`created_at_utc`);
