import { and, eq, isNull, or } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPosts, customPages } from "@/db/tables"
import { CacheService } from "@/Framework/Redis/CacheService"
import { getSettingsRow } from "@/Framework/Settings/SettingsService"
import { likeContains } from "@/db/likeEscape"
import { PUBLIC_IMAGE_ROUTE_BASE } from "@/Themes/contract/runtime/publicImageUrl"

/**
 * Whether an anonymous visitor may read this key.
 *
 * Extracted from `src/app/api/public/images/[...key]/route.ts` so it can be
 * tested directly. A Next route module may only export HTTP method handlers, so
 * the alternative was driving this through a fabricated `Request` — which tests
 * the routing as much as the rule.
 *
 * THE RULE IS REFERENCE, NOT PREFIX.
 *
 * Prefix rules fail in both directions here. Admins pick featured images from
 * anywhere in the bucket via the File Manager, so a `posts/`-only allowlist
 * would 404 half the real images — and treating `posts/` as blanket-public
 * (which this route used to do) exposed every unreferenced object an admin
 * happened to file there. The bucket is a general-purpose admin file store:
 * documents, videos and unreferenced uploads must stay private.
 */

/** Long, because the answer only changes when a post is edited, and a miss
 *  costs a LIKE scan over every published post's body. */
const PUBLIC_IMAGE_CACHE_TTL_SECONDS = 3600

/**
 * The site's own logo and favicon.
 *
 * ADDED IN PHASE 2, AND IT FIXES A BUG RATHER THAN OPENING A DOOR. `toBrandView`
 * already renders the logo as `publicImagePath(brand.logoKey)`, and the default
 * theme's Layout already puts that in an `<img>` on every public page — but
 * nothing here ever consulted the settings row, so the route answered 404 and
 * the site logo simply did not appear. The favicon reached the same place in
 * Phase 2 when it stopped being a presigned URL.
 *
 * Two EXACT-MATCH keys from the singleton settings row. Not a prefix, not a
 * pattern. They name the assets whose entire purpose is to appear on every
 * anonymous page, only an admin can set them, and an admin can already publish
 * any object deliberately — so nothing becomes readable that was not already
 * intended to be.
 *
 * Checked FIRST because it is the cheapest branch (the settings row is cached)
 * and the most frequently hit: the logo is requested on every public page
 * render, and it must never fall through to the LIKE scan.
 */
async function isBrandAsset(key: string): Promise<boolean> {
  const row = await getSettingsRow()
  if (!row) return false
  // `key` is guaranteed non-empty by the route's own check, but comparing
  // explicitly against a truthy stored value means an unset logo can never
  // match an empty key even if that changes.
  return (
    (!!row.logoKey && row.logoKey === key) || (!!row.faviconKey && row.faviconKey === key)
  )
}

export async function isPubliclyReferencedImage(key: string): Promise<boolean> {
  if (await isBrandAsset(key)) return true

  // `isPublished` and `deletedAt` belong in the WHERE clause, not in a check on
  // the row that comes back: `findFirst` returns an arbitrary match, so a
  // trashed draft sharing an image with a live post would answer "not public"
  // for an image that plainly is.
  const post = await db.query.blogPosts.findFirst({
    where: and(
      eq(blogPosts.isPublished, true),
      isNull(blogPosts.deletedAt),
      or(eq(blogPosts.featuredImageKey, key), eq(blogPosts.ogImageKey, key)),
    ),
  })
  if (post) return true

  const page = await db.query.customPages.findFirst({
    where: and(eq(customPages.isPublished, true), eq(customPages.ogImageKey, key)),
  })
  if (page) return true

  // In-content images picked from the File Manager can live anywhere in the
  // bucket, not just under `posts/`, so the columns above don't cover them.
  // Without this branch every such image 404s on the public page.
  //
  // A LIKE scan over `content` is the expensive path, so it is last and its
  // result is cached: the answer only changes when a post/page is edited, and
  // the response itself is served `immutable` for a year anyway. The pattern
  // matches the public URL form the editor writes, NOT a bare key — matching a
  // bare key would let any string appearing in prose unlock an arbitrary bucket
  // object.
  //
  // `likeContains` rather than Drizzle's `like`: the key is attacker-supplied,
  // and although it was always safely BOUND, `%` and `_` stayed live as
  // wildcards inside the pattern. Requesting the key `%` widened this to "any
  // published post that mentions the image route at all", so a single published
  // post with a single image authorised every private object in the bucket.
  // `likeContains` escapes the metacharacters and attaches an ESCAPE clause.
  const needle = `${PUBLIC_IMAGE_ROUTE_BASE}/${key}`
  return CacheService.remember(`public-image:${key}`, PUBLIC_IMAGE_CACHE_TTL_SECONDS, async () => {
    const referencingPost = await db.query.blogPosts.findFirst({
      where: and(
        eq(blogPosts.isPublished, true),
        isNull(blogPosts.deletedAt),
        likeContains(blogPosts.content, needle),
      ),
    })
    if (referencingPost) return true

    // customPages has no deletedAt — there's no trash for this table.
    const referencingPage = await db.query.customPages.findFirst({
      where: and(eq(customPages.isPublished, true), likeContains(customPages.content, needle)),
    })
    return !!referencingPage
  })
}
