CREATE TABLE `suggested_edge_dismissals` (
	`source` text NOT NULL,
	`target` text NOT NULL,
	`dismissed_at_utc` text,
	PRIMARY KEY(`source`, `target`)
);
