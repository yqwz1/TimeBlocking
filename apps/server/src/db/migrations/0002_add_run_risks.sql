ALTER TABLE `schedule_runs` ADD `risks` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `schedule_runs` ADD `day_loads` text DEFAULT '[]' NOT NULL;