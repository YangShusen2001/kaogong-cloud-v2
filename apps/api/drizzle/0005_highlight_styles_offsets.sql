ALTER TABLE `highlights` ADD `styles` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `highlights` ADD `paragraph_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `highlights` ADD `start_offset` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `highlights` ADD `end_offset` integer DEFAULT 0 NOT NULL;
