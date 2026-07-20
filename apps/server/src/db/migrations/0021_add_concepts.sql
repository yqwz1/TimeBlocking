CREATE TABLE `concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`norm_key` text NOT NULL,
	`created_at_utc` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_concepts_norm` ON `concepts` (`norm_key`);
--> statement-breakpoint
CREATE TABLE `concept_mentions` (
	`concept_id` text NOT NULL,
	`note_id` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`concept_id`, `note_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_concept_mentions_note` ON `concept_mentions` (`note_id`);
--> statement-breakpoint
CREATE INDEX `idx_concept_mentions_concept` ON `concept_mentions` (`concept_id`);
--> statement-breakpoint
CREATE TABLE `concept_extractions` (
	`note_id` text PRIMARY KEY NOT NULL,
	`content_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `concept_blacklist` (
	`norm_key` text PRIMARY KEY NOT NULL
);
