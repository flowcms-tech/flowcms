ALTER TABLE "storage_migration" ADD COLUMN "cutoverStartedAt" bigint;--> statement-breakpoint
ALTER TABLE "storage_migration_entry" ADD COLUMN "claimedBy" text;--> statement-breakpoint
ALTER TABLE "storage_migration_entry" ADD COLUMN "claimedAt" bigint;
