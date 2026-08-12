CREATE TABLE `activity_ai_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL,
	`payload_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at_utc` text NOT NULL,
	`used_at_utc` text,
	`created_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_activity_ai_previews_hash` ON `activity_ai_previews` (`payload_hash`);
--> statement-breakpoint
CREATE INDEX `idx_activity_ai_previews_expiry` ON `activity_ai_previews` (`expires_at_utc`);
