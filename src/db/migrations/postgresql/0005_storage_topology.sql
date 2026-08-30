ALTER TABLE "settings" ADD COLUMN "activeStorageDriver" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "activeStorageLocationId" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "activeStorageEndpoint" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "activeStorageRegion" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "activeStorageBucket" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "activeStorageRoot" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "activeStorageEstablishedAt" bigint;--> statement-breakpoint
CREATE TABLE "storage_migration" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"mode" text NOT NULL,
	"sourceDriver" text NOT NULL,
	"sourceLocationId" text NOT NULL,
	"sourceEndpoint" text,
	"sourceRegion" text,
	"sourceBucket" text,
	"sourceRoot" text,
	"destinationDriver" text NOT NULL,
	"destinationLocationId" text NOT NULL,
	"destinationEndpoint" text,
	"destinationRegion" text,
	"destinationBucket" text,
	"destinationRoot" text,
	"destinationAccessKeyId" text,
	"destinationSecretAccessKey" text,
	"totalEntries" integer,
	"copiedEntries" integer DEFAULT 0 NOT NULL,
	"verifiedEntries" integer DEFAULT 0 NOT NULL,
	"incompatibleEntries" integer DEFAULT 0 NOT NULL,
	"conflictingEntries" integer DEFAULT 0 NOT NULL,
	"extraEntries" integer DEFAULT 0 NOT NULL,
	"inventoryCursor" text,
	"extrasAcknowledged" boolean DEFAULT false NOT NULL,
	"failureReason" text,
	"baselineCompletedAt" bigint,
	"cutoverAt" bigint,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL
);--> statement-breakpoint
CREATE TABLE "storage_migration_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"migrationId" text NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"sourceSize" integer,
	"sourceHash" text,
	"destinationSize" integer,
	"destinationHash" text,
	"createdByMigration" boolean DEFAULT false NOT NULL,
	"detail" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"updatedAt" bigint NOT NULL
);--> statement-breakpoint
ALTER TABLE "storage_migration_entry" ADD CONSTRAINT "storage_migration_entry_migrationId_storage_migration_id_fk" FOREIGN KEY ("migrationId") REFERENCES "public"."storage_migration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "storage_migration_entry_job_state_idx" ON "storage_migration_entry" USING btree ("migrationId","state");--> statement-breakpoint
CREATE INDEX "storage_migration_entry_job_key_idx" ON "storage_migration_entry" USING btree ("migrationId","key");
