CREATE TABLE `invite_activations` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`activated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `invite_activations_code_idx` ON `invite_activations` (`code`);--> statement-breakpoint
CREATE TABLE `invite_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`remaining` integer NOT NULL,
	`total` integer NOT NULL,
	`created_at` integer NOT NULL
);
