ALTER TABLE `storage_migration` ADD `inventoryGeneration` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `storage_migration_entry` ADD `seenInGeneration` int;--> statement-breakpoint
ALTER TABLE `storage_migration` DROP COLUMN `inventoryStartedAt`;
