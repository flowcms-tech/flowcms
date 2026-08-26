ALTER TABLE `settings` ADD `setupCompletedAt` integer;--> statement-breakpoint
INSERT INTO `settings` (`id`, `setupCompletedAt`, `updatedAt`)
SELECT 'global', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM (SELECT 1) AS d
WHERE NOT EXISTS (SELECT 1 FROM `settings`) AND EXISTS (SELECT 1 FROM `user`);--> statement-breakpoint
UPDATE `settings` SET `setupCompletedAt` = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE `setupCompletedAt` IS NULL AND EXISTS (SELECT 1 FROM `user`);
