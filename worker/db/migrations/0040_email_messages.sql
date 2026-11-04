CREATE TABLE `email_message` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`to_address` text NOT NULL,
	`sent_at` integer NOT NULL,
	`status` text NOT NULL,
	`status_at` integer NOT NULL,
	`detail` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_message_provider_idx` ON `email_message` (`provider_id`);--> statement-breakpoint
CREATE INDEX `email_message_user_idx` ON `email_message` (`user_id`,`sent_at`);--> statement-breakpoint
CREATE INDEX `email_message_sent_idx` ON `email_message` (`sent_at`);--> statement-breakpoint
ALTER TABLE `user` ADD `email_problem` text;