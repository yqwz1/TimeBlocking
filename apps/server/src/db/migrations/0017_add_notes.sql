CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`frontmatter` text DEFAULT '{}' NOT NULL,
	`content_hash` text NOT NULL,
	`created_at_utc` text,
	`updated_at_utc` text
);
--> statement-breakpoint
CREATE INDEX `idx_notes_title` ON `notes` (`title`);
--> statement-breakpoint
CREATE TABLE `note_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`target_title` text NOT NULL,
	`target_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_note_links_source` ON `note_links` (`source_id`);
--> statement-breakpoint
CREATE INDEX `idx_note_links_target` ON `note_links` (`target_id`);
--> statement-breakpoint
CREATE INDEX `idx_note_links_target_title` ON `note_links` (`target_title`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `notes_fts` USING fts5(id UNINDEXED, title, body, tokenize = 'porter unicode61');
