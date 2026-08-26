CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actorId" text,
	"actorName" text NOT NULL,
	"action" text NOT NULL,
	"entityType" text NOT NULL,
	"entityId" text,
	"entityLabel" text NOT NULL,
	"summary" text,
	"metadata" text,
	"createdAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "author" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"jobTitle" text,
	"credentials" text,
	"bio" text,
	"avatarKey" text,
	"avatarAltText" text,
	"email" text,
	"websiteUrl" text,
	"linkedinUrl" text,
	"twitterUrl" text,
	"facebookUrl" text,
	"instagramUrl" text,
	"metaTitle" text,
	"metaDescription" text,
	"canonicalUrl" text,
	"isIndexable" boolean DEFAULT true NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL,
	CONSTRAINT "author_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "blog_category" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"parentId" text,
	"imageKey" text,
	"metaTitle" text,
	"metaDescription" text,
	"ogImageKey" text,
	"canonicalUrl" text,
	"isIndexable" boolean DEFAULT true NOT NULL,
	"archiveIntro" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL,
	CONSTRAINT "blog_category_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "blog_post_category" (
	"postId" text NOT NULL,
	"categoryId" text NOT NULL,
	CONSTRAINT "blog_post_category_postId_categoryId_pk" PRIMARY KEY("postId","categoryId")
);
--> statement-breakpoint
CREATE TABLE "blog_post_faq" (
	"id" text PRIMARY KEY NOT NULL,
	"postId" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blog_post_lock" (
	"postId" text PRIMARY KEY NOT NULL,
	"lockedById" text NOT NULL,
	"lockedAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blog_post_question" (
	"id" text PRIMARY KEY NOT NULL,
	"postId" text NOT NULL,
	"askerName" text,
	"question" text NOT NULL,
	"answer" text,
	"answeredById" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"createdAt" bigint NOT NULL,
	"answeredAt" bigint
);
--> statement-breakpoint
CREATE TABLE "blog_post_related" (
	"postId" text NOT NULL,
	"relatedPostId" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "blog_post_related_postId_relatedPostId_pk" PRIMARY KEY("postId","relatedPostId")
);
--> statement-breakpoint
CREATE TABLE "blog_post_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"postId" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text NOT NULL,
	"content" text NOT NULL,
	"editorId" text NOT NULL,
	"createdAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blog_post_tag" (
	"postId" text NOT NULL,
	"tagId" text NOT NULL,
	CONSTRAINT "blog_post_tag_postId_tagId_pk" PRIMARY KEY("postId","tagId")
);
--> statement-breakpoint
CREATE TABLE "blog_post" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"excerpt" text NOT NULL,
	"content" text NOT NULL,
	"featuredImageKey" text NOT NULL,
	"authorId" text NOT NULL,
	"authorProfileId" text,
	"isPublished" boolean DEFAULT false NOT NULL,
	"publishedAt" bigint,
	"scheduledPublishAt" bigint,
	"metaTitle" text,
	"metaDescription" text,
	"canonicalUrl" text,
	"featuredImageAltText" text,
	"ogImageKey" text,
	"isIndexable" boolean DEFAULT true NOT NULL,
	"focusKeyword" text,
	"secondaryKeywords" text,
	"seoScore" integer,
	"readabilityScore" integer,
	"wordCount" integer,
	"contentUpdatedAt" bigint,
	"isCornerstone" boolean DEFAULT false NOT NULL,
	"seriesId" text,
	"seriesPosition" integer,
	"primaryCategoryId" text,
	"schemaType" text DEFAULT 'BlogPosting' NOT NULL,
	"schemaData" text,
	"speakableSelectors" text,
	"reviewStatus" text DEFAULT 'none' NOT NULL,
	"reviewedById" text,
	"reviewedAt" bigint,
	"reviewNote" text,
	"deletedAt" bigint,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL,
	CONSTRAINT "blog_post_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "blog_series" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL,
	CONSTRAINT "blog_series_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "blog_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"metaTitle" text,
	"metaDescription" text,
	"canonicalUrl" text,
	"isIndexable" boolean DEFAULT true NOT NULL,
	"archiveIntro" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL,
	CONSTRAINT "blog_tag_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "business_review" (
	"id" text PRIMARY KEY NOT NULL,
	"authorName" text NOT NULL,
	"rating" integer NOT NULL,
	"body" text,
	"source" text NOT NULL,
	"sourceUrl" text,
	"reviewedAt" bigint NOT NULL,
	"isPublished" boolean DEFAULT false NOT NULL,
	"createdAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_page" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"path" text NOT NULL,
	"content" text NOT NULL,
	"metaTitle" text,
	"metaDescription" text,
	"canonicalUrl" text,
	"ogImageKey" text,
	"isIndexable" boolean DEFAULT true NOT NULL,
	"isPublished" boolean DEFAULT false NOT NULL,
	"publishedAt" bigint,
	"createdById" text NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL,
	CONSTRAINT "custom_page_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "link_check_result" (
	"id" text PRIMARY KEY NOT NULL,
	"postId" text NOT NULL,
	"url" text NOT NULL,
	"isInternal" boolean NOT NULL,
	"statusCode" integer,
	"result" text NOT NULL,
	"checkedAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "not_found_log" (
	"id" text PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"lastReferrer" text,
	"resolvedAt" bigint,
	"firstSeenAt" bigint NOT NULL,
	"lastSeenAt" bigint NOT NULL,
	CONSTRAINT "not_found_log_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "redirect" (
	"id" text PRIMARY KEY NOT NULL,
	"fromPath" text NOT NULL,
	"toPath" text NOT NULL,
	"statusCode" integer DEFAULT 301 NOT NULL,
	"isAutomatic" boolean DEFAULT false NOT NULL,
	"createdAt" bigint NOT NULL,
	CONSTRAINT "redirect_fromPath_unique" UNIQUE("fromPath")
);
--> statement-breakpoint
CREATE TABLE "search_console_issue" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"url" text,
	"detectedAt" bigint,
	"status" text DEFAULT 'open' NOT NULL,
	"resolvedAt" bigint,
	"notes" text,
	"createdBy" text,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"siteName" text,
	"tagline" text,
	"logoKey" text,
	"logoAltText" text,
	"faviconKey" text,
	"baseUrl" text,
	"s3Endpoint" text,
	"s3Region" text,
	"s3Bucket" text,
	"s3AccessKeyId" text,
	"s3SecretAccessKey" text,
	"gscClientId" text,
	"gscClientSecret" text,
	"gscRefreshToken" text,
	"gscSiteUrl" text,
	"pagespeedApiKey" text,
	"bingApiKey" text,
	"bingSiteUrl" text,
	"metaTitleTemplate" text,
	"metaDescriptionTemplate" text,
	"categoryTitleTemplate" text,
	"tagTitleTemplate" text,
	"authorTitleTemplate" text,
	"titleSeparator" text,
	"externalLinkRel" text,
	"externalLinkNewTab" boolean DEFAULT true NOT NULL,
	"indexNowKey" text,
	"indexNowEnabled" boolean DEFAULT false NOT NULL,
	"googleIndexingApiEnabled" boolean DEFAULT false NOT NULL,
	"newsSitemapEnabled" boolean DEFAULT false NOT NULL,
	"robotsExtraRules" text,
	"robotsExtraSitemaps" text,
	"businessName" text,
	"businessLegalName" text,
	"businessType" text,
	"businessPhone" text,
	"businessEmail" text,
	"addressStreet" text,
	"addressCity" text,
	"addressRegion" text,
	"addressPostalCode" text,
	"addressCountry" text,
	"geoLatitude" text,
	"geoLongitude" text,
	"priceRange" text,
	"openingHours" text,
	"serviceAreaNames" text,
	"socialProfileUrls" text,
	"updatedAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"emailVerified" bigint,
	"image" text,
	"passwordHash" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"role" text DEFAULT 'contributor' NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" bigint NOT NULL,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actorId_user_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_category" ADD CONSTRAINT "blog_category_parentId_blog_category_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."blog_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_category" ADD CONSTRAINT "blog_post_category_postId_blog_post_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."blog_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_category" ADD CONSTRAINT "blog_post_category_categoryId_blog_category_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."blog_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_faq" ADD CONSTRAINT "blog_post_faq_postId_blog_post_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."blog_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_lock" ADD CONSTRAINT "blog_post_lock_postId_blog_post_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."blog_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_lock" ADD CONSTRAINT "blog_post_lock_lockedById_user_id_fk" FOREIGN KEY ("lockedById") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_question" ADD CONSTRAINT "blog_post_question_postId_blog_post_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."blog_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_question" ADD CONSTRAINT "blog_post_question_answeredById_user_id_fk" FOREIGN KEY ("answeredById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_related" ADD CONSTRAINT "blog_post_related_postId_blog_post_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."blog_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_related" ADD CONSTRAINT "blog_post_related_relatedPostId_blog_post_id_fk" FOREIGN KEY ("relatedPostId") REFERENCES "public"."blog_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_revision" ADD CONSTRAINT "blog_post_revision_postId_blog_post_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."blog_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_revision" ADD CONSTRAINT "blog_post_revision_editorId_user_id_fk" FOREIGN KEY ("editorId") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_tag" ADD CONSTRAINT "blog_post_tag_postId_blog_post_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."blog_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post_tag" ADD CONSTRAINT "blog_post_tag_tagId_blog_tag_id_fk" FOREIGN KEY ("tagId") REFERENCES "public"."blog_tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post" ADD CONSTRAINT "blog_post_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post" ADD CONSTRAINT "blog_post_authorProfileId_author_id_fk" FOREIGN KEY ("authorProfileId") REFERENCES "public"."author"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post" ADD CONSTRAINT "blog_post_seriesId_blog_series_id_fk" FOREIGN KEY ("seriesId") REFERENCES "public"."blog_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post" ADD CONSTRAINT "blog_post_primaryCategoryId_blog_category_id_fk" FOREIGN KEY ("primaryCategoryId") REFERENCES "public"."blog_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_post" ADD CONSTRAINT "blog_post_reviewedById_user_id_fk" FOREIGN KEY ("reviewedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_page" ADD CONSTRAINT "custom_page_createdById_user_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_check_result" ADD CONSTRAINT "link_check_result_postId_blog_post_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."blog_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_console_issue" ADD CONSTRAINT "search_console_issue_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_createdAt_idx" ON "activity_log" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "activity_log_entity_idx" ON "activity_log" USING btree ("entityType","entityId");--> statement-breakpoint
CREATE INDEX "activity_log_actor_idx" ON "activity_log" USING btree ("actorId");