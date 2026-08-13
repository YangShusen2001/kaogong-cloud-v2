ALTER TABLE `users` ADD COLUMN `email` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `name` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `avatar` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `subscribed` integer NOT NULL DEFAULT 0;
