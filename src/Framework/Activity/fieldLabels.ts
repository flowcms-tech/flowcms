import type { FieldLabels } from "@/db/activityLog"

/**
 * Column name → what a person calls it, per entity.
 *
 * These drive the "Changed title, meta description" sentence on an activity
 * entry, and they are also the *filter* on what gets mentioned: a column with
 * no entry here never appears in a summary. That is how `updatedAt`,
 * `seoScore`, `wordCount`, and the other derived columns stay out — they change
 * on almost every write, and listing them would bury the one field the person
 * actually edited.
 *
 * Sensitive columns are absent for a stronger reason: `passwordHash` must never
 * be namable by anything that writes to a log.
 */

export const POST_FIELD_LABELS: FieldLabels = {
  title: "title",
  slug: "slug",
  excerpt: "excerpt",
  content: "content",
  featuredImageKey: "featured image",
  featuredImageAltText: "image alt text",
  ogImageKey: "social image",
  metaTitle: "meta title",
  metaDescription: "meta description",
  canonicalUrl: "canonical URL",
  isIndexable: "indexability",
  authorProfileId: "author byline",
  focusKeyword: "focus keyword",
  secondaryKeywords: "secondary keywords",
  isCornerstone: "cornerstone flag",
  schemaType: "schema type",
  schemaData: "schema data",
  speakableSelectors: "speakable selectors",
  seriesId: "series",
  seriesPosition: "series position",
  primaryCategoryId: "primary category",
  contentUpdatedAt: "last-updated stamp",
}

/** Categories, tags, and series share a shape. */
export const TAXONOMY_FIELD_LABELS: FieldLabels = {
  name: "name",
  slug: "slug",
  description: "description",
  archiveIntro: "archive intro",
  metaTitle: "meta title",
  metaDescription: "meta description",
  canonicalUrl: "canonical URL",
  isIndexable: "indexability",
  isActive: "active state",
  parentId: "parent",
  imageKey: "image",
  ogImageKey: "social image",
}


export const AUTHOR_FIELD_LABELS: FieldLabels = {
  name: "name",
  slug: "slug",
  jobTitle: "job title",
  bio: "bio",
  avatarKey: "avatar",
  avatarAltText: "avatar alt text",
  email: "email",
  isActive: "active state",
  credentials: "credentials",
  canonicalUrl: "canonical URL",
  websiteUrl: "website",
  linkedinUrl: "LinkedIn",
  twitterUrl: "X/Twitter",
  facebookUrl: "Facebook",
  instagramUrl: "Instagram",
  metaTitle: "meta title",
  metaDescription: "meta description",
  isIndexable: "indexability",
}

export const REDIRECT_FIELD_LABELS: FieldLabels = {
  fromPath: "source path",
  toPath: "target path",
  statusCode: "status code",
}

export const QUESTION_FIELD_LABELS: FieldLabels = {
  question: "question",
  answer: "answer",
  status: "status",
  priority: "priority",
}

/** `passwordHash` is deliberately absent — see the module note. A password
 *  change is reported by the route as its own summary line, never as a diff. */
export const USER_FIELD_LABELS: FieldLabels = {
  name: "name",
  email: "email",
  role: "role",
  isActive: "active state",
}

export const PAGE_FIELD_LABELS: FieldLabels = {
  title: "title",
  path: "path",
  metaTitle: "meta title",
  metaDescription: "meta description",
  canonicalUrl: "canonical URL",
  ogImageKey: "social image",
  isIndexable: "indexability",
}

export const SEARCH_CONSOLE_ISSUE_FIELD_LABELS: FieldLabels = {
  type: "type",
  title: "title",
  description: "description",
  url: "affected URL",
  detectedAt: "detected date",
  status: "status",
  notes: "notes",
}

/**
 * A menu has exactly two operator-editable fields. `location` is included
 * because moving a menu from one slot to another is the change most likely to
 * surprise somebody looking at the public site afterwards.
 */
export const MENU_FIELD_LABELS: FieldLabels = {
  name: "name",
  location: "location",
}

/**
 * Menu-item fields.
 *
 * `target` is named but its VALUE is never included — the summary says "changed
 * target", not what it changed to. That keeps the rule uniform with every other
 * entity here and means a menu item pointing at an unpublished page cannot leak
 * that page's path into a log a wider audience reads.
 *
 * `sortOrder` is deliberately absent: reordering is logged as its own `moved`
 * action with a sentence a person can read, and listing the column as well
 * would put "changed sort order" on every drag.
 */
export const MENU_ITEM_FIELD_LABELS: FieldLabels = {
  label: "label",
  type: "type",
  target: "target",
  parentId: "parent item",
  isActive: "visibility",
  opensInNewTab: "new-tab behaviour",
}
