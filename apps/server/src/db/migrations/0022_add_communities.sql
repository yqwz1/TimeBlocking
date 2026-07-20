CREATE TABLE `communities` (
	`id` text PRIMARY KEY NOT NULL,
	`level` integer NOT NULL,
	`parent_id` text,
	`label` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`members` text DEFAULT '[]' NOT NULL,
	`member_count` integer DEFAULT 0 NOT NULL,
	`ai_generated` integer DEFAULT 0 NOT NULL,
	`updated_at_utc` text
);
--> statement-breakpoint
CREATE INDEX `idx_communities_level` ON `communities` (`level`);
