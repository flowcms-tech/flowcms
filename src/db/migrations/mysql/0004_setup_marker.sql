ALTER TABLE `settings` ADD `setupCompletedAt` bigint;--> statement-breakpoint
INSERT INTO `settings` (`id`, `setupCompletedAt`, `updatedAt`)
SELECT 'global',
       CAST(UNIX_TIMESTAMP() * 1000 AS SIGNED),
       CAST(UNIX_TIMESTAMP() * 1000 AS SIGNED)
FROM (SELECT 1) AS d
WHERE NOT EXISTS (SELECT 1 FROM (SELECT 1 FROM `settings` LIMIT 1) AS existing)
  AND EXISTS (SELECT 1 FROM `user`);--> statement-breakpoint
UPDATE `settings` SET `setupCompletedAt` = CAST(UNIX_TIMESTAMP() * 1000 AS SIGNED)
WHERE `setupCompletedAt` IS NULL AND EXISTS (SELECT 1 FROM `user`);
