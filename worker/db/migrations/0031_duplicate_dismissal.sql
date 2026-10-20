CREATE TABLE `duplicate_dismissal` (
	`user_id` text NOT NULL,
	`recipe_a` text NOT NULL,
	`recipe_b` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `recipe_a`, `recipe_b`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
