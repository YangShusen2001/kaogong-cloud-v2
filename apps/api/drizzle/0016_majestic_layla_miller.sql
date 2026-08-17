CREATE TABLE `wrong_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`date` text NOT NULL,
	`question` text NOT NULL,
	`options` text NOT NULL,
	`answer` integer NOT NULL,
	`chosen` integer NOT NULL,
	`analysis` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wrong_questions_owner_idx` ON `wrong_questions` (`owner_id`);