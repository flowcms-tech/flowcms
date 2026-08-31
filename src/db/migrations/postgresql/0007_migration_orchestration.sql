ALTER TABLE "storage_migration" ADD COLUMN "inventoryStartedAt" bigint;--> statement-breakpoint
ALTER TABLE "storage_migration" ADD COLUMN "extrasAcknowledgedAt" bigint;--> statement-breakpoint
ALTER TABLE "storage_migration" ADD COLUMN "extrasAcknowledgedCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_migration_entry" ADD COLUMN "normalizedKey" text;--> statement-breakpoint
CREATE INDEX "storage_migration_entry_job_normalized_idx" ON "storage_migration_entry" ("migrationId","normalizedKey");
