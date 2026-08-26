CREATE TABLE `theme_settings` (
	`themeSlug` text PRIMARY KEY NOT NULL,
	`settingsJson` text NOT NULL,
	`schemaVersion` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
