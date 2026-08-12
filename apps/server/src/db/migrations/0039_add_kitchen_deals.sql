CREATE TABLE `kitchen_deals` (
	`id` text PRIMARY KEY NOT NULL,
	`source_offer_id` text NOT NULL,
	`category` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`store` text NOT NULL,
	`location` text NOT NULL,
	`price_sar` real NOT NULL,
	`previous_price_sar` real NOT NULL,
	`discount_pct` integer NOT NULL,
	`quality` text NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`image_url` text,
	`source_url` text NOT NULL,
	`fetched_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_kitchen_deals_quality` ON `kitchen_deals` (`quality`);
--> statement-breakpoint
CREATE INDEX `idx_kitchen_deals_category` ON `kitchen_deals` (`category`);
--> statement-breakpoint
CREATE INDEX `idx_kitchen_deals_valid_to` ON `kitchen_deals` (`valid_to`);
--> statement-breakpoint
CREATE TABLE `kitchen_deal_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`location` text NOT NULL,
	`region_code` text NOT NULL,
	`refreshed_date_local` text,
	`refreshed_at_utc` text,
	`last_attempt_at_utc` text,
	`last_error` text
);
