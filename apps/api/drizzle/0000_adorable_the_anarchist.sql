CREATE TABLE `favorites` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `highlights` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`article_id` text NOT NULL,
	`text` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `practice` (
	`device_id` text NOT NULL,
	`date` text NOT NULL,
	`correct` integer NOT NULL,
	`total` integer NOT NULL,
	PRIMARY KEY(`device_id`, `date`)
);
