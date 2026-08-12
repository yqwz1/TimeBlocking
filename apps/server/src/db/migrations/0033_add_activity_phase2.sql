CREATE TABLE `activity_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text NOT NULL,
	`verification_mode` text DEFAULT 'manual' NOT NULL,
	`permitted_tool_groups` text DEFAULT '[]' NOT NULL,
	`notification_preferences` text DEFAULT '{}' NOT NULL,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_activity_profiles_scope` ON `activity_profiles` (`scope`,`scope_id`);
--> statement-breakpoint
CREATE TABLE `block_activity_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`block_id` text NOT NULL,
	`formula_version` text NOT NULL,
	`actual_start_utc` text,
	`actual_end_utc` text,
	`start_latency_min` real,
	`coverage` real DEFAULT 0 NOT NULL,
	`relevant_min` real DEFAULT 0 NOT NULL,
	`supporting_min` real DEFAULT 0 NOT NULL,
	`distraction_min` real DEFAULT 0 NOT NULL,
	`idle_min` real DEFAULT 0 NOT NULL,
	`unknown_min` real DEFAULT 0 NOT NULL,
	`context_switches` integer DEFAULT 0 NOT NULL,
	`return_latency_min` real,
	`longest_focus_session_min` real DEFAULT 0 NOT NULL,
	`continuity` real DEFAULT 0 NOT NULL,
	`focus_ratio` real,
	`focus_quality` real,
	`primary_category` text,
	`overrun_min` real DEFAULT 0 NOT NULL,
	`confidence` real,
	`verification_state` text DEFAULT 'unobserved' NOT NULL,
	`correction_json` text,
	`corrected_at_utc` text,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_activity_summary_block` ON `block_activity_summaries` (`block_id`);
--> statement-breakpoint
CREATE INDEX `idx_activity_summary_state` ON `block_activity_summaries` (`verification_state`);
--> statement-breakpoint
CREATE TABLE `activity_recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`block_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`cooldown_key` text,
	`expires_at_utc` text,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_activity_recommendations_status` ON `activity_recommendations` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_activity_recommendations_block` ON `activity_recommendations` (`block_id`);
