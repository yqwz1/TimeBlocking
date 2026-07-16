CREATE TABLE `plan_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at_utc` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`scope_date` text NOT NULL,
	`desired` text DEFAULT '[]' NOT NULL,
	`pins` text DEFAULT '[]' NOT NULL,
	`rejected_task_ids` text DEFAULT '[]' NOT NULL,
	`summary` text DEFAULT '{}' NOT NULL,
	`risks` text DEFAULT '[]' NOT NULL,
	`day_loads` text DEFAULT '[]' NOT NULL,
	`applied_at_utc` text
);
