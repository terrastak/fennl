CREATE TABLE `recipe_version` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`reason` text NOT NULL,
	`author_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `recipe_version_recipe_idx` ON `recipe_version` (`recipe_id`);