CREATE TABLE `layout_cache` (
	`mode` text NOT NULL,
	`node_id` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`updated_at_utc` text,
	PRIMARY KEY(`mode`, `node_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_layout_cache_mode` ON `layout_cache` (`mode`);
--> statement-breakpoint
CREATE TABLE `graph_jobs` (
	`name` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`cursor` text,
	`queued_at_utc` text,
	`started_at_utc` text,
	`completed_at_utc` text,
	`error` text
);
