ALTER TABLE `storage_migration` ADD `activeSlot` int;--> statement-breakpoint
UPDATE `storage_migration` SET `activeSlot` = 1
WHERE `id` = (
  SELECT `id` FROM (
    SELECT `id` FROM `storage_migration`
    WHERE `status` NOT IN ('completed', 'failed', 'cancelled')
    ORDER BY `createdAt` DESC, `id` DESC
    LIMIT 1
  ) AS newest
);--> statement-breakpoint
CREATE UNIQUE INDEX `storage_migration_active_slot_idx` ON `storage_migration` (`activeSlot`);
