CREATE TABLE `ai_outcome` (
	`id` text PRIMARY KEY NOT NULL,
	`import_job_id` text NOT NULL,
	`source` text NOT NULL,
	`outcome` text NOT NULL,
	`path` text NOT NULL,
	`setup` text NOT NULL,
	`reads` text NOT NULL,
	`lines_fixed` integer,
	`created_at` integer NOT NULL,
	`decided_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_outcome_import_job_id_unique` ON `ai_outcome` (`import_job_id`);--> statement-breakpoint
CREATE INDEX `ai_outcome_decided_idx` ON `ai_outcome` (`decided_at`);