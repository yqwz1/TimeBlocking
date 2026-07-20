CREATE TABLE `note_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`note_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`text` text NOT NULL,
	`embedding` text NOT NULL,
	`content_hash` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_note_chunks_note` ON `note_chunks` (`note_id`);
