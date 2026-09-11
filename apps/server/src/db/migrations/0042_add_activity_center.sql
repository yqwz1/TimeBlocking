ALTER TABLE `computer_activity_events` ADD `partition_start_utc` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `computer_activity_events` ADD `fingerprint` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `computer_activity_events` ADD `activitywatch_category` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_activity_event_fingerprint` ON `computer_activity_events` (`source_id`,`partition_start_utc`,`fingerprint`) WHERE `fingerprint` <> '';
--> statement-breakpoint
CREATE INDEX `idx_activity_events_partition` ON `computer_activity_events` (`source_id`,`partition_start_utc`);
--> statement-breakpoint
CREATE TABLE `activity_classification_rules` (`id` text PRIMARY KEY NOT NULL, `scope` text NOT NULL, `scope_id` text, `match_type` text NOT NULL, `match_value` text NOT NULL, `classification` text NOT NULL, `created_at_utc` text NOT NULL, `updated_at_utc` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `idx_activity_rules_scope` ON `activity_classification_rules` (`scope`,`scope_id`);
--> statement-breakpoint
CREATE INDEX `idx_activity_rules_match` ON `activity_classification_rules` (`match_type`,`match_value`);
--> statement-breakpoint
CREATE TABLE `focus_work_sessions` (`id` text PRIMARY KEY NOT NULL, `task_id` text, `project_id` text, `phase` text NOT NULL, `state` text NOT NULL, `occurred_at_utc` text NOT NULL, `created_at_utc` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `idx_focus_sessions_occurred` ON `focus_work_sessions` (`occurred_at_utc`);
--> statement-breakpoint
CREATE INDEX `idx_focus_sessions_task` ON `focus_work_sessions` (`task_id`);
--> statement-breakpoint
CREATE TABLE `activity_experiments` (`id` text PRIMARY KEY NOT NULL, `kind` text NOT NULL, `title` text NOT NULL, `detail` text NOT NULL, `status` text DEFAULT 'active' NOT NULL, `baseline_json` text DEFAULT '{}' NOT NULL, `result_json` text, `started_at_utc` text NOT NULL, `ends_at_utc` text NOT NULL, `created_at_utc` text NOT NULL, `updated_at_utc` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `idx_activity_experiments_status` ON `activity_experiments` (`status`);
