ALTER TABLE `settings` ADD `activeStorageDriver` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `activeStorageLocationId` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `activeStorageEndpoint` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `activeStorageRegion` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `activeStorageBucket` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `activeStorageRoot` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `activeStorageEstablishedAt` bigint;--> statement-breakpoint
CREATE TABLE `storage_migration` (
	`id` varchar(191) NOT NULL,
	`status` varchar(191) NOT NULL,
	`mode` varchar(191) NOT NULL,
	`sourceDriver` varchar(191) NOT NULL,
	`sourceLocationId` text NOT NULL,
	`sourceEndpoint` text,
	`sourceRegion` text,
	`sourceBucket` text,
	`sourceRoot` text,
	`destinationDriver` varchar(191) NOT NULL,
	`destinationLocationId` text NOT NULL,
	`destinationEndpoint` text,
	`destinationRegion` text,
	`destinationBucket` text,
	`destinationRoot` text,
	`destinationAccessKeyId` text,
	`destinationSecretAccessKey` text,
	`version` int DEFAULT 0 NOT NULL,
	`totalEntries` int,
	`copiedEntries` int DEFAULT 0 NOT NULL,
	`verifiedEntries` int DEFAULT 0 NOT NULL,
	`incompatibleEntries` int DEFAULT 0 NOT NULL,
	`conflictingEntries` int DEFAULT 0 NOT NULL,
	`extraEntries` int DEFAULT 0 NOT NULL,
	`missingEntries` int DEFAULT 0 NOT NULL,
	`matchingEntries` int DEFAULT 0 NOT NULL,
	`sourceCursor` text,
	`sourceScanCompletedAt` bigint,
	`destinationCursor` text,
	`destinationScanCompletedAt` bigint,
	`destinationCaseSensitive` boolean,
	`extrasAcknowledged` boolean DEFAULT false NOT NULL,
	`failureReason` text,
	`baselineCompletedAt` bigint,
	`cutoverAt` bigint,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `storage_migration_id` PRIMARY KEY(`id`)
);--> statement-breakpoint
CREATE TABLE `storage_migration_entry` (
	`id` varchar(191) NOT NULL,
	`migrationId` varchar(191) NOT NULL,
	`key` varchar(191) NOT NULL,
	`kind` varchar(191) NOT NULL,
	`classification` varchar(191) NOT NULL,
	`state` varchar(191) NOT NULL,
	`sourceSize` int,
	`sourceLastModified` bigint,
	`sourceETag` text,
	`sourceHash` text,
	`destinationSize` int,
	`destinationHash` text,
	`createdByMigration` boolean DEFAULT false NOT NULL,
	`detail` text,
	`attempts` int DEFAULT 0 NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `storage_migration_entry_id` PRIMARY KEY(`id`)
);--> statement-breakpoint
ALTER TABLE `storage_migration_entry` ADD CONSTRAINT `storage_migration_entry_migrationId_storage_migration_id_fk` FOREIGN KEY (`migrationId`) REFERENCES `storage_migration`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `storage_migration_entry_job_state_idx` ON `storage_migration_entry` (`migrationId`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `storage_migration_entry_job_key_idx` ON `storage_migration_entry` (`migrationId`,`key`);
