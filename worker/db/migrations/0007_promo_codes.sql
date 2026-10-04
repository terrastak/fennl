CREATE TABLE `app_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `premium_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`promo_code_id` text NOT NULL,
	`tier` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`promo_code_id`) REFERENCES `promo_code`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `premium_grant_user_code_unique` ON `premium_grant` (`user_id`,`promo_code_id`);--> statement-breakpoint
CREATE INDEX `premium_grant_household_idx` ON `premium_grant` (`household_id`);--> statement-breakpoint
CREATE INDEX `premium_grant_code_idx` ON `premium_grant` (`promo_code_id`);--> statement-breakpoint
CREATE TABLE `promo_code` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`tier` text NOT NULL,
	`access_until` integer,
	`access_days` integer,
	`allows_sign_up` integer NOT NULL,
	`max_uses` integer,
	`uses` integer DEFAULT 0 NOT NULL,
	`redeem_by` integer,
	`disabled_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `promo_code_code_unique` ON `promo_code` (`code`);