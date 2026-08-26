/**
 * The activity log's vocabulary — the single source of truth for what an entry
 * can say.
 *
 * Dependency-free on purpose, exactly like `Framework/Auth/permissions.ts`:
 * this module is imported by the Drizzle schema (which turns the arrays into
 * column enums), by route handlers that write entries, and by the client
 * component that renders the filter dropdowns. Anything pulled in here would
 * end up in all three bundles.
 *
 * Adding a value means adding it to the array AND its label below — the label
 * maps are exhaustive `Record`s so TypeScript fails the build if you forget,
 * rather than the screen rendering a raw enum value at an admin.
 */

/**
 * What happened. Deliberately a small, fixed set: an audit trail people
 * actually read is one where "published" always means the same thing.
 *
 * `updated` is the catch-all for field edits; the entry's `summary` says which
 * fields. The publish-state actions are split out from it because "who put this
 * live" is the single most common question asked of a log like this, and it
 * must be answerable by a filter rather than by reading summaries.
 */
export const ACTIVITY_ACTIONS = [
  "created",
  "updated",
  "deleted",
  "trashed",
  "restored",
  "published",
  "unpublished",
  "scheduled",
  "submitted",
  "approved",
  "rejected",
  "duplicated",
  "reverted",
  "bulk_updated",
  "moved",
  "copied",
  // Theme activation. Its own action rather than `updated` on settings: "who
  // changed how the site looks" is a question people ask of a log like this,
  // and it must be answerable by a filter rather than by reading summaries —
  // the same reasoning that split the publish-state actions out.
  "activated",
] as const

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]

export const ACTIVITY_ACTION_LABELS: Record<ActivityAction, string> = {
  created: "Created",
  updated: "Updated",
  deleted: "Deleted",
  trashed: "Moved to trash",
  restored: "Restored",
  published: "Published",
  unpublished: "Unpublished",
  scheduled: "Scheduled",
  submitted: "Submitted for review",
  approved: "Approved",
  rejected: "Changes requested",
  duplicated: "Duplicated",
  reverted: "Reverted to a revision",
  bulk_updated: "Bulk edited",
  moved: "Moved",
  copied: "Copied",
  activated: "Activated",
}

/**
 * Badge tone per action, so a destructive entry is visible while scanning.
 * The values are ElementBadge variants.
 */
export const ACTIVITY_ACTION_VARIANTS: Record<
  ActivityAction,
  "muted" | "info" | "success" | "warning" | "destructive"
> = {
  created: "info",
  updated: "muted",
  deleted: "destructive",
  trashed: "warning",
  restored: "info",
  published: "success",
  unpublished: "warning",
  scheduled: "info",
  submitted: "info",
  approved: "success",
  rejected: "warning",
  duplicated: "muted",
  reverted: "warning",
  bulk_updated: "muted",
  moved: "muted",
  copied: "muted",
  // Site-wide and immediate, so it should stand out while scanning.
  activated: "success",
}

/** What it happened to. */
export const ACTIVITY_ENTITY_TYPES = [
  "post",
  "category",
  "tag",
  "series",
  "question",
  "author",
  "redirect",
  "user",
  "settings",
  "file",
  "folder",
  "search_console_issue",
  "bing_submission",
  "bing_site_settings",
  "bing_sitemap",
  "page",
  "theme",
  // Navigation. A menu and its items are separate subjects: "who removed the
  // link to Pricing" and "who deleted the whole footer menu" are different
  // questions, and folding them together would make the first unanswerable.
  "menu",
  "menu_item",
  // Per-theme presentation values. Its own type rather than `settings`: the
  // singleton site settings and a theme's own configuration are different
  // subjects, and folding them together would make "who changed the theme's
  // appearance" unanswerable by a filter.
  "theme_settings",
  // First-run initialization. Its own subject rather than `settings`: "when was
  // this installation set up, and by whom" is a question an auditor asks once
  // and must be able to answer without reading every settings edit ever made.
  "installation",
] as const

export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number]

export const ACTIVITY_ENTITY_LABELS: Record<ActivityEntityType, string> = {
  post: "Post",
  category: "Category",
  tag: "Tag",
  series: "Series",
  question: "Reader question",
  author: "Author",
  redirect: "Redirect",
  user: "Staff account",
  settings: "Settings",
  file: "File",
  folder: "Folder",
  search_console_issue: "Search Console issue",
  bing_submission: "Bing Webmaster submission",
  bing_site_settings: "Bing Webmaster site settings",
  bing_sitemap: "Bing Webmaster sitemap",
  page: "Page",
  theme: "Theme",
  menu: "Menu",
  menu_item: "Menu item",
  theme_settings: "Theme settings",
  installation: "Installation",
}

/**
 * Where an entry's subject can be opened, or null when it has no screen of its
 * own (a tag lives in a list with a drawer, not on a page).
 *
 * Returns null for a missing id too: a permanently deleted post leaves its
 * entry behind — that is the point of the log — and a link to a 404 is worse
 * than plain text.
 */
/**
 * Returns an ADMIN-RELATIVE path. Callers join it with the configured public
 * admin path — `useAdminHref()` in a client component, `adminPath()` on the
 * server. Keeping this function free of configuration keeps it a pure function
 * of its two arguments, which is what makes the switch above readable.
 */
export function activityEntityHref(
  entityType: ActivityEntityType,
  entityId: string | null
): string | null {
  if (!entityId) return null
  switch (entityType) {
    case "post":
      return `/blog/posts/${entityId}/edit`
    case "author":
      return "/authors"
    case "user":
      return "/admin-users"
    case "settings":
      return "/settings/global"
    case "bing_site_settings":
      return "/bing-webmaster/site-settings"
    case "bing_sitemap":
      return "/bing-webmaster/sitemaps"
    case "page":
      return `/pages/${entityId}/edit`
    case "theme_settings":
      return "/appearance/theme-settings"
    case "menu":
    case "menu_item":
      // Neither has a screen of its own; both are edited on the Menus screen.
      // An item's id would not survive as a fragment either, since the screen
      // is grouped by location rather than by item.
      return "/appearance/menus"
    case "theme":
      // A theme has no page of its own; the Appearance screen is where you go
      // to see or change what this entry describes.
      return "/appearance/themes"
    default:
      return null
  }
}

export function isActivityAction(value: unknown): value is ActivityAction {
  return typeof value === "string" && (ACTIVITY_ACTIONS as readonly string[]).includes(value)
}

export function isActivityEntityType(value: unknown): value is ActivityEntityType {
  return (
    typeof value === "string" && (ACTIVITY_ENTITY_TYPES as readonly string[]).includes(value)
  )
}