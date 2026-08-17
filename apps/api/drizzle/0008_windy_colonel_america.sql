CREATE TABLE `email_verification_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`consumed_at` integer,
	`ip_hash` text NOT NULL,
	`device_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_email_created_idx` ON `email_verification_codes` (`email`,`created_at`);--> statement-breakpoint
CREATE TABLE `mail_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`user_id` text NOT NULL,
	`recipient` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`sent_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_issue_user_idx` ON `mail_deliveries` (`issue_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `newsletter_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_date` text NOT NULL,
	`subject` text NOT NULL,
	`text_content` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `newsletter_issues_issue_date_unique` ON `newsletter_issues` (`issue_date`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'unsubscribed' NOT NULL,
	`subscribed_at` integer,
	`unsubscribed_at` integer,
	`updated_at` integer NOT NULL
);
