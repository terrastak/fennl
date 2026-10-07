CREATE TABLE `category` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`field_times` text NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `category_owner_seq_idx` ON `category` (`owner_user_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `recipe` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`copied_from` text,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`ingredients` text NOT NULL,
	`directions` text NOT NULL,
	`times` text NOT NULL,
	`servings` text NOT NULL,
	`source` text NOT NULL,
	`notes` text NOT NULL,
	`difficulty` text,
	`difficulty_text` text,
	`nutrition` text,
	`import` text,
	`field_times` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_by_user_id` text,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `recipe_owner_seq_idx` ON `recipe` (`owner_user_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `recipe_category` (
	`recipe_id` text NOT NULL,
	`category_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`field_times` text NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	PRIMARY KEY(`recipe_id`, `category_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_category_owner_seq_idx` ON `recipe_category` (`owner_user_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `recipe_made` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`user_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`made_on` text NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_made_owner_seq_idx` ON `recipe_made` (`owner_user_id`,`server_seq`);--> statement-breakpoint
CREATE INDEX `recipe_made_recipe_idx` ON `recipe_made` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipe_opinion` (
	`recipe_id` text NOT NULL,
	`user_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`rating` integer,
	`favorite` integer NOT NULL,
	`note` text NOT NULL,
	`field_times` text NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer NOT NULL,
	PRIMARY KEY(`recipe_id`, `user_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_opinion_owner_seq_idx` ON `recipe_opinion` (`owner_user_id`,`server_seq`);--> statement-breakpoint
CREATE TABLE `sync_counter` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
-- The counter starts at 0; the first accepted change is number 1.
INSERT OR IGNORE INTO `sync_counter` (`id`, `value`) VALUES (1, 0);
