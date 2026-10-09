CREATE TABLE `recipe_photo` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`image_hash` text NOT NULL,
	`role` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`sort_order` real NOT NULL,
	`added_by_user_id` text NOT NULL,
	`field_times` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_photo_owner_seq_idx` ON `recipe_photo` (`owner_user_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `recipe_photo_recipe_idx` ON `recipe_photo` (`recipe_id`,`deleted_at`);--> statement-breakpoint
ALTER TABLE `image` ADD `thumb_bytes` integer;