CREATE TABLE `account` (
	`userId` varchar(191) NOT NULL,
	`type` text NOT NULL,
	`provider` varchar(191) NOT NULL,
	`providerAccountId` varchar(191) NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` int,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	CONSTRAINT `account_provider_providerAccountId_pk` PRIMARY KEY(`provider`,`providerAccountId`)
);
--> statement-breakpoint
CREATE TABLE `activity_log` (
	`id` varchar(191) NOT NULL,
	`actorId` varchar(191),
	`actorName` text NOT NULL,
	`action` varchar(191) NOT NULL,
	`entityType` varchar(191) NOT NULL,
	`entityId` varchar(191),
	`entityLabel` text NOT NULL,
	`summary` text,
	`metadata` text,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `activity_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `author` (
	`id` varchar(191) NOT NULL,
	`name` text NOT NULL,
	`slug` varchar(191) NOT NULL,
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
	`isIndexable` boolean NOT NULL DEFAULT true,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `author_id` PRIMARY KEY(`id`),
	CONSTRAINT `author_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `blog_category` (
	`id` varchar(191) NOT NULL,
	`name` text NOT NULL,
	`slug` varchar(191) NOT NULL,
	`description` text,
	`parentId` varchar(191),
	`imageKey` text,
	`metaTitle` text,
	`metaDescription` text,
	`ogImageKey` text,
	`canonicalUrl` text,
	`isIndexable` boolean NOT NULL DEFAULT true,
	`archiveIntro` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `blog_category_id` PRIMARY KEY(`id`),
	CONSTRAINT `blog_category_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `blog_post_category` (
	`postId` varchar(191) NOT NULL,
	`categoryId` varchar(191) NOT NULL,
	CONSTRAINT `blog_post_category_postId_categoryId_pk` PRIMARY KEY(`postId`,`categoryId`)
);
--> statement-breakpoint
CREATE TABLE `blog_post_faq` (
	`id` varchar(191) NOT NULL,
	`postId` varchar(191) NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`priority` int NOT NULL DEFAULT 0,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `blog_post_faq_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `blog_post_lock` (
	`postId` varchar(191) NOT NULL,
	`lockedById` varchar(191) NOT NULL,
	`lockedAt` bigint NOT NULL,
	CONSTRAINT `blog_post_lock_postId` PRIMARY KEY(`postId`)
);
--> statement-breakpoint
CREATE TABLE `blog_post_question` (
	`id` varchar(191) NOT NULL,
	`postId` varchar(191) NOT NULL,
	`askerName` text,
	`question` text NOT NULL,
	`answer` text,
	`answeredById` varchar(191),
	`status` varchar(191) NOT NULL DEFAULT 'pending',
	`priority` int NOT NULL DEFAULT 0,
	`createdAt` bigint NOT NULL,
	`answeredAt` bigint,
	CONSTRAINT `blog_post_question_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `blog_post_related` (
	`postId` varchar(191) NOT NULL,
	`relatedPostId` varchar(191) NOT NULL,
	`position` int NOT NULL DEFAULT 0,
	CONSTRAINT `blog_post_related_postId_relatedPostId_pk` PRIMARY KEY(`postId`,`relatedPostId`)
);
--> statement-breakpoint
CREATE TABLE `blog_post_revision` (
	`id` varchar(191) NOT NULL,
	`postId` varchar(191) NOT NULL,
	`title` text NOT NULL,
	`excerpt` text NOT NULL,
	`content` text NOT NULL,
	`editorId` varchar(191) NOT NULL,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `blog_post_revision_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `blog_post_tag` (
	`postId` varchar(191) NOT NULL,
	`tagId` varchar(191) NOT NULL,
	CONSTRAINT `blog_post_tag_postId_tagId_pk` PRIMARY KEY(`postId`,`tagId`)
);
--> statement-breakpoint
CREATE TABLE `blog_post` (
	`id` varchar(191) NOT NULL,
	`title` text NOT NULL,
	`slug` varchar(191) NOT NULL,
	`excerpt` text NOT NULL,
	`content` text NOT NULL,
	`featuredImageKey` text NOT NULL,
	`authorId` varchar(191) NOT NULL,
	`authorProfileId` varchar(191),
	`isPublished` boolean NOT NULL DEFAULT false,
	`publishedAt` bigint,
	`scheduledPublishAt` bigint,
	`metaTitle` text,
	`metaDescription` text,
	`canonicalUrl` text,
	`featuredImageAltText` text,
	`ogImageKey` text,
	`isIndexable` boolean NOT NULL DEFAULT true,
	`focusKeyword` text,
	`secondaryKeywords` text,
	`seoScore` int,
	`readabilityScore` int,
	`wordCount` int,
	`contentUpdatedAt` bigint,
	`isCornerstone` boolean NOT NULL DEFAULT false,
	`seriesId` varchar(191),
	`seriesPosition` int,
	`primaryCategoryId` varchar(191),
	`schemaType` varchar(191) NOT NULL DEFAULT 'BlogPosting',
	`schemaData` text,
	`speakableSelectors` text,
	`reviewStatus` varchar(191) NOT NULL DEFAULT 'none',
	`reviewedById` varchar(191),
	`reviewedAt` bigint,
	`reviewNote` text,
	`deletedAt` bigint,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `blog_post_id` PRIMARY KEY(`id`),
	CONSTRAINT `blog_post_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `blog_series` (
	`id` varchar(191) NOT NULL,
	`name` text NOT NULL,
	`slug` varchar(191) NOT NULL,
	`description` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `blog_series_id` PRIMARY KEY(`id`),
	CONSTRAINT `blog_series_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `blog_tag` (
	`id` varchar(191) NOT NULL,
	`name` text NOT NULL,
	`slug` varchar(191) NOT NULL,
	`metaTitle` text,
	`metaDescription` text,
	`canonicalUrl` text,
	`isIndexable` boolean NOT NULL DEFAULT true,
	`archiveIntro` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `blog_tag_id` PRIMARY KEY(`id`),
	CONSTRAINT `blog_tag_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `business_review` (
	`id` varchar(191) NOT NULL,
	`authorName` text NOT NULL,
	`rating` int NOT NULL,
	`body` text,
	`source` text NOT NULL,
	`sourceUrl` text,
	`reviewedAt` bigint NOT NULL,
	`isPublished` boolean NOT NULL DEFAULT false,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `business_review_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `custom_page` (
	`id` varchar(191) NOT NULL,
	`title` text NOT NULL,
	`path` varchar(191) NOT NULL,
	`content` text NOT NULL,
	`metaTitle` text,
	`metaDescription` text,
	`canonicalUrl` text,
	`ogImageKey` text,
	`isIndexable` boolean NOT NULL DEFAULT true,
	`isPublished` boolean NOT NULL DEFAULT false,
	`publishedAt` bigint,
	`createdById` varchar(191) NOT NULL,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `custom_page_id` PRIMARY KEY(`id`),
	CONSTRAINT `custom_page_path_unique` UNIQUE(`path`)
);
--> statement-breakpoint
CREATE TABLE `link_check_result` (
	`id` varchar(191) NOT NULL,
	`postId` varchar(191) NOT NULL,
	`url` text NOT NULL,
	`isInternal` boolean NOT NULL,
	`statusCode` int,
	`result` varchar(191) NOT NULL,
	`checkedAt` bigint NOT NULL,
	CONSTRAINT `link_check_result_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `not_found_log` (
	`id` varchar(191) NOT NULL,
	`path` varchar(191) NOT NULL,
	`hits` int NOT NULL DEFAULT 1,
	`lastReferrer` text,
	`resolvedAt` bigint,
	`firstSeenAt` bigint NOT NULL,
	`lastSeenAt` bigint NOT NULL,
	CONSTRAINT `not_found_log_id` PRIMARY KEY(`id`),
	CONSTRAINT `not_found_log_path_unique` UNIQUE(`path`)
);
--> statement-breakpoint
CREATE TABLE `redirect` (
	`id` varchar(191) NOT NULL,
	`fromPath` varchar(191) NOT NULL,
	`toPath` text NOT NULL,
	`statusCode` int NOT NULL DEFAULT 301,
	`isAutomatic` boolean NOT NULL DEFAULT false,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `redirect_id` PRIMARY KEY(`id`),
	CONSTRAINT `redirect_fromPath_unique` UNIQUE(`fromPath`)
);
--> statement-breakpoint
CREATE TABLE `search_console_issue` (
	`id` varchar(191) NOT NULL,
	`type` varchar(191) NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`url` text,
	`detectedAt` bigint,
	`status` varchar(191) NOT NULL DEFAULT 'open',
	`resolvedAt` bigint,
	`notes` text,
	`createdBy` varchar(191),
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `search_console_issue_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `session` (
	`sessionToken` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`expires` bigint NOT NULL,
	CONSTRAINT `session_sessionToken` PRIMARY KEY(`sessionToken`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` varchar(191) NOT NULL DEFAULT 'global',
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
	`externalLinkNewTab` boolean NOT NULL DEFAULT true,
	`indexNowKey` text,
	`indexNowEnabled` boolean NOT NULL DEFAULT false,
	`googleIndexingApiEnabled` boolean NOT NULL DEFAULT false,
	`newsSitemapEnabled` boolean NOT NULL DEFAULT false,
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
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` varchar(191) NOT NULL,
	`name` text,
	`email` varchar(191) NOT NULL,
	`emailVerified` bigint,
	`image` text,
	`passwordHash` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`role` varchar(191) NOT NULL DEFAULT 'contributor',
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `user_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `verificationToken` (
	`identifier` varchar(191) NOT NULL,
	`token` varchar(191) NOT NULL,
	`expires` bigint NOT NULL,
	CONSTRAINT `verificationToken_identifier_token_pk` PRIMARY KEY(`identifier`,`token`)
);
--> statement-breakpoint
ALTER TABLE `account` ADD CONSTRAINT `account_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_log` ADD CONSTRAINT `activity_log_actorId_user_id_fk` FOREIGN KEY (`actorId`) REFERENCES `user`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_category` ADD CONSTRAINT `blog_category_parentId_blog_category_id_fk` FOREIGN KEY (`parentId`) REFERENCES `blog_category`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post_category` ADD CONSTRAINT `blog_post_category_postId_blog_post_id_fk` FOREIGN KEY (`postId`) REFERENCES `blog_post`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post_category` ADD CONSTRAINT `blog_post_category_categoryId_blog_category_id_fk` FOREIGN KEY (`categoryId`) REFERENCES `blog_category`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post_faq` ADD CONSTRAINT `blog_post_faq_postId_blog_post_id_fk` FOREIGN KEY (`postId`) REFERENCES `blog_post`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post_lock` ADD CONSTRAINT `blog_post_lock_postId_blog_post_id_fk` FOREIGN KEY (`postId`) REFERENCES `blog_post`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post_lock` ADD CONSTRAINT `blog_post_lock_lockedById_user_id_fk` FOREIGN KEY (`lockedById`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post_question` ADD CONSTRAINT `blog_post_question_postId_blog_post_id_fk` FOREIGN KEY (`postId`) REFERENCES `blog_post`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post_question` ADD CONSTRAINT `blog_post_question_answeredById_user_id_fk` FOREIGN KEY (`answeredById`) REFERENCES `user`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post_related` ADD CONSTRAINT `blog_post_related_postId_blog_post_id_fk` FOREIGN KEY (`postId`) REFERENCES `blog_post`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post_related` ADD CONSTRAINT `blog_post_related_relatedPostId_blog_post_id_fk` FOREIGN KEY (`relatedPostId`) REFERENCES `blog_post`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post_revision` ADD CONSTRAINT `blog_post_revision_postId_blog_post_id_fk` FOREIGN KEY (`postId`) REFERENCES `blog_post`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post_revision` ADD CONSTRAINT `blog_post_revision_editorId_user_id_fk` FOREIGN KEY (`editorId`) REFERENCES `user`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post_tag` ADD CONSTRAINT `blog_post_tag_postId_blog_post_id_fk` FOREIGN KEY (`postId`) REFERENCES `blog_post`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post_tag` ADD CONSTRAINT `blog_post_tag_tagId_blog_tag_id_fk` FOREIGN KEY (`tagId`) REFERENCES `blog_tag`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post` ADD CONSTRAINT `blog_post_authorId_user_id_fk` FOREIGN KEY (`authorId`) REFERENCES `user`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post` ADD CONSTRAINT `blog_post_authorProfileId_author_id_fk` FOREIGN KEY (`authorProfileId`) REFERENCES `author`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post` ADD CONSTRAINT `blog_post_seriesId_blog_series_id_fk` FOREIGN KEY (`seriesId`) REFERENCES `blog_series`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post` ADD CONSTRAINT `blog_post_primaryCategoryId_blog_category_id_fk` FOREIGN KEY (`primaryCategoryId`) REFERENCES `blog_category`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blog_post` ADD CONSTRAINT `blog_post_reviewedById_user_id_fk` FOREIGN KEY (`reviewedById`) REFERENCES `user`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `custom_page` ADD CONSTRAINT `custom_page_createdById_user_id_fk` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `link_check_result` ADD CONSTRAINT `link_check_result_postId_blog_post_id_fk` FOREIGN KEY (`postId`) REFERENCES `blog_post`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `search_console_issue` ADD CONSTRAINT `search_console_issue_createdBy_user_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `session` ADD CONSTRAINT `session_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `activity_log_createdAt_idx` ON `activity_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `activity_log_entity_idx` ON `activity_log` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `activity_log_actor_idx` ON `activity_log` (`actorId`);