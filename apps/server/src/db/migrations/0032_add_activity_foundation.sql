CREATE TABLE `activity_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`port` integer NOT NULL,
	`version` text,
	`capabilities` text DEFAULT '{}' NOT NULL,
	`mode` text DEFAULT 'off' NOT NULL,
	`health` text DEFAULT 'disconnected' NOT NULL,
	`last_successful_sync_at_utc` text,
	`last_attempt_at_utc` text,
	`cursor` text,
	`backfill_status` text DEFAULT 'not_started' NOT NULL,
	`last_error_code` text,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_activity_sources_key` ON `activity_sources` (`source_key`);
--> statement-breakpoint
CREATE INDEX `idx_activity_sources_updated` ON `activity_sources` (`updated_at_utc`);
--> statement-breakpoint
CREATE TABLE `computer_activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`bucket_id` text NOT NULL,
	`source_event_id` text NOT NULL,
	`start_utc` text NOT NULL,
	`duration_sec` real NOT NULL,
	`application` text,
	`registrable_domain` text,
	`editor_project_key` text,
	`language` text,
	`category` text DEFAULT 'unknown' NOT NULL,
	`is_afk` integer DEFAULT 0 NOT NULL,
	`is_incognito` integer DEFAULT 0 NOT NULL,
	`keyboard_count` integer,
	`mouse_count` integer,
	`matched_rule_id` text,
	`ingested_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_activity_event_source` ON `computer_activity_events` (`source_id`,`bucket_id`,`source_event_id`);
--> statement-breakpoint
CREATE INDEX `idx_activity_events_start` ON `computer_activity_events` (`start_utc`);
--> statement-breakpoint
CREATE INDEX `idx_activity_events_source_start` ON `computer_activity_events` (`source_id`,`start_utc`);
