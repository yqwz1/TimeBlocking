CREATE TABLE `wishlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`product_url` text,
	`image_url` text,
	`image_file_name` text,
	`retailer` text,
	`category` text DEFAULT 'Other' NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'considering' NOT NULL,
	`price_minor` integer,
	`target_date` text,
	`purchased_at` text,
	`actual_price_minor` integer,
	`goal_ids` text DEFAULT '[]' NOT NULL,
	`advice` text,
	`advice_input_hash` text,
	`advice_analyzed_at_utc` text,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_wishlist_status` ON `wishlist_items` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_wishlist_category` ON `wishlist_items` (`category`);
--> statement-breakpoint
CREATE INDEX `idx_wishlist_target_date` ON `wishlist_items` (`target_date`);
--> statement-breakpoint
CREATE INDEX `idx_wishlist_purchased_at` ON `wishlist_items` (`purchased_at`);
--> statement-breakpoint
CREATE TABLE `wishlist_budgets` (
	`month` text PRIMARY KEY NOT NULL,
	`amount_minor` integer DEFAULT 0 NOT NULL,
	`updated_at_utc` text NOT NULL
);
