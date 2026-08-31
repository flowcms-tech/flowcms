ALTER TABLE `storage_migration` ADD `cutoverStartedAt` bigint;--> statement-breakpoint
ALTER TABLE `storage_migration_entry` ADD `claimedBy` text;--> statement-breakpoint
ALTER TABLE `storage_migration_entry` ADD `claimedAt` bigint;
