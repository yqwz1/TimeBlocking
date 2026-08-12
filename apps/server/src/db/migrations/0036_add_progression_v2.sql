CREATE TABLE `progression_profiles` (
  `id` text PRIMARY KEY NOT NULL,
  `season_start_local` text NOT NULL,
  `active_streak` integer DEFAULT 0 NOT NULL,
  `longest_streak` integer DEFAULT 0 NOT NULL,
  `pending_weekly_credits` integer DEFAULT 0 NOT NULL,
  `created_at_utc` text NOT NULL,
  `updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `progression_seasons` (`id` text PRIMARY KEY NOT NULL, `start_local` text NOT NULL, `end_local` text NOT NULL, `archived_rank_points` integer, `archived_at_utc` text, `created_at_utc` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_progression_season_start` ON `progression_seasons` (`start_local`);
--> statement-breakpoint
CREATE TABLE `progression_ledger` (`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `season_id` text, `resource` text NOT NULL, `kind` text NOT NULL, `source_id` text NOT NULL, `amount` integer NOT NULL, `formula_version` text NOT NULL, `metadata` text DEFAULT '{}' NOT NULL, `created_at_utc` text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_progression_ledger_idempotency` ON `progression_ledger` (`resource`,`kind`,`source_id`,`season_id`);
--> statement-breakpoint
CREATE INDEX `idx_progression_ledger_season` ON `progression_ledger` (`season_id`,`seq`);
--> statement-breakpoint
CREATE TABLE `daily_contracts` (`date_local` text PRIMARY KEY NOT NULL, `season_id` text, `state` text DEFAULT 'open' NOT NULL, `optional_mission_id` text, `lock_at_utc` text NOT NULL, `locked_at_utc` text, `evaluated_at_utc` text, `created_at_utc` text NOT NULL, `updated_at_utc` text NOT NULL);
--> statement-breakpoint
CREATE TABLE `progression_missions` (`id` text PRIMARY KEY NOT NULL, `contract_date_local` text, `week_start_local` text, `season_id` text, `type` text NOT NULL, `title` text NOT NULL, `detail` text DEFAULT '' NOT NULL, `metric` text NOT NULL, `target` integer NOT NULL, `progress` integer DEFAULT 0 NOT NULL, `selected` integer DEFAULT 0 NOT NULL, `completed_at_utc` text, `reward_xp` integer DEFAULT 0 NOT NULL, `reward_credits` integer DEFAULT 0 NOT NULL, `reward_rank` integer DEFAULT 0 NOT NULL, `created_at_utc` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `idx_progression_missions_contract` ON `progression_missions` (`contract_date_local`);
--> statement-breakpoint
CREATE INDEX `idx_progression_missions_week` ON `progression_missions` (`week_start_local`);
--> statement-breakpoint
CREATE TABLE `progression_rewards` (`id` text PRIMARY KEY NOT NULL, `title` text NOT NULL, `description` text DEFAULT '' NOT NULL, `icon` text, `credit_cost` integer NOT NULL, `template` text DEFAULT 'custom' NOT NULL, `repeatable` integer DEFAULT 1 NOT NULL, `cooldown_days` integer DEFAULT 0 NOT NULL, `active` integer DEFAULT 1 NOT NULL, `real_world_price` text, `created_at_utc` text NOT NULL, `updated_at_utc` text NOT NULL);
--> statement-breakpoint
CREATE TABLE `progression_redemptions` (`id` text PRIMARY KEY NOT NULL, `reward_id` text NOT NULL, `credit_cost` integer NOT NULL, `status` text DEFAULT 'claimed' NOT NULL, `claimed_at_utc` text NOT NULL, `used_at_utc` text, `refunded_at_utc` text);
--> statement-breakpoint
CREATE INDEX `idx_progression_redemptions_reward` ON `progression_redemptions` (`reward_id`,`claimed_at_utc`);
--> statement-breakpoint
CREATE TABLE `progression_achievements` (`id` text PRIMARY KEY NOT NULL, `progress` integer DEFAULT 0 NOT NULL, `unlocked_at_utc` text, `updated_at_utc` text NOT NULL);
