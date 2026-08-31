ALTER TABLE `storage_migration` ADD `cutoverStartedAt` integer;--> statement-breakpoint
ALTER TABLE `storage_migration_entry` ADD `claimedBy` text;--> statement-breakpoint
ALTER TABLE `storage_migration_entry` ADD `claimedAt` integer;
