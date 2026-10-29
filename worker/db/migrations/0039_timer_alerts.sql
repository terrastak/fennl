CREATE TABLE `push_subscription` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `device_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `push_subscription_endpoint_idx` ON `push_subscription` (`endpoint`);--> statement-breakpoint
CREATE TABLE `timer_alert` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`device_id` text NOT NULL,
	`label` text NOT NULL,
	`recipe_title` text NOT NULL,
	`path` text NOT NULL,
	`ends_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	`cancelled_at` integer,
	PRIMARY KEY(`user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `timer_alert_ends_idx` ON `timer_alert` (`ends_at`);