ALTER TABLE `tasks` ADD `pinned` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `pinned` integer DEFAULT 0 NOT NULL;
