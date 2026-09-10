ALTER TABLE `storage_migration` ADD `activeSlot` integer;--> statement-breakpoint
UPDATE `storage_migration` SET `activeSlot` = 1
WHERE `id` = (
  SELECT `id` FROM `storage_migration`
  WHERE `status` NOT IN ('completed', 'failed', 'cancelled')
  ORDER BY `createdAt` DESC, `id` DESC
  LIMIT 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `storage_migration_active_slot_idx` ON `storage_migration` (`activeSlot`);
