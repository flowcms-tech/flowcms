import { ROLES, type Role } from "./permissions"

/**
 * The authorization policy for every route under `src/app/api`.
 *
 * WHY A REGISTRY RATHER THAN A CHECK IN EACH HANDLER
 *
 * The previous shape was `const session = await auth(); if (!session?.user?.id)
 * return 401` repeated 134 times across 84 files — which authenticates but never
 * authorizes. A four-role model existed and roughly sixty routes never consulted
 * it, so the lowest role could publish public pages, create redirects to
 * arbitrary hosts, manage every object in S3, and drive every integration.
 *
 * Fixing that by pasting a role check into sixty handlers would have produced
 * sixty independently-drifting checks and, more importantly, would not have
 * stopped the *sixty-first* route from shipping with none. So the floor lives
 * here instead:
 *
 *   - `requireApiAuth()` (src/Framework/Auth/apiAuth.ts) resolves the caller's
 *     path against this table on every request. A path with no entry is denied,
 *     not allowed — a new route is unreachable until someone writes down what it
 *     is for.
 *   - `tests/auth/routeCoverage.test.ts` walks `src/app/api` on disk and fails
 *     if any `route.ts` lacks an entry, or if an entry names a route that no
 *     longer exists. The registry cannot silently rot.
 *
 * WHAT THIS IS AND IS NOT
 *
 * A policy here is a FLOOR, never a ceiling. Routes that need finer judgement
 * still make it: post routes call `canEditPost` / `checkPostEditAccess` for the
 * "a contributor may edit only their own unpublished work" rule, `admin-users`
 * calls `canAssignRole` / `canDemoteOwner`, `settings/global` calls
 * `canManageSettings`. Those checks are unchanged and still run. The floor
 * exists so that a route which forgets one is still not wide open.
 *
 * This module is deliberately dependency-free — no `next/*`, no database — so
 * that it is cheap to unit-test and safe to import from anywhere.
 */

/** A route is either open to the internet, or requires at least some role. */
export type RouteAccess = Role | "public"

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS"

export interface RoutePolicy {
  /**
   * Applies to every method the route exports that is not named in `methods`.
   *
   * Set this to the STRICTEST value the route needs and widen specific methods,
   * never the other way round: a method added later inherits the default, and
   * inheriting "too strict" is a bug report while inheriting "too loose" is a
   * vulnerability.
   */
  default: RouteAccess
  /** Per-method floors, for routes where reading is broader than writing. */
  methods?: Partial<Record<HttpMethod, RouteAccess>>
  /**
   * Why this floor was chosen. Required, and asserted non-trivial by the
   * registry hygiene test — the point of the table is that every decision is
   * written down where the next person can disagree with it.
   */
  reason: string
}

const ROLE_RANK: Record<Role, number> = {
  owner: 3,
  admin: 2,
  editor: 1,
  contributor: 0,
}

/**
 * Keyed by route pattern relative to `/api`, matching the directory layout
 * under `src/app/api` exactly (including `[id]` / `[...key]` segments) so the
 * coverage test can compare the two by string equality.
 */
export const ROUTE_POLICIES: Record<string, RoutePolicy> = {
  // === Deliberately public =================================================
  //
  // Eight routes, each unauthenticated on purpose. The registry hygiene test
  // pins this exact list, so adding a ninth is a conscious act that shows up
  // in review as a failing test rather than as a quiet new entry.

  "auth/[...nextauth]": {
    default: "public",
    reason:
      "Auth.js's own sign-in/sign-out/session endpoints. Cannot require a session — it is what issues one. Brute-force protection and CAPTCHA binding live inside the Credentials provider's authorize(), not here.",
  },
  health: {
    default: "public",
    reason:
      "Container liveness probe. Must answer before any session exists and without touching the database, so it reports only that the process is running.",
  },
  ready: {
    default: "public",
    reason:
      "Container readiness probe and the Docker healthcheck target, so it must answer unauthenticated. Returns component states only (ok/unavailable/not_configured) — never hostnames, bucket names, credentials or error text.",
  },
  captcha: {
    default: "public",
    reason:
      "Issues the login CAPTCHA image and its signed cookie, so it is reachable before any session exists.",
  },
  "public/404-log": {
    default: "public",
    reason:
      "Beacon posted by the public 404 page so broken inbound links get recorded. Write-only and rate limited.",
  },
  "public/images/[...key]": {
    default: "public",
    reason:
      "Serves images referenced by published posts and pages to anonymous visitors. Access is bounded by a reference check against published content, not by a session.",
  },
  "public/indexnow-key.txt": {
    default: "public",
    reason:
      "IndexNow requires the verification key file to be fetchable by search engine crawlers.",
  },
  "public/questions": {
    default: "public",
    reason:
      "Reader question submissions from the public blog. Protected by honeypot, CAPTCHA and rate limiting.",
  },
  setup: {
    default: "public",
    reason:
      "First-run setup, and the one route that CANNOT require a session: it exists to create the first account, so requiring one would mean no FlowCMS installation could ever be initialized. It is not an exemption from authorization — five controls replace the session, and all five are enforced in the handler and in src/Framework/Setup. (1) It answers only while settings.setupCompletedAt is null; once initialized, both verbs return 404 and never become an 'already installed' oracle. (2) FLOWCMS_SETUP_TOKEN is required — a deployment secret with no default and no fallback, at least 24 high-entropy characters, compared in constant time, never logged, never echoed, never accepted from a URL. (3) Failed attempts are rate limited per client IP through the same limiter as credential login, consumed before parsing or hashing. (4) Browser mutations must be same-origin, because a token proves knowledge and not intent. (5) Completion is one-shot and transactional: the singleton marker is claimed conditionally, so concurrent attempts with different owner emails produce exactly one owner. Input is strictly bounded by Zod, and no response carries the token, the password, or any deployment configuration.",
  },

  // === Authoring surface — floor is `contributor` ==========================
  //
  // A contributor's whole job is drafting a post and submitting it for review.
  // Everything they need to do that sits here. Each of these routes then
  // applies the ownership rule (`canEditPost` / `checkPostEditAccess`) itself —
  // the floor only says "a signed-in author may attempt this".

  dashboard: {
    default: "contributor",
    reason:
      "The landing screen every signed-in staff member sees. Returns aggregate content counts and recent activity, nothing credential-bearing.",
  },
  "blog/posts": {
    default: "contributor",
    reason:
      "Listing and creating posts is the contributor's core task; the handler scopes what they may see and own.",
  },
  "blog/posts/[id]": {
    default: "contributor",
    reason:
      "Per-post read/update/trash. The handler enforces canEditPost, which limits a contributor to their own unpublished work.",
  },
  "blog/posts/[id]/faq": {
    default: "contributor",
    reason:
      "FAQ blocks belong to a post being drafted. The handler calls checkPostEditAccess, so post ownership still applies.",
  },
  "blog/posts/[id]/faq/[faqId]": {
    default: "contributor",
    reason: "Same ownership gate as the FAQ collection route (checkPostEditAccess).",
  },
  "blog/posts/[id]/faq/reorder": {
    default: "contributor",
    reason: "Same ownership gate as the FAQ collection route (checkPostEditAccess).",
  },
  "blog/posts/[id]/lock": {
    default: "contributor",
    reason:
      "Edit locks stop two people overwriting each other. Reading who holds a lock is harmless to any staff member; taking or releasing one requires edit access to the post, enforced in the handler.",
  },
  "blog/posts/[id]/preview-link": {
    default: "contributor",
    reason:
      "The handler enforces canCreatePreviewLink — a contributor may mint a preview link for their own draft, which is how a draft gets reviewed.",
  },
  "blog/posts/[id]/related": {
    default: "contributor",
    reason: "Related-post overrides are part of authoring; guarded by checkPostEditAccess.",
  },
  "blog/posts/[id]/review": {
    default: "contributor",
    reason:
      "Submitting for review is the contributor's exit path. The handler splits submit (canSubmitForReview) from approve/reject (canApprove).",
  },
  "blog/posts/[id]/revisions": {
    default: "contributor",
    reason:
      "Revision history of a post the caller may edit. The handler applies checkPostEditAccess so a contributor cannot read the history of somebody else's post.",
  },
  "blog/posts/[id]/revisions/[revisionId]": {
    default: "contributor",
    reason:
      "Restoring a revision is an edit; the handler applies the same ownership gate as editing the post.",
  },
  "blog/posts/link-suggestions": {
    default: "contributor",
    reason:
      "Suggests internal links while writing. Returns titles and slugs of existing posts, which any author already sees in the post picker.",
  },
  "file-manager": {
    default: "contributor",
    methods: { GET: "contributor", POST: "contributor" },
    reason:
      "Browsing and uploading media is required to give a draft a featured image. Destructive operations live on the sibling routes below and stop at editor.",
  },
  "media/[...key]": {
    default: "contributor",
    reason:
      "Serves the bytes of a stored object to a signed-in user. Same floor as browsing the File Manager, and for the same reason: this is how a contributor sees the thumbnails they pick a featured image from. It replaced presigned URLs, which handed the browser a URL pointing straight at the object store — unreachable on the bundled-Garage deployment and impossible for a filesystem backend.",
  },

  // Taxonomy and author profiles: readable by anyone who fills in a post form,
  // writable only by an editor. Split by method rather than given a single
  // floor, because a single floor would either lock contributors out of the
  // category picker or let them rewrite the site's taxonomy.
  "blog/categories": {
    default: "editor",
    methods: { GET: "contributor" },
    reason:
      "Contributors must read categories to categorise a draft; creating one changes the public site's structure.",
  },
  "blog/categories/[id]": {
    default: "editor",
    methods: { GET: "contributor" },
    reason: "Same split as the category collection route.",
  },
  "blog/tags": {
    default: "editor",
    methods: { GET: "contributor" },
    reason: "Same split as categories — read to tag a draft, write is editorial.",
  },
  "blog/tags/[id]": {
    default: "editor",
    methods: { GET: "contributor" },
    reason: "Same split as the tag collection route.",
  },
  "blog/series": {
    default: "editor",
    methods: { GET: "contributor" },
    reason: "Same split as categories — read to place a draft in a series, write is editorial.",
  },
  "blog/series/[id]": {
    default: "editor",
    methods: { GET: "contributor" },
    reason: "Same split as the series collection route.",
  },
  authors: {
    default: "editor",
    methods: { GET: "contributor" },
    reason:
      "Contributors read author profiles to set a byline. Author profiles are public-facing content, so editing one is editorial.",
  },
  "authors/[id]": {
    default: "editor",
    methods: { GET: "contributor" },
    reason: "Same split as the author collection route.",
  },

  // === Editorial surface — floor is `editor` ===============================

  "blog/posts/bulk": {
    default: "editor",
    reason:
      "Bulk SEO edits name a list of ids most of which the caller does not own; the handler already enforces canBulkEditPosts.",
  },
  "blog/posts/[id]/duplicate": {
    default: "editor",
    reason:
      "Duplicating copies any post, including published ones written by somebody else, into a new draft.",
  },
  "blog/questions": {
    default: "editor",
    reason: "Reader-question moderation is an editorial job (canModerateQuestions).",
  },
  "blog/questions/[id]": {
    default: "editor",
    reason: "Reader-question moderation is an editorial job (canModerateQuestions).",
  },
  "blog/seo-audit": {
    default: "editor",
    reason: "Site-wide SEO scoring across every post, including posts the caller did not write.",
  },
  "blog/link-check": {
    default: "editor",
    reason:
      "Makes outbound HTTP requests to URLs found in post content. Even with the SSRF guard in LinkChecker, an endpoint that fetches on the server's behalf is not something the lowest role should reach.",
  },
  "links-report": {
    default: "editor",
    reason: "Site-wide internal/external link report across all content.",
  },
  "not-found-log": {
    default: "editor",
    reason:
      "404 log drives redirect decisions — editorial SEO work. DELETE only clears log rows, so it needs no higher floor than reading them.",
  },
  pages: {
    default: "editor",
    reason:
      "Custom pages render at arbitrary public URLs. Creating one is publishing, which a contributor never does.",
  },
  "pages/[id]": {
    default: "editor",
    reason: "Editing or deleting a live public page is publishing.",
  },
  "business-reviews": {
    default: "editor",
    reason: "Testimonials are public-facing content; managing them is editorial.",
  },
  "business-reviews/[id]": {
    default: "editor",
    reason: "Testimonials are public-facing content; managing them is editorial.",
  },
  "search-console-issues": {
    default: "editor",
    reason: "Search Console issue triage is SEO work and holds no credentials.",
  },
  "search-console-issues/[id]": {
    default: "editor",
    reason: "Search Console issue triage is SEO work and holds no credentials.",
  },
  "search-console/action-feed": {
    default: "editor",
    reason: "Read-only cross-source SEO action feed. Editors act on it; it exposes no secrets.",
  },
  "search-console/page-profile": {
    default: "editor",
    reason: "Read-only per-page SEO profile. Editors act on it; it exposes no secrets.",
  },

  // File Manager: destructive operations. Uploading and browsing is authoring
  // (above); renaming, moving and deleting reaches every object in the bucket,
  // including images published posts depend on.
  "file-manager/file": {
    default: "editor",
    reason:
      "Renaming or deleting an object can break the image on any published post, so it stops at editor rather than contributor.",
  },
  "file-manager/file/copy": {
    default: "editor",
    reason: "Bucket-wide object manipulation; same floor as the other destructive file routes.",
  },
  "file-manager/file/move": {
    default: "editor",
    reason: "Bucket-wide object manipulation; same floor as the other destructive file routes.",
  },
  "file-manager/directory": {
    default: "editor",
    reason:
      "Creating, renaming and deleting prefixes moves or destroys every object beneath them in one call.",
  },
  "file-manager/directory/copy": {
    default: "editor",
    reason: "Recursive prefix copy; same floor as the other destructive directory routes.",
  },
  "file-manager/directory/move": {
    default: "editor",
    reason: "Recursive prefix move; same floor as the other destructive directory routes.",
  },

  // Integration DATA screens. Read-only analytics an SEO editor works from
  // daily. They consume a stored credential but never read, write or reveal
  // one — configuring the connection is a separate set of routes below, at
  // admin. Putting these at admin instead would make the SEO screens unusable
  // by the people whose job they are.
  "integrations/google-search-console/enhancements": {
    default: "editor",
    reason: "Read-only Search Console data screen; reveals no credential.",
  },
  "integrations/google-search-console/page-indexing": {
    default: "editor",
    reason: "Read-only Search Console data screen; reveals no credential.",
  },
  "integrations/google-search-console/page-performance": {
    default: "editor",
    reason: "Read-only Search Console data screen; reveals no credential.",
  },
  "integrations/google-search-console/site-performance": {
    default: "editor",
    reason: "Read-only Search Console data screen; reveals no credential.",
  },
  "integrations/google-search-console/inspect-url": {
    default: "editor",
    reason:
      "URL inspection is read-only against Google's index; the URL is validated against this site's own base URL.",
  },
  "integrations/bing-webmaster/overview": {
    default: "editor",
    reason: "Read-only Bing Webmaster data screen; reveals no credential.",
  },
  "integrations/bing-webmaster/traffic": {
    default: "editor",
    reason: "Read-only Bing Webmaster data screen; reveals no credential.",
  },
  "integrations/bing-webmaster/keywords": {
    default: "editor",
    reason: "Read-only Bing Webmaster data screen; reveals no credential.",
  },
  "integrations/bing-webmaster/backlinks": {
    default: "editor",
    reason: "Read-only Bing Webmaster data screen; reveals no credential.",
  },
  "integrations/bing-webmaster/url-inspection": {
    default: "editor",
    reason: "Read-only Bing Webmaster inspection; reveals no credential.",
  },
  "integrations/bing-webmaster/sitemaps/details": {
    default: "editor",
    reason: "Read-only sitemap detail view; reveals no credential.",
  },
  "integrations/pagespeed/core-web-vitals": {
    default: "editor",
    reason:
      "Core Web Vitals is a read-only performance screen SEO editors work from. POST only triggers a fresh measurement of this site's own URLs.",
  },
  "integrations/bing-webmaster/crawl": {
    default: "admin",
    methods: { GET: "editor" },
    reason:
      "Crawl statistics are an editor-level data screen; PATCH changes the crawl rate Bing applies to the live site, which is a configuration change.",
  },

  // === Administrative surface — floor is `admin` ===========================

  "admin-users": {
    default: "admin",
    reason:
      "Staff accounts. The handler additionally enforces canAssignRole / canChangeRole so only an owner can mint another owner.",
  },
  "admin-users/[id]": {
    default: "admin",
    reason:
      "Staff accounts. The handler additionally enforces canDemoteOwner and the last-owner-standing rule.",
  },
  "settings/global": {
    default: "admin",
    reason:
      "Settings hold S3 and OAuth credentials and change how the public site behaves. GET is gated too: the response reveals which secrets are configured and every endpoint the site talks to.",
  },
  "appearance/themes": {
    default: "admin",
    reason:
      "Theme activation changes every page of the public site at once, and takes effect immediately. GET is gated too: the listing is the operator's appearance configuration, including which themes stopped working after an upgrade.",
  },
  "appearance/theme-settings": {
    default: "admin",
    reason:
      "Theme settings change the appearance of every public page, and the listing reveals the operator's configuration for every installed theme. Same threshold as theme activation; menus stay editor because a menu is content navigation rather than site appearance.",
  },
  "appearance/menus": {
    default: "editor",
    reason:
      "Navigation menus decide how readers reach content, which is editorial work rather than site administration. GET is gated too: the listing names unpublished pages and trashed posts by way of its broken-reference warnings.",
  },
  "appearance/menus/[id]": {
    default: "editor",
    reason:
      "Renaming or deleting a menu removes navigation from every public page that renders its slot. Editorial, matching the rest of the menu surface, and never below it.",
  },
  "appearance/menus/[id]/items": {
    default: "editor",
    reason:
      "Adding and reordering menu items changes the site's public navigation. Same editorial threshold as the menu itself, so no verb here is reachable by someone who could not create the menu.",
  },
  "appearance/menus/[id]/items/[itemId]": {
    default: "editor",
    reason:
      "Editing or deleting one menu item, including where it points and whether it is visible. Identical floor to its parent collection, so the finer-grained route cannot be the weaker one.",
  },
  "activity-log": {
    default: "admin",
    reason:
      "The audit trail records who did what across every module, including staff-account changes. Reading it is an administrative act.",
  },

  // Redirects. Reading is SEO work; writing creates a redirect from this site's
  // own domain to an arbitrary external URL — a phishing primitive that
  // inherits the site's reputation, which is why writes sit a rung above the
  // rest of the SEO surface.
  redirects: {
    default: "admin",
    methods: { GET: "editor" },
    reason:
      "toPath accepts an absolute external URL, so creating a redirect is an open-redirect facility; reading the list is ordinary SEO work.",
  },
  "redirects/[id]": {
    default: "admin",
    reason: "Editing a redirect can repoint an existing path at an attacker-controlled host.",
  },
  "redirects/export": {
    default: "editor",
    reason: "Read-only CSV export of the redirect table; same audience as reading the list.",
  },
  "redirects/import": {
    default: "admin",
    reason: "Bulk CSV import creates many redirects at once — the same risk as a single write, multiplied.",
  },

  // Integration CONNECTION and CONFIGURATION. These read or write stored
  // credentials, or mutate the third-party property itself.
  "integrations/google-search-console/auth": {
    default: "admin",
    reason: "Begins the OAuth flow using the stored client credentials.",
  },
  "integrations/google-search-console/callback": {
    default: "admin",
    reason:
      "Completes OAuth and persists a refresh token. Kept behind admin as well as state validation, so a tricked lower-privileged session cannot attach an attacker's Google account.",
  },
  "integrations/google-search-console/check": {
    default: "admin",
    reason: "Tests the stored connection and reports credential status.",
  },
  "integrations/google-search-console/sitemaps": {
    default: "admin",
    methods: { GET: "editor" },
    reason:
      "Listing submitted sitemaps is editorial; submitting or deleting one changes what Google crawls.",
  },
  "integrations/bing-webmaster/check": {
    default: "admin",
    reason: "Tests the stored Bing API key and reports credential status.",
  },
  "integrations/bing-webmaster/sitemaps": {
    default: "admin",
    methods: { GET: "editor" },
    reason:
      "Listing submitted sitemaps is editorial; submitting or deleting one changes what Bing crawls.",
  },
  "integrations/bing-webmaster/url-submission": {
    default: "admin",
    methods: { GET: "editor" },
    reason:
      "Submission quota is a read-only figure; submitting URLs spends a limited daily quota against the live property.",
  },
  "integrations/bing-webmaster/site-settings/blocked-urls": {
    default: "admin",
    reason: "Mutates crawl configuration on the live Bing property.",
  },
  "integrations/bing-webmaster/site-settings/deep-link-blocks": {
    default: "admin",
    reason: "Mutates deep-link configuration on the live Bing property.",
  },
  "integrations/bing-webmaster/site-settings/page-preview-blocks": {
    default: "admin",
    reason: "Mutates page-preview configuration on the live Bing property.",
  },
  "integrations/bing-webmaster/site-settings/query-params": {
    default: "admin",
    reason: "Mutates query-parameter handling on the live Bing property.",
  },
  "integrations/bing-webmaster/site-settings/regional": {
    default: "admin",
    reason: "Mutates regional targeting on the live Bing property.",
  },
  "integrations/bing-webmaster/site-settings/roles": {
    default: "admin",
    reason:
      "Grants and revokes access to the Bing Webmaster property itself — a permission change on a third-party account.",
  },
  "integrations/bing-webmaster/site-settings/site-moves": {
    default: "admin",
    reason: "Declares a site move to Bing, which affects how the whole domain is indexed.",
  },
  "integrations/indexnow": {
    default: "admin",
    reason:
      "Pings IndexNow using the site's verification key against a shared quota across search engines.",
  },

  // Redis. The admin panel's cache inspector. Reading arbitrary keys on a
  // shared instance is exactly what the namespace restriction in the handler
  // prevents; this floor is the second half of that fix.
  "redis/status": {
    default: "admin",
    reason: "Exposes Redis connection details and server-level statistics.",
  },
  "redis/keys": {
    default: "admin",
    reason: "Enumerates cache keys; infrastructure inspection, not editorial work.",
  },
  "redis/key": {
    default: "admin",
    reason:
      "Reads and deletes individual cache entries. The handler additionally confines both to the FlowCMS cache namespace.",
  },
  "redis/flush": {
    default: "admin",
    reason: "Clears the entire FlowCMS cache namespace in one call.",
  },
}

// -- Resolution ---------------------------------------------------------------

type SegmentKind = "static" | "dynamic" | "catchAll"

interface CompiledPattern {
  pattern: string
  segments: { kind: SegmentKind; value: string }[]
  hasCatchAll: boolean
}

function compile(pattern: string): CompiledPattern {
  const segments = pattern.split("/").map((value) => {
    if (value.startsWith("[...") && value.endsWith("]")) {
      return { kind: "catchAll" as const, value }
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      return { kind: "dynamic" as const, value }
    }
    return { kind: "static" as const, value }
  })
  return {
    pattern,
    segments,
    hasCatchAll: segments.some((s) => s.kind === "catchAll"),
  }
}

const COMPILED: CompiledPattern[] = Object.keys(ROUTE_POLICIES).map(compile)

function matches(compiled: CompiledPattern, parts: string[]): boolean {
  const { segments, hasCatchAll } = compiled

  if (hasCatchAll) {
    // A catch-all is only ever the last segment in Next's routing, and it must
    // consume at least one part.
    if (parts.length < segments.length) return false
  } else if (parts.length !== segments.length) {
    return false
  }

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    if (segment.kind === "catchAll") return true
    if (segment.kind === "dynamic") continue
    if (segment.value !== parts[i]) return false
  }
  return true
}

/**
 * Ranks two matching patterns the way Next.js itself resolves them: a static
 * segment beats a dynamic one at the same position, and a dynamic one beats a
 * catch-all. Without this, `/api/blog/posts/bulk` would match `blog/posts/[id]`
 * and silently inherit the wrong floor.
 */
function moreSpecific(a: CompiledPattern, b: CompiledPattern): number {
  const weight = { static: 2, dynamic: 1, catchAll: 0 }
  const len = Math.max(a.segments.length, b.segments.length)
  for (let i = 0; i < len; i++) {
    const wa = a.segments[i] ? weight[a.segments[i].kind] : -1
    const wb = b.segments[i] ? weight[b.segments[i].kind] : -1
    if (wa !== wb) return wb - wa
  }
  return 0
}

export interface ResolvedRouteAccess {
  /** The registry key that matched — useful in logs and in tests. */
  pattern: string
  access: RouteAccess
  policy: RoutePolicy
}

/**
 * Resolves an incoming request path and method to its access floor.
 *
 * Returns `null` when nothing matches. Callers MUST treat null as deny: that is
 * the whole default-deny mechanism, and it is what makes a route added without
 * a policy entry unreachable rather than unprotected.
 */
export function resolveRouteAccess(
  pathname: string,
  method: string
): ResolvedRouteAccess | null {
  const trimmed = pathname.split("?")[0].replace(/\/+$/, "")
  const withoutPrefix = trimmed.startsWith("/api/")
    ? trimmed.slice("/api/".length)
    : trimmed.startsWith("/api")
      ? trimmed.slice("/api".length).replace(/^\//, "")
      : trimmed.replace(/^\//, "")

  if (!withoutPrefix) return null
  const parts = withoutPrefix.split("/").filter(Boolean)
  if (parts.length === 0) return null

  const candidates = COMPILED.filter((c) => matches(c, parts))
  if (candidates.length === 0) return null

  const best = candidates.sort(moreSpecific)[0]
  const policy = ROUTE_POLICIES[best.pattern]
  const override = policy.methods?.[method.toUpperCase() as HttpMethod]

  return {
    pattern: best.pattern,
    access: override ?? policy.default,
    policy,
  }
}

/**
 * Whether a caller holding `role` (or none, when unauthenticated) clears
 * `access`.
 *
 * Pure and total: every combination has a defined answer, which is what lets
 * the authorization matrix test enumerate all of them.
 */
export function isAuthorizedForAccess(access: RouteAccess, role: Role | null): boolean {
  if (access === "public") return true
  if (role === null) return false
  return ROLE_RANK[role] >= ROLE_RANK[access]
}

/** Every role, for exhaustive matrix testing. */
export const ALL_ROLES: readonly Role[] = ROLES
