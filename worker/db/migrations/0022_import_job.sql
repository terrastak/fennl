CREATE TABLE `import_job` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`batch_id` text,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`draft` text,
	`provenance` text NOT NULL,
	`error` text,
	`recipe_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_job_household_idx` ON `import_job` (`household_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `import_job_batch_idx` ON `import_job` (`batch_id`);