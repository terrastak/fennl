CREATE TABLE `photo_grace` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`delete_after` integer NOT NULL,
	`reminded_days` integer NOT NULL,
	`ended_at` integer,
	`ended_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_grace_open_idx` ON `photo_grace` (`user_id`) WHERE "photo_grace"."ended_at" is null;--> statement-breakpoint
ALTER TABLE `image` ADD `purged_at` integer;--> statement-breakpoint
CREATE INDEX `recipe_photo_image_idx` ON `recipe_photo` (`owner_user_id`,`image_hash`,`deleted_at`);