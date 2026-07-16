CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`created_at_utc` text
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_task` ON `attachments` (`task_id`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at_utc` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_labels_name` ON `labels` (`name`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`created_at_utc` text
);
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`remind_at_utc` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`fired_at_utc` text,
	`created_at_utc` text
);
--> statement-breakpoint
CREATE INDEX `idx_reminders_task` ON `reminders` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_reminders_remind_at` ON `reminders` (`remind_at_utc`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `status` text DEFAULT 'todo' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `color` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `links` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `sort_order` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `completed_at_utc` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `updated_at_utc` text;--> statement-breakpoint
CREATE INDEX `idx_tasks_parent` ON `tasks` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `tasks` (`status`);--> statement-breakpoint
UPDATE `tasks` SET `status` = 'done', `completed_at_utc` = `synced_at_utc` WHERE `is_completed` = 1;--> statement-breakpoint
UPDATE `tasks` SET `links` = json_array(json_object('url', `url`, 'title', 'Link')) WHERE `url` IS NOT NULL AND `url` != '';--> statement-breakpoint
INSERT INTO `projects` (`id`, `name`, `description`, `color`, `sort_order`, `archived`, `created_at_utc`)
  SELECT DISTINCT `project_id`, COALESCE(`project_name`, 'Imported'), '', NULL, 0, 0, datetime('now')
  FROM `tasks` WHERE `project_id` IS NOT NULL AND `project_id` NOT IN (SELECT `id` FROM `projects`);--> statement-breakpoint
INSERT INTO `labels` (`id`, `name`, `color`, `created_at_utc`)
  SELECT lower(hex(randomblob(16))), name, NULL, datetime('now')
  FROM (SELECT DISTINCT je.value AS name FROM `tasks`, json_each(`tasks`.`labels`) je)
  WHERE name NOT IN (SELECT `name` FROM `labels`);