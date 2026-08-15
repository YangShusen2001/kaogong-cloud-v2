ALTER TABLE `email_verification_codes` ADD `consume_token` text;--> statement-breakpoint
CREATE INDEX `verification_ip_created_idx` ON `email_verification_codes` (`ip_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `verification_device_created_idx` ON `email_verification_codes` (`device_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `mail_deliveries` ADD `lease_token` text;--> statement-breakpoint
ALTER TABLE `mail_deliveries` ADD `lease_expires_at` integer;--> statement-breakpoint
INSERT INTO `subscriptions` (`user_id`, `status`, `subscribed_at`, `unsubscribed_at`, `unsubscribe_token_hash`, `updated_at`)
SELECT
	`users`.`id`,
	CASE `users`.`subscribed` WHEN 1 THEN 'subscribed' ELSE 'unsubscribed' END,
	CASE `users`.`subscribed` WHEN 1 THEN `users`.`created_at` ELSE NULL END,
	CASE `users`.`subscribed` WHEN 1 THEN NULL ELSE `users`.`created_at` END,
	NULL,
	`users`.`created_at`
FROM `users`
WHERE NOT EXISTS (
	SELECT 1 FROM `subscriptions` WHERE `subscriptions`.`user_id` = `users`.`id`
);--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`salt` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`avatar` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_users` (`id`, `username`, `password_hash`, `salt`, `email`, `name`, `avatar`, `created_at`)
SELECT `id`, `username`, `password_hash`, `salt`, `email`, `name`, `avatar`, `created_at` FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_verified_email_unique` ON `users` (`email`) WHERE "users"."email" <> '';
