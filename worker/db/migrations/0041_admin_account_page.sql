CREATE TABLE `account_event` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`details` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_event_user_idx` ON `account_event` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `account_event_created_idx` ON `account_event` (`created_at`);--> statement-breakpoint
CREATE TABLE `admin_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tier` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`revoked_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `admin_grant_household_idx` ON `admin_grant` (`household_id`);--> statement-breakpoint
CREATE TABLE `admin_handled` (
	`user_id` text NOT NULL,
	`finding` text NOT NULL,
	`fingerprint` text NOT NULL,
	`admin_user_id` text,
	`note` text,
	`handled_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `finding`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`admin_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
