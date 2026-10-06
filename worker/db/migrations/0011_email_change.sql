CREATE TABLE `email_change` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`old_email` text NOT NULL,
	`old_email_verified_at` integer,
	`new_email` text NOT NULL,
	`admin_user_id` text,
	`token_hash` text,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`completed_at` integer,
	`cancelled_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_change_token_hash_unique` ON `email_change` (`token_hash`);--> statement-breakpoint
CREATE INDEX `email_change_user_idx` ON `email_change` (`user_id`);--> statement-breakpoint
ALTER TABLE `user` ADD `email_verified_at` integer;--> statement-breakpoint
-- Accounts made with Google or Apple were verified when they signed up. Other accounts verified
-- before this date keep a null date ("date not recorded").
UPDATE `user` SET `email_verified_at` = `created_at` WHERE `email_verified` = 1 AND NOT EXISTS (SELECT 1 FROM `account` WHERE `account`.`user_id` = `user`.`id` AND `account`.`provider_id` = 'credential');
