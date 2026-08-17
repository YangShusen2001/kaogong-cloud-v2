ALTER TABLE `favorites` RENAME COLUMN `device_id` TO `owner_id`;--> statement-breakpoint
ALTER TABLE `highlights` RENAME COLUMN `device_id` TO `owner_id`;--> statement-breakpoint
ALTER TABLE `practice` RENAME COLUMN `device_id` TO `owner_id`;
