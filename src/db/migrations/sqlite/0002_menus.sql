CREATE TABLE `menu` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`location` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_location_unique` ON `menu` (`location`);--> statement-breakpoint
CREATE TABLE `menu_item` (
	`id` text PRIMARY KEY NOT NULL,
	`menuId` text NOT NULL,
	`parentId` text,
	`label` text NOT NULL,
	`type` text NOT NULL,
	`target` text NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`isActive` integer DEFAULT true NOT NULL,
	`opensInNewTab` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`menuId`) REFERENCES `menu`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parentId`) REFERENCES `menu_item`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `menu_item_menu_idx` ON `menu_item` (`menuId`);--> statement-breakpoint
CREATE INDEX `menu_item_parent_idx` ON `menu_item` (`parentId`);
