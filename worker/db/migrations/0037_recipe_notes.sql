CREATE TABLE `recipe_note` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`user_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`text` text NOT NULL,
	`written_at` integer NOT NULL,
	`edited_at` integer,
	`field_times` text NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_note_owner_seq_idx` ON `recipe_note` (`owner_user_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `recipe_note_recipe_idx` ON `recipe_note` (`recipe_id`);