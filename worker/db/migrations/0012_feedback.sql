CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`household_id` text,
	`message` text NOT NULL,
	`page` text,
	`app_version` text,
	`device` text NOT NULL,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`read_at` integer,
	`replied_at` integer,
	`done_at` integer,
	`note` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `feedback_created_idx` ON `feedback` (`created_at`);--> statement-breakpoint
CREATE INDEX `feedback_user_idx` ON `feedback` (`user_id`);