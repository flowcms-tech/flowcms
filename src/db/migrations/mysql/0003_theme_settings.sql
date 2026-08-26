CREATE TABLE `theme_settings` (
	`themeSlug` varchar(191) NOT NULL,
	`settingsJson` text NOT NULL,
	`schemaVersion` int DEFAULT 1 NOT NULL,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `theme_settings_themeSlug` PRIMARY KEY(`themeSlug`)
);
