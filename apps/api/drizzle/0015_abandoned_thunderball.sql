ALTER TABLE `favorites` ADD `kind` text DEFAULT 'article' NOT NULL;--> statement-breakpoint
ALTER TABLE `favorites` ADD `quote` text DEFAULT '' NOT NULL;