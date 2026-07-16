CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`meeting_url` text,
	`color` text,
	`priority` integer DEFAULT 1 NOT NULL,
	`difficulty` text,
	`start_utc` text NOT NULL,
	`end_utc` text NOT NULL,
	`reminder_minutes_before` integer,
	`reminder_fired_at_utc` text,
	`gcal_event_id` text,
	`calendar_id` text,
	`last_pushed_hash` text,
	`created_at_utc` text,
	`updated_at_utc` text
);
--> statement-breakpoint
CREATE INDEX `idx_events_start` ON `events` (`start_utc`);
