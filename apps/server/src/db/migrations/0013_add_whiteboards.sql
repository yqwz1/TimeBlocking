CREATE TABLE `whiteboards` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at_utc` text,
	`updated_at_utc` text
);
--> statement-breakpoint
CREATE TABLE `whiteboard_scenes` (
	`board_id` text PRIMARY KEY NOT NULL,
	`elements` text DEFAULT '[]' NOT NULL,
	`app_state` text DEFAULT '{}' NOT NULL,
	`updated_at_utc` text
);
--> statement-breakpoint
CREATE TABLE `whiteboard_files` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer,
	`created_at_utc` text
);
--> statement-breakpoint
CREATE INDEX `idx_wb_files_board` ON `whiteboard_files` (`board_id`);
