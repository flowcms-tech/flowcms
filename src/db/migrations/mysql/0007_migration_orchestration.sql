ALTER TABLE `storage_migration` ADD `inventoryStartedAt` bigint;--> statement-breakpoint
ALTER TABLE `storage_migration` ADD `extrasAcknowledgedAt` bigint;--> statement-breakpoint
ALTER TABLE `storage_migration` ADD `extrasAcknowledgedCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `storage_migration_entry` ADD `normalizedKey` varchar(191);--> statement-breakpoint
CREATE INDEX `storage_migration_entry_job_normalized_idx` ON `storage_migration_entry` (`migrationId`,`normalizedKey`);
