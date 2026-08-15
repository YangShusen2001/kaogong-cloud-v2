CREATE TABLE `resend_webhook_events` (
	`svix_id` text PRIMARY KEY NOT NULL,
	`provider_message_id` text NOT NULL,
	`event_type` text NOT NULL,
	`suppression_reason` text,
	`event_at` integer NOT NULL,
	`processed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `resend_webhook_provider_idx` ON `resend_webhook_events` (`provider_message_id`);--> statement-breakpoint
ALTER TABLE `mail_deliveries` ADD `provider_message_id` text;--> statement-breakpoint
ALTER TABLE `mail_deliveries` ADD `provider_event` text;--> statement-breakpoint
ALTER TABLE `mail_deliveries` ADD `provider_event_at` integer;--> statement-breakpoint
ALTER TABLE `mail_deliveries` ADD `last_reconciled_at` integer;--> statement-breakpoint
ALTER TABLE `mail_deliveries` ADD `reconcile_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_deliveries` ADD `next_reconcile_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `mail_provider_message_idx` ON `mail_deliveries` (`provider_message_id`);--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `suppression_reason` text;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `suppressed_at` integer;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `suppression_provider_message_id` text;
