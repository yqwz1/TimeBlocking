CREATE TABLE IF NOT EXISTS `action_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`title` text NOT NULL,
	`preview` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`reasoning` text DEFAULT '' NOT NULL,
	`evidence_ids` text DEFAULT '[]' NOT NULL,
	`risk_level` text DEFAULT 'low' NOT NULL,
	`expires_at_utc` text NOT NULL,
	`affected_records` text DEFAULT '[]' NOT NULL,
	`freshness_version` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`error` text,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL,
	`executed_at_utc` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_action_idempotency` ON `action_proposals` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_action_status` ON `action_proposals` (`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ai_response_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`expires_at_utc` text NOT NULL,
	`created_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ai_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`cache_key` text,
	`status` text NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`retrieved_record_ids` text DEFAULT '[]' NOT NULL,
	`error` text,
	`created_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ai_runs_task_created` ON `ai_runs` (`task`,`created_at_utc`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `assistant_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`rating` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_assistant_feedback_message` ON `assistant_feedback` (`message_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `assistant_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`citations` text DEFAULT '[]' NOT NULL,
	`memories_used` text DEFAULT '[]' NOT NULL,
	`uncertainties` text DEFAULT '[]' NOT NULL,
	`proposed_action_ids` text DEFAULT '[]' NOT NULL,
	`created_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_assistant_messages_thread` ON `assistant_messages` (`thread_id`,`created_at_utc`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `assistant_summaries` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`through_message_id` text NOT NULL,
	`summary` text NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `assistant_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL,
	`last_message_at_utc` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `commitments` (
	`id` text PRIMARY KEY NOT NULL,
	`direction` text NOT NULL,
	`title` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`person_entity_id` text,
	`due_at_utc` text,
	`status` text DEFAULT 'open' NOT NULL,
	`evidence_ids` text DEFAULT '[]' NOT NULL,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_commitments_status_due` ON `commitments` (`status`,`due_at_utc`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `communities` (
	`id` text PRIMARY KEY NOT NULL,
	`level` integer NOT NULL,
	`parent_id` text,
	`label` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`members` text DEFAULT '[]' NOT NULL,
	`member_count` integer DEFAULT 0 NOT NULL,
	`ai_generated` integer DEFAULT 0 NOT NULL,
	`updated_at_utc` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_communities_level` ON `communities` (`level`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `concept_blacklist` (
	`norm_key` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `concept_extractions` (
	`note_id` text PRIMARY KEY NOT NULL,
	`content_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `concept_mentions` (
	`concept_id` text NOT NULL,
	`note_id` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`concept_id`, `note_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_concept_mentions_note` ON `concept_mentions` (`note_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_concept_mentions_concept` ON `concept_mentions` (`concept_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`norm_key` text NOT NULL,
	`created_at_utc` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_concepts_norm` ON `concepts` (`norm_key`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `connector_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`account_label` text NOT NULL,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`selected_scopes` text DEFAULT '[]' NOT NULL,
	`selected_sources` text DEFAULT '[]' NOT NULL,
	`ai_processing_enabled` integer DEFAULT 0 NOT NULL,
	`credential_ref` text,
	`last_cursor` text,
	`last_synced_at_utc` text,
	`last_error` text,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_connector_provider_label` ON `connector_accounts` (`provider`,`account_label`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `connector_items` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_item_id` text NOT NULL,
	`source_label` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`participants` text DEFAULT '[]' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`evidence_excerpt` text DEFAULT '' NOT NULL,
	`content_hash` text NOT NULL,
	`deep_link` text,
	`occurred_at_utc` text,
	`deleted_at_utc` text,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_connector_item_provider` ON `connector_items` (`account_id`,`provider_item_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_connector_items_occurred` ON `connector_items` (`occurred_at_utc`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`decision` text NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`alternatives` text DEFAULT '[]' NOT NULL,
	`participant_entity_ids` text DEFAULT '[]' NOT NULL,
	`outcome` text,
	`decided_at_utc` text NOT NULL,
	`evidence_ids` text DEFAULT '[]' NOT NULL,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_decisions_decided` ON `decisions` (`decided_at_utc`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `domain_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`occurred_at_utc` text NOT NULL,
	`processed_at_utc` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_domain_events_unprocessed` ON `domain_events` (`processed_at_utc`,`seq`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `durable_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`dedupe_key` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`available_at_utc` text NOT NULL,
	`lease_owner` text,
	`lease_expires_at_utc` text,
	`checkpoint` text DEFAULT '{}' NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL,
	`completed_at_utc` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_durable_jobs_dedupe` ON `durable_jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_durable_jobs_claim` ON `durable_jobs` (`status`,`available_at_utc`,`lease_expires_at_utc`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`meeting_url` text,
	`color` text,
	`priority` integer DEFAULT 1 NOT NULL,
	`difficulty` text,
	`start_utc` text NOT NULL,
	`end_utc` text NOT NULL,
	`reminder_minutes_before` integer,
	`reminder_fired_at_utc` text,
	`gcal_event_id` text,
	`calendar_id` text,
	`last_pushed_hash` text,
	`created_at_utc` text,
	`updated_at_utc` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_events_start` ON `events` (`start_utc`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `goal_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`title` text NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`completed_at_utc` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_goal_milestones_goal` ON `goal_milestones` (`goal_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`target_value` integer,
	`target_unit` text,
	`current_value` integer DEFAULT 0 NOT NULL,
	`achievable` text DEFAULT '' NOT NULL,
	`relevance` text DEFAULT '' NOT NULL,
	`year` integer NOT NULL,
	`quarter` integer NOT NULL,
	`custom_deadline` text,
	`link_kind` text,
	`link_value` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at_utc` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `graph_edges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`target` text NOT NULL,
	`type` text NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'explicit' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_graph_edges_unique` ON `graph_edges` (`source`,`target`,`type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_graph_edges_source` ON `graph_edges` (`source`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_graph_edges_target` ON `graph_edges` (`target`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `graph_jobs` (
	`name` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`cursor` text,
	`queued_at_utc` text,
	`started_at_utc` text,
	`completed_at_utc` text,
	`error` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `index_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`model` text NOT NULL,
	`dimensions` integer,
	`status` text DEFAULT 'building' NOT NULL,
	`record_count` integer DEFAULT 0 NOT NULL,
	`activated_at_utc` text,
	`created_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_index_versions_kind_status` ON `index_versions` (`kind`,`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_entities` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`canonical_name` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`sensitivity` text DEFAULT 'normal' NOT NULL,
	`merged_into_id` text,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_knowledge_entity_kind` ON `knowledge_entities` (`kind`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_knowledge_entity_status` ON `knowledge_entities` (`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_records` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`source_version` text NOT NULL,
	`title` text NOT NULL,
	`excerpt` text DEFAULT '' NOT NULL,
	`content_hash` text,
	`occurred_at_utc` text,
	`sensitivity` text DEFAULT 'normal' NOT NULL,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL,
	`deleted_at_utc` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_knowledge_source` ON `knowledge_records` (`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_knowledge_source_type` ON `knowledge_records` (`source_type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_knowledge_occurred` ON `knowledge_records` (`occurred_at_utc`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`source_entity_id` text NOT NULL,
	`target_entity_id` text NOT NULL,
	`type` text NOT NULL,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`valid_from_utc` text,
	`valid_to_utc` text,
	`evidence_ids` text DEFAULT '[]' NOT NULL,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_knowledge_relation_unique` ON `knowledge_relations` (`source_entity_id`,`target_entity_id`,`type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_knowledge_relation_source` ON `knowledge_relations` (`source_entity_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_knowledge_relation_target` ON `knowledge_relations` (`target_entity_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `layout_cache` (
	`mode` text NOT NULL,
	`node_id` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`updated_at_utc` text,
	PRIMARY KEY(`mode`, `node_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_layout_cache_mode` ON `layout_cache` (`mode`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memory_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_class` text NOT NULL,
	`claim` text NOT NULL,
	`normalized_claim` text NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`sensitivity` text DEFAULT 'normal' NOT NULL,
	`valid_from_utc` text,
	`valid_to_utc` text,
	`expires_at_utc` text,
	`last_used_at_utc` text,
	`supersedes_id` text,
	`contradicted_by_id` text,
	`created_at_utc` text NOT NULL,
	`updated_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_memory_status` ON `memory_claims` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_memory_class` ON `memory_claims` (`memory_class`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memory_evidence` (
	`memory_id` text NOT NULL,
	`knowledge_record_id` text NOT NULL,
	`excerpt` text DEFAULT '' NOT NULL,
	`created_at_utc` text NOT NULL,
	PRIMARY KEY(`memory_id`, `knowledge_record_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_memory_evidence_record` ON `memory_evidence` (`knowledge_record_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `node_metrics` (
	`note_id` text PRIMARY KEY NOT NULL,
	`degree` integer DEFAULT 0 NOT NULL,
	`pagerank` real DEFAULT 0 NOT NULL,
	`betweenness` real DEFAULT 0 NOT NULL,
	`community_id` text,
	`open_tasks` integer DEFAULT 0 NOT NULL,
	`time_spent_min` integer DEFAULT 0 NOT NULL,
	`updated_at_utc` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `note_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`note_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`text` text NOT NULL,
	`embedding` text NOT NULL,
	`content_hash` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_note_chunks_note` ON `note_chunks` (`note_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `note_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`target_title` text NOT NULL,
	`target_id` text,
	`snippet` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_note_links_source` ON `note_links` (`source_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_note_links_target` ON `note_links` (`target_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_note_links_target_title` ON `note_links` (`target_title`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `note_shares` (
	`note_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`created_at_utc` text NOT NULL,
	`revoked_at_utc` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_note_shares_token` ON `note_shares` (`token`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`frontmatter` text DEFAULT '{}' NOT NULL,
	`content_hash` text NOT NULL,
	`created_at_utc` text,
	`updated_at_utc` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_notes_title` ON `notes` (`title`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `plan_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at_utc` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`scope_date` text NOT NULL,
	`desired` text DEFAULT '[]' NOT NULL,
	`pins` text DEFAULT '[]' NOT NULL,
	`rejected_task_ids` text DEFAULT '[]' NOT NULL,
	`summary` text DEFAULT '{}' NOT NULL,
	`risks` text DEFAULT '[]' NOT NULL,
	`day_loads` text DEFAULT '[]' NOT NULL,
	`applied_at_utc` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `proactive_insights` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`evidence_ids` text DEFAULT '[]' NOT NULL,
	`cooldown_key` text NOT NULL,
	`surfaced_at_utc` text,
	`expires_at_utc` text,
	`helpful` integer,
	`created_at_utc` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_proactive_cooldown` ON `proactive_insights` (`cooldown_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_proactive_status` ON `proactive_insights` (`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `study_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`kind` text DEFAULT 'qa' NOT NULL,
	`prompt` text NOT NULL,
	`answer` text NOT NULL,
	`due_date` text NOT NULL,
	`ease_factor` real DEFAULT 2.5 NOT NULL,
	`interval_days` integer DEFAULT 0 NOT NULL,
	`repetitions` integer DEFAULT 0 NOT NULL,
	`last_reviewed_at_utc` text,
	`created_at_utc` text,
	`updated_at_utc` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_study_cards_due` ON `study_cards` (`due_date`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_study_cards_note` ON `study_cards` (`note_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `suggested_edge_dismissals` (
	`source` text NOT NULL,
	`target` text NOT NULL,
	`dismissed_at_utc` text,
	PRIMARY KEY(`source`, `target`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `task_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`blocker_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	`created_at_utc` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_task_dep_pair` ON `task_dependencies` (`blocker_id`,`blocked_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_task_dep_blocked` ON `task_dependencies` (`blocked_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_task_dep_blocker` ON `task_dependencies` (`blocker_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `whiteboard_files` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer,
	`created_at_utc` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wb_files_board` ON `whiteboard_files` (`board_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `whiteboard_scenes` (
	`board_id` text PRIMARY KEY NOT NULL,
	`elements` text DEFAULT '[]' NOT NULL,
	`app_state` text DEFAULT '{}' NOT NULL,
	`updated_at_utc` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `whiteboards` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at_utc` text,
	`updated_at_utc` text
);
