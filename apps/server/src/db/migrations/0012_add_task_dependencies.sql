CREATE TABLE `task_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`blocker_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	`created_at_utc` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_dep_pair` ON `task_dependencies` (`blocker_id`,`blocked_id`);--> statement-breakpoint
CREATE INDEX `idx_task_dep_blocked` ON `task_dependencies` (`blocked_id`);--> statement-breakpoint
CREATE INDEX `idx_task_dep_blocker` ON `task_dependencies` (`blocker_id`);
