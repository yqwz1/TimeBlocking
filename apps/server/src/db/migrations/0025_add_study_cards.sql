CREATE TABLE `study_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`kind` text DEFAULT 'qa' NOT NULL,
	`prompt` text NOT NULL,
	`answer` text NOT NULL,
	`due_date` text NOT NULL,
	`ease_factor` real DEFAULT 2.5 NOT NULL,
	`interval_days` integer DEFAULT 0 NOT NULL,
	`repetitions` integer DEFAULT 0 NOT NULL,
	`last_reviewed_at_utc` text,
	`created_at_utc` text,
	`updated_at_utc` text
);
--> statement-breakpoint
CREATE INDEX `idx_study_cards_due` ON `study_cards` (`due_date`);
--> statement-breakpoint
CREATE INDEX `idx_study_cards_note` ON `study_cards` (`note_id`);
