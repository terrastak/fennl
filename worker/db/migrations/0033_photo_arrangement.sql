CREATE TABLE `photo_arrangement` (
	`recipe_id` text PRIMARY KEY NOT NULL,
	`photos_key` text NOT NULL,
	`labels` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `recipe_photo` ADD `taken_at` integer;--> statement-breakpoint
ALTER TABLE `recipe_photo` ADD `arranged_by` text;