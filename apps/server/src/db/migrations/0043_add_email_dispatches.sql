CREATE TABLE `email_dispatches` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `dedupe_key` text NOT NULL,
  `block_id` text,
  `intended_send_at_utc` text NOT NULL,
  `next_attempt_at_utc` text NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `provider_message_id` text,
  `status` text DEFAULT 'pending' NOT NULL,
  `last_error` text,
  `created_at_utc` text NOT NULL,
  `updated_at_utc` text NOT NULL,
  `sent_at_utc` text,
  `skipped_at_utc` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_email_dispatch_dedupe` ON `email_dispatches` (`dedupe_key`);
--> statement-breakpoint
CREATE INDEX `idx_email_dispatch_due` ON `email_dispatches` (`status`,`next_attempt_at_utc`);
--> statement-breakpoint
CREATE INDEX `idx_email_dispatch_block` ON `email_dispatches` (`block_id`);
