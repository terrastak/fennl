CREATE TABLE `image` (
	`owner_user_id` text NOT NULL,
	`hash` text NOT NULL,
	`bytes` integer NOT NULL,
	`content_type` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	PRIMARY KEY(`owner_user_id`, `hash`),
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `image_owner_usage_idx` ON `image` (`owner_user_id`,`deleted_at`,`bytes`);--> statement-breakpoint
CREATE INDEX `image_hash_idx` ON `image` (`hash`);