CREATE TABLE `knowledge_embeddings` (
	`index_version_id` text NOT NULL,
	`record_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`vector` text NOT NULL,
	`created_at_utc` text NOT NULL,
	PRIMARY KEY(`index_version_id`, `record_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_embeddings_record` ON `knowledge_embeddings` (`record_id`);