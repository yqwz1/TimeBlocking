CREATE TABLE `node_metrics` (
	`note_id` text PRIMARY KEY NOT NULL,
	`degree` integer DEFAULT 0 NOT NULL,
	`pagerank` real DEFAULT 0 NOT NULL,
	`betweenness` real DEFAULT 0 NOT NULL,
	`community_id` text,
	`open_tasks` integer DEFAULT 0 NOT NULL,
	`time_spent_min` integer DEFAULT 0 NOT NULL,
	`updated_at_utc` text
);
--> statement-breakpoint
CREATE TABLE `graph_edges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`target` text NOT NULL,
	`type` text NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'explicit' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_graph_edges_unique` ON `graph_edges` (`source`,`target`,`type`);
--> statement-breakpoint
CREATE INDEX `idx_graph_edges_source` ON `graph_edges` (`source`);
--> statement-breakpoint
CREATE INDEX `idx_graph_edges_target` ON `graph_edges` (`target`);
