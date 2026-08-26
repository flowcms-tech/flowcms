ALTER TABLE "settings" ADD COLUMN "setupCompletedAt" bigint;--> statement-breakpoint
INSERT INTO "settings" ("id", "setupCompletedAt", "updatedAt")
SELECT 'global',
       (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
       (EXTRACT(EPOCH FROM now()) * 1000)::bigint
FROM (SELECT 1) AS d
WHERE NOT EXISTS (SELECT 1 FROM "settings") AND EXISTS (SELECT 1 FROM "user");--> statement-breakpoint
UPDATE "settings" SET "setupCompletedAt" = (EXTRACT(EPOCH FROM now()) * 1000)::bigint
WHERE "setupCompletedAt" IS NULL AND EXISTS (SELECT 1 FROM "user");
