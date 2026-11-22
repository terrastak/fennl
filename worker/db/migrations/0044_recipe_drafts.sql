CREATE TABLE `recipe_draft` (
	`user_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`is_new` integer NOT NULL,
	`content` text NOT NULL,
	`text_bytes` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`edited_at` integer NOT NULL,
	`device_edited_at` integer,
	`updated_at` integer NOT NULL,
	`server_seq` integer NOT NULL,
	PRIMARY KEY(`user_id`, `recipe_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_draft_recipe_idx` ON `recipe_draft` (`recipe_id`);--> statement-breakpoint
CREATE INDEX `recipe_draft_owner_idx` ON `recipe_draft` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `recipe_draft_user_seq_idx` ON `recipe_draft` (`user_id`,`server_seq`);--> statement-breakpoint
ALTER TABLE `image` ADD `held_until` integer;--> statement-breakpoint
ALTER TABLE `recipe` ADD `field_by` text;--> statement-breakpoint
ALTER TABLE `recipe_category` ADD `updated_by_user_id` text;--> statement-breakpoint
ALTER TABLE `recipe_photo` ADD `updated_by_user_id` text;