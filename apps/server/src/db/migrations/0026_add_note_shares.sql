CREATE TABLE `note_shares` (
	`note_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`created_at_utc` text NOT NULL,
	`revoked_at_utc` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_note_shares_token` ON `note_shares` (`token`);
