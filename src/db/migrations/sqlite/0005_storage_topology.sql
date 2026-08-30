ALTER TABLE `settings` ADD `activeStorageDriver` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `activeStorageLocationId` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `activeStorageEndpoint` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `activeStorageRegion` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `activeStorageBucket` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `activeStorageRoot` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `activeStorageEstablishedAt` integer;--> statement-breakpoint
CREATE TABLE `storage_migration` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`mode` text NOT NULL,
	`sourceDriver` text NOT NULL,
	`sourceLocationId` text NOT NULL,
	`sourceEndpoint` text,
	`sourceRegion` text,
	`sourceBucket` text,
	`sourceRoot` text,
	`destinationDriver` text NOT NULL,
	`destinationLocationId` text NOT NULL,
	`destinationEndpoint` text,
	`destinationRegion` text,
	`destinationBucket` text,
	`destinationRoot` text,
	`destinationAccessKeyId` text,
	`destinationSecretAccessKey` text,
	`totalEntries` integer,
	`copiedEntries` integer DEFAULT 0 NOT NULL,
	`verifiedEntries` integer DEFAULT 0 NOT NULL,
	`incompatibleEntries` integer DEFAULT 0 NOT NULL,
	`conflictingEntries` integer DEFAULT 0 NOT NULL,
	`extraEntries` integer DEFAULT 0 NOT NULL,
	`inventoryCursor` text,
	`extrasAcknowledged` integer DEFAULT 0 NOT NULL,
	`failureReason` text,
	`baselineCompletedAt` integer,
	`cutoverAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);--> statement-breakpoint
CREATE TABLE `storage_migration_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`migrationId` text NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`sourceSize` integer,
	`sourceHash` text,
	`destinationSize` integer,
	`destinationHash` text,
	`createdByMigration` integer DEFAULT 0 NOT NULL,
	`detail` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`migrationId`) REFERENCES `storage_migration`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `storage_migration_entry_job_state_idx` ON `storage_migration_entry` (`migrationId`,`state`);--> statement-breakpoint
CREATE INDEX `storage_migration_entry_job_key_idx` ON `storage_migration_entry` (`migrationId`,`key`);
