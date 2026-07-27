ALTER TABLE `ai_runs` ADD COLUMN `reasoning_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD COLUMN `billable_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD COLUMN `cached_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD COLUMN `estimated_usd` real;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD COLUMN `route_tier` text DEFAULT 'cheap-cloud' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD COLUMN `parent_attempt_id` text;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD COLUMN `cache_status` text DEFAULT 'miss' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD COLUMN `escalation_reason` text;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD COLUMN `tool_names` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_runs` ADD COLUMN `context_breakdown` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ai_embedding_cache` (
  `model` text NOT NULL,
  `dimensions` integer NOT NULL,
  `content_hash` text NOT NULL,
  `vector` text NOT NULL,
  `created_at_utc` text NOT NULL,
  PRIMARY KEY(`model`, `dimensions`, `content_hash`)
);
