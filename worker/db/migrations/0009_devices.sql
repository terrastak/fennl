CREATE TABLE `device` (
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`household_id` text NOT NULL,
	`label` text NOT NULL,
	`session_id` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_reason` text,
	PRIMARY KEY(`user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `device_household_idx` ON `device` (`household_id`);--> statement-breakpoint
CREATE INDEX `device_session_idx` ON `device` (`session_id`);