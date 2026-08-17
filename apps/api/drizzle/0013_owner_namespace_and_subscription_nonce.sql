ALTER TABLE `subscriptions` ADD `unsubscribe_token_nonce` text;--> statement-breakpoint
CREATE TABLE `__new_favorites` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_favorites` (`id`, `owner_id`, `url`, `title`, `source`, `note`, `created_at`)
SELECT
	`id`,
	CASE WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = `favorites`.`owner_id`)
		THEN 'user:' || `owner_id` ELSE 'device:' || `owner_id` END,
	`url`, `title`, `source`, `note`, `created_at`
FROM `favorites`;--> statement-breakpoint
DROP TABLE `favorites`;--> statement-breakpoint
ALTER TABLE `__new_favorites` RENAME TO `favorites`;--> statement-breakpoint
CREATE TABLE `__new_highlights` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`article_id` text NOT NULL,
	`text` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`styles` text DEFAULT '[]' NOT NULL,
	`paragraph_index` integer DEFAULT 0 NOT NULL,
	`start_offset` integer DEFAULT 0 NOT NULL,
	`end_offset` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_highlights` (`id`, `owner_id`, `article_id`, `text`, `note`, `styles`, `paragraph_index`, `start_offset`, `end_offset`, `created_at`)
SELECT
	`id`,
	CASE WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = `highlights`.`owner_id`)
		THEN 'user:' || `owner_id` ELSE 'device:' || `owner_id` END,
	`article_id`, `text`, `note`, `styles`, `paragraph_index`, `start_offset`, `end_offset`, `created_at`
FROM `highlights`;--> statement-breakpoint
DROP TABLE `highlights`;--> statement-breakpoint
ALTER TABLE `__new_highlights` RENAME TO `highlights`;--> statement-breakpoint
CREATE INDEX `highlights_owner_article_paragraph_idx` ON `highlights` (`owner_id`,`article_id`,`paragraph_index`);--> statement-breakpoint
CREATE TABLE `__new_highlight_paragraphs` (
	`owner_id` text NOT NULL,
	`article_id` text NOT NULL,
	`paragraph_index` integer NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`spans` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `article_id`, `paragraph_index`)
);--> statement-breakpoint
INSERT INTO `__new_highlight_paragraphs` (`owner_id`, `article_id`, `paragraph_index`, `version`, `spans`, `updated_at`)
SELECT
	CASE WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = `highlight_paragraphs`.`owner_id`)
		THEN 'user:' || `owner_id` ELSE 'device:' || `owner_id` END,
	`article_id`, `paragraph_index`, `version`, `spans`, `updated_at`
FROM `highlight_paragraphs`;--> statement-breakpoint
DROP TABLE `highlight_paragraphs`;--> statement-breakpoint
ALTER TABLE `__new_highlight_paragraphs` RENAME TO `highlight_paragraphs`;--> statement-breakpoint
CREATE TABLE `__new_practice` (
	`owner_id` text NOT NULL,
	`date` text NOT NULL,
	`correct` integer NOT NULL,
	`total` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `date`)
);--> statement-breakpoint
INSERT INTO `__new_practice` (`owner_id`, `date`, `correct`, `total`)
SELECT
	CASE WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = `practice`.`owner_id`)
		THEN 'user:' || `owner_id` ELSE 'device:' || `owner_id` END,
	`date`, `correct`, `total`
FROM `practice`;--> statement-breakpoint
DROP TABLE `practice`;--> statement-breakpoint
ALTER TABLE `__new_practice` RENAME TO `practice`;
