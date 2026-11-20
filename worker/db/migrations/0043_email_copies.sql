ALTER TABLE `email_message` ADD `subject` text;--> statement-breakpoint
ALTER TABLE `email_message` ADD `copy_html` text;--> statement-breakpoint
ALTER TABLE `email_message` ADD `link_ref` text;--> statement-breakpoint
ALTER TABLE `email_message` ADD `link_used_at` integer;--> statement-breakpoint
CREATE INDEX `email_message_link_idx` ON `email_message` (`link_ref`);