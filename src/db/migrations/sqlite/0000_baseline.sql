CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text NOT NULL,
	`emailVerified` integer,
	`image` text,
	`passwordHash` text,
	`isActive` integer DEFAULT true NOT NULL,
	`role` text DEFAULT 'contributor' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `account` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `providerAccountId`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `verificationToken` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);
--> statement-breakpoint
CREATE TABLE `blog_category` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`parentId` text,
	`imageKey` text,
	`metaTitle` text,
	`metaDescription` text,
	`ogImageKey` text,
	`canonicalUrl` text,
	`isIndexable` integer DEFAULT true NOT NULL,
	`archiveIntro` text,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`parentId`) REFERENCES `blog_category`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blog_category_slug_unique` ON `blog_category` (`slug`);--> statement-breakpoint
CREATE TABLE `blog_tag` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`metaTitle` text,
	`metaDescription` text,
	`canonicalUrl` text,
	`isIndexable` integer DEFAULT true NOT NULL,
	`archiveIntro` text,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blog_tag_slug_unique` ON `blog_tag` (`slug`);--> statement-breakpoint
CREATE TABLE `author` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`jobTitle` text,
	`credentials` text,
	`bio` text,
	`avatarKey` text,
	`avatarAltText` text,
	`email` text,
	`websiteUrl` text,
	`linkedinUrl` text,
	`twitterUrl` text,
	`facebookUrl` text,
	`instagramUrl` text,
	`metaTitle` text,
	`metaDescription` text,
	`canonicalUrl` text,
	`isIndexable` integer DEFAULT true NOT NULL,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `author_slug_unique` ON `author` (`slug`);--> statement-breakpoint
CREATE TABLE `blog_post` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`excerpt` text NOT NULL,
	`content` text NOT NULL,
	`featuredImageKey` text NOT NULL,
	`authorId` text NOT NULL,
	`authorProfileId` text,
	`isPublished` integer DEFAULT false NOT NULL,
	`publishedAt` integer,
	`scheduledPublishAt` integer,
	`metaTitle` text,
	`metaDescription` text,
	`canonicalUrl` text,
	`featuredImageAltText` text,
	`ogImageKey` text,
	`isIndexable` integer DEFAULT true NOT NULL,
	`focusKeyword` text,
	`secondaryKeywords` text,
	`seoScore` integer,
	`readabilityScore` integer,
	`wordCount` integer,
	`contentUpdatedAt` integer,
	`isCornerstone` integer DEFAULT false NOT NULL,
	`seriesId` text,
	`seriesPosition` integer,
	`primaryCategoryId` text,
	`schemaType` text DEFAULT 'BlogPosting' NOT NULL,
	`schemaData` text,
	`speakableSelectors` text,
	`reviewStatus` text DEFAULT 'none' NOT NULL,
	`reviewedById` text,
	`reviewedAt` integer,
	`reviewNote` text,
	`deletedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`authorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`authorProfileId`) REFERENCES `author`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`seriesId`) REFERENCES `blog_series`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`primaryCategoryId`) REFERENCES `blog_category`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewedById`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blog_post_slug_unique` ON `blog_post` (`slug`);--> statement-breakpoint
CREATE TABLE `blog_post_category` (
	`postId` text NOT NULL,
	`categoryId` text NOT NULL,
	PRIMARY KEY(`postId`, `categoryId`),
	FOREIGN KEY (`postId`) REFERENCES `blog_post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`categoryId`) REFERENCES `blog_category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `blog_post_tag` (
	`postId` text NOT NULL,
	`tagId` text NOT NULL,
	PRIMARY KEY(`postId`, `tagId`),
	FOREIGN KEY (`postId`) REFERENCES `blog_post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tagId`) REFERENCES `blog_tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `blog_post_faq` (
	`id` text PRIMARY KEY NOT NULL,
	`postId` text NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`postId`) REFERENCES `blog_post`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `blog_post_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`postId` text NOT NULL,
	`title` text NOT NULL,
	`excerpt` text NOT NULL,
	`content` text NOT NULL,
	`editorId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`postId`) REFERENCES `blog_post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`editorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `blog_post_lock` (
	`postId` text PRIMARY KEY NOT NULL,
	`lockedById` text NOT NULL,
	`lockedAt` integer NOT NULL,
	FOREIGN KEY (`postId`) REFERENCES `blog_post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lockedById`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `blog_series` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blog_series_slug_unique` ON `blog_series` (`slug`);--> statement-breakpoint
CREATE TABLE `blog_post_related` (
	`postId` text NOT NULL,
	`relatedPostId` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`postId`, `relatedPostId`),
	FOREIGN KEY (`postId`) REFERENCES `blog_post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`relatedPostId`) REFERENCES `blog_post`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `blog_post_question` (
	`id` text PRIMARY KEY NOT NULL,
	`postId` text NOT NULL,
	`askerName` text,
	`question` text NOT NULL,
	`answer` text,
	`answeredById` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`answeredAt` integer,
	FOREIGN KEY (`postId`) REFERENCES `blog_post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`answeredById`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `business_review` (
	`id` text PRIMARY KEY NOT NULL,
	`authorName` text NOT NULL,
	`rating` integer NOT NULL,
	`body` text,
	`source` text NOT NULL,
	`sourceUrl` text,
	`reviewedAt` integer NOT NULL,
	`isPublished` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `not_found_log` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`hits` integer DEFAULT 1 NOT NULL,
	`lastReferrer` text,
	`resolvedAt` integer,
	`firstSeenAt` integer NOT NULL,
	`lastSeenAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `not_found_log_path_unique` ON `not_found_log` (`path`);--> statement-breakpoint
CREATE TABLE `link_check_result` (
	`id` text PRIMARY KEY NOT NULL,
	`postId` text NOT NULL,
	`url` text NOT NULL,
	`isInternal` integer NOT NULL,
	`statusCode` integer,
	`result` text NOT NULL,
	`checkedAt` integer NOT NULL,
	FOREIGN KEY (`postId`) REFERENCES `blog_post`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `redirect` (
	`id` text PRIMARY KEY NOT NULL,
	`fromPath` text NOT NULL,
	`toPath` text NOT NULL,
	`statusCode` integer DEFAULT 301 NOT NULL,
	`isAutomatic` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `redirect_fromPath_unique` ON `redirect` (`fromPath`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY DEFAULT 'global' NOT NULL,
	`siteName` text,
	`tagline` text,
	`logoKey` text,
	`logoAltText` text,
	`faviconKey` text,
	`baseUrl` text,
	`s3Endpoint` text,
	`s3Region` text,
	`s3Bucket` text,
	`s3AccessKeyId` text,
	`s3SecretAccessKey` text,
	`gscClientId` text,
	`gscClientSecret` text,
	`gscRefreshToken` text,
	`gscSiteUrl` text,
	`pagespeedApiKey` text,
	`bingApiKey` text,
	`bingSiteUrl` text,
	`metaTitleTemplate` text,
	`metaDescriptionTemplate` text,
	`categoryTitleTemplate` text,
	`tagTitleTemplate` text,
	`authorTitleTemplate` text,
	`titleSeparator` text,
	`externalLinkRel` text,
	`externalLinkNewTab` integer DEFAULT true NOT NULL,
	`indexNowKey` text,
	`indexNowEnabled` integer DEFAULT false NOT NULL,
	`googleIndexingApiEnabled` integer DEFAULT false NOT NULL,
	`newsSitemapEnabled` integer DEFAULT false NOT NULL,
	`robotsExtraRules` text,
	`robotsExtraSitemaps` text,
	`businessName` text,
	`businessLegalName` text,
	`businessType` text,
	`businessPhone` text,
	`businessEmail` text,
	`addressStreet` text,
	`addressCity` text,
	`addressRegion` text,
	`addressPostalCode` text,
	`addressCountry` text,
	`geoLatitude` text,
	`geoLongitude` text,
	`priceRange` text,
	`openingHours` text,
	`serviceAreaNames` text,
	`socialProfileUrls` text,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actorId` text,
	`actorName` text NOT NULL,
	`action` text NOT NULL,
	`entityType` text NOT NULL,
	`entityId` text,
	`entityLabel` text NOT NULL,
	`summary` text,
	`metadata` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`actorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `activity_log_createdAt_idx` ON `activity_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `activity_log_entity_idx` ON `activity_log` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `activity_log_actor_idx` ON `activity_log` (`actorId`);--> statement-breakpoint
CREATE TABLE `search_console_issue` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`url` text,
	`detectedAt` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`resolvedAt` integer,
	`notes` text,
	`createdBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `custom_page` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`path` text NOT NULL,
	`content` text NOT NULL,
	`metaTitle` text,
	`metaDescription` text,
	`canonicalUrl` text,
	`ogImageKey` text,
	`isIndexable` integer DEFAULT true NOT NULL,
	`isPublished` integer DEFAULT false NOT NULL,
	`publishedAt` integer,
	`createdById` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_page_path_unique` ON `custom_page` (`path`);