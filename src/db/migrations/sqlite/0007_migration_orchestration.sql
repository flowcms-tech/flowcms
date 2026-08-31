ALTER TABLE `storage_migration` ADD `inventoryStartedAt` integer;--> statement-breakpoint
ALTER TABLE `storage_migration` ADD `extrasAcknowledgedAt` integer;--> statement-breakpoint
ALTER TABLE `storage_migration` ADD `extrasAcknowledgedCount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `storage_migration_entry` ADD `normalizedKey` text;--> statement-breakpoint
CREATE INDEX `storage_migration_entry_job_normalized_idx` ON `storage_migration_entry` (`migrationId`,`normalizedKey`);
