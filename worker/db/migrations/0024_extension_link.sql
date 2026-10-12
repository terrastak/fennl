CREATE TABLE `extension_link` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`key_hash` text NOT NULL,
	`password_marker` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extension_link_key_hash_unique` ON `extension_link` (`key_hash`);--> statement-breakpoint
CREATE INDEX `extension_link_user_idx` ON `extension_link` (`user_id`);