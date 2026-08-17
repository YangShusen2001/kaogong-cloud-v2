CREATE TABLE `highlight_paragraphs` (
	`owner_id` text NOT NULL,
	`article_id` text NOT NULL,
	`paragraph_index` integer NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`spans` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `article_id`, `paragraph_index`)
);
--> statement-breakpoint
CREATE INDEX `highlights_owner_article_paragraph_idx` ON `highlights` (`owner_id`,`article_id`,`paragraph_index`);
