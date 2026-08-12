CREATE TABLE `kitchen_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`daily_protein_target` real DEFAULT 120 NOT NULL,
	`warning_coverage_days` integer DEFAULT 7 NOT NULL,
	`forecast_days` integer DEFAULT 30 NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kitchen_foods` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'Protein' NOT NULL,
	`unit` text NOT NULL,
	`preparation_state` text DEFAULT 'as_packaged' NOT NULL,
	`nutrition_basis_amount` real NOT NULL,
	`protein_per_basis` real NOT NULL,
	`calories_per_basis` real,
	`carbs_per_basis` real,
	`fat_per_basis` real,
	`portion_mode` text DEFAULT 'whole' NOT NULL,
	`planning_increment` real,
	`daily_max_quantity` real,
	`low_stock_threshold` real,
	`planner_eligible` integer DEFAULT 1 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_kitchen_foods_archived` ON `kitchen_foods` (`archived`);--> statement-breakpoint
CREATE INDEX `idx_kitchen_foods_name` ON `kitchen_foods` (`name`);--> statement-breakpoint
CREATE TABLE `kitchen_stock_portions` (
	`id` text PRIMARY KEY NOT NULL,
	`food_id` text NOT NULL,
	`label` text,
	`original_quantity` real NOT NULL,
	`remaining_quantity` real NOT NULL,
	`expires_on` text,
	`status` text DEFAULT 'available' NOT NULL,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_kitchen_stock_food` ON `kitchen_stock_portions` (`food_id`);--> statement-breakpoint
CREATE INDEX `idx_kitchen_stock_expiry` ON `kitchen_stock_portions` (`expires_on`);--> statement-breakpoint
CREATE INDEX `idx_kitchen_stock_status` ON `kitchen_stock_portions` (`status`);--> statement-breakpoint
CREATE TABLE `kitchen_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`date_local` text NOT NULL,
	`target_protein_g` real NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_kitchen_plans_date` ON `kitchen_plans` (`date_local`);--> statement-breakpoint
CREATE INDEX `idx_kitchen_plans_status` ON `kitchen_plans` (`status`);--> statement-breakpoint
CREATE TABLE `kitchen_plan_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`food_id` text NOT NULL,
	`stock_portion_id` text NOT NULL,
	`planned_quantity` real NOT NULL,
	`actual_quantity` real,
	`status` text DEFAULT 'planned' NOT NULL,
	`protein_g` real NOT NULL,
	`calories_kcal` real,
	`carbs_g` real,
	`fat_g` real,
	`created_at_utc` text NOT NULL,
	`consumed_at_utc` text
);
--> statement-breakpoint
CREATE INDEX `idx_kitchen_plan_lines_plan` ON `kitchen_plan_lines` (`plan_id`);--> statement-breakpoint
CREATE INDEX `idx_kitchen_plan_lines_stock` ON `kitchen_plan_lines` (`stock_portion_id`);--> statement-breakpoint
CREATE INDEX `idx_kitchen_plan_lines_status` ON `kitchen_plan_lines` (`status`);--> statement-breakpoint
CREATE TABLE `kitchen_stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`food_id` text NOT NULL,
	`stock_portion_id` text NOT NULL,
	`plan_line_id` text,
	`delta_quantity` real NOT NULL,
	`reason` text NOT NULL,
	`date_local` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`protein_g` real DEFAULT 0 NOT NULL,
	`calories_kcal` real,
	`carbs_g` real,
	`fat_g` real,
	`reversal_of_id` text,
	`reversed_at_utc` text,
	`created_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_kitchen_movements_date` ON `kitchen_stock_movements` (`date_local`);--> statement-breakpoint
CREATE INDEX `idx_kitchen_movements_stock` ON `kitchen_stock_movements` (`stock_portion_id`);--> statement-breakpoint
CREATE INDEX `idx_kitchen_movements_plan_line` ON `kitchen_stock_movements` (`plan_line_id`);
