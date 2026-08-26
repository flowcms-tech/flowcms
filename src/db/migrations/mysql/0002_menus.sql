CREATE TABLE `menu` (
	`id` varchar(191) NOT NULL,
	`name` text NOT NULL,
	`location` varchar(191) NOT NULL,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `menu_id` PRIMARY KEY(`id`),
	CONSTRAINT `menu_location_unique` UNIQUE(`location`)
);
--> statement-breakpoint
CREATE TABLE `menu_item` (
	`id` varchar(191) NOT NULL,
	`menuId` varchar(191) NOT NULL,
	`parentId` varchar(191),
	`label` text NOT NULL,
	`type` varchar(191) NOT NULL,
	`target` text NOT NULL,
	`sortOrder` int DEFAULT 0 NOT NULL,
	`isActive` boolean DEFAULT true NOT NULL,
	`opensInNewTab` boolean DEFAULT false NOT NULL,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `menu_item_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `menu_item` ADD CONSTRAINT `menu_item_menuId_menu_id_fk` FOREIGN KEY (`menuId`) REFERENCES `menu`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `menu_item` ADD CONSTRAINT `menu_item_parentId_menu_item_id_fk` FOREIGN KEY (`parentId`) REFERENCES `menu_item`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `menu_item_menu_idx` ON `menu_item` (`menuId`);--> statement-breakpoint
CREATE INDEX `menu_item_parent_idx` ON `menu_item` (`parentId`);
