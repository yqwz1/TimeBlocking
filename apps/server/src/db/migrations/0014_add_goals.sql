CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`target_value` integer,
	`target_unit` text,
	`current_value` integer DEFAULT 0 NOT NULL,
	`achievable` text DEFAULT '' NOT NULL,
	`relevance` text DEFAULT '' NOT NULL,
	`year` integer NOT NULL,
	`quarter` integer NOT NULL,
	`custom_deadline` text,
	`link_kind` text,
	`link_value` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at_utc` text
);
--> statement-breakpoint
CREATE TABLE `goal_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`title` text NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`completed_at_utc` text
);
--> statement-breakpoint
CREATE INDEX `idx_goal_milestones_goal` ON `goal_milestones` (`goal_id`);
