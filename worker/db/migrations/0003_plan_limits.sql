CREATE TABLE `limit_override` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`key` text NOT NULL,
	`value` integer,
	`expires_at` integer,
	`note` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `limit_override_household_key_unique` ON `limit_override` (`household_id`,`key`);--> statement-breakpoint
CREATE TABLE `plan_limits` (
	`tier` text NOT NULL,
	`key` text NOT NULL,
	`value` integer,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	PRIMARY KEY(`tier`, `key`),
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
