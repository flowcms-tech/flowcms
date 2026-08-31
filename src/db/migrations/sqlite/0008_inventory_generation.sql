ALTER TABLE `storage_migration` ADD `inventoryGeneration` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `storage_migration_entry` ADD `seenInGeneration` integer;--> statement-breakpoint
ALTER TABLE `storage_migration` DROP COLUMN `inventoryStartedAt`;
