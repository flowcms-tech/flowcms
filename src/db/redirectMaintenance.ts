import { and, eq, inArray } from "drizzle-orm"
import { db } from "./client"
import { blogCategories, blogPosts, blogTags, customPages, redirects } from "@/db/tables"
import { CacheService } from "@/Framework/Redis/CacheService"

/** Accepts either the top-level `db` or the `tx` handed to a
 *  `db.transaction(async (tx) => …)` callback — both expose the same
 *  query-builder surface this function actually uses. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Writes one (fromPath → toPath) redirect, keeping the whole table in the
 * shape Google actually wants: no chains, no loops, no duplicate rows for a
 * path that's been reused.
 *
 * Shared by both the automatic case (a post's slug changes) and manual
 * creation from the Redirects screen — a hand-added redirect gets exactly
 * the same safety as one the system wrote for itself.
 */
export async function upsertRedirectWithFlattening(
  tx: Executor,
  fromPath: string,
  toPath: string,
  isAutomatic: boolean,
  /** 301 (permanent) unless told otherwise — right for the automatic
   *  slug-rename case, and the sane default for a manually-created one. */
  statusCode = 301
): Promise<void> {
  // Flatten chains: anything that pointed at the old path now points
  // straight at the new one, so A→B→C collapses to A→C. Each extra hop is
  // both latency and diluted ranking signal, and crawlers only follow a
  // bounded number before giving up.
  await tx.update(redirects).set({ toPath }).where(eq(redirects.toPath, fromPath))

  // A path being pointed back at itself would be an infinite redirect —
  // e.g. renaming a slug back to something it used to be. Drop those
  // instead of writing a loop.
  await tx.delete(redirects).where(eq(redirects.fromPath, toPath))

  // fromPath is unique, so reusing one (a slug renamed twice, or an admin
  // re-pointing an existing redirect) has to upsert rather than throw.
  await tx
    .insert(redirects)
    .values({ fromPath, toPath, isAutomatic, statusCode })
    .onConflictDoUpdate({ target: redirects.fromPath, set: { toPath, isAutomatic, statusCode } })

  // Lives here rather than in each caller: this is the one function that
  // ever writes to the redirect table (both the automatic slug-rename path
  // and manual creation from the Redirects screen go through it), so this
  // is the one place that can never forget to invalidate. Safe even if the
  // enclosing db.transaction later rolls back — an extra cache miss is the
  // only cost, never a correctness problem.
  await CacheService.delPattern("redirects:*")
}

/** Only called on the 404 path, so the extra query costs nothing in the
 *  common case. Lives here rather than in the proxy because the proxy must
 *  never transitively import the DB client. Not blog-specific — the pages
 *  catch-all route (src/app/[...path]/page.tsx) uses this too. */
export async function findRedirect(fromPath: string) {
  return db.query.redirects.findFirst({ where: eq(redirects.fromPath, fromPath) })
}

export interface LiveConflict {
  type: "post" | "category" | "tag" | "page"
  id: string
  title: string
}

/**
 * A manually-created redirect for a path something still resolves at would
 * be silently ignored — the real content always wins over the redirects
 * table (see the not-found branches in src/app/blog/**). This is the check
 * that keeps an admin from creating one and having it just do nothing.
 *
 * Understands the three /blog/... shapes this app resolves (a post, a
 * category archive, a tag archive) plus a custom page at any other path.
 */
export async function findLiveConflict(fromPath: string): Promise<LiveConflict | null> {
  const page = await db.query.customPages.findFirst({
    where: and(eq(customPages.path, fromPath), eq(customPages.isPublished, true)),
  })
  if (page) return { type: "page", id: page.id, title: page.title }

  const categoryMatch = fromPath.match(/^\/blog\/category\/([a-z0-9-]+)$/)
  if (categoryMatch) {
    const category = await db.query.blogCategories.findFirst({
      where: and(eq(blogCategories.slug, categoryMatch[1]), eq(blogCategories.isActive, true)),
    })
    return category ? { type: "category", id: category.id, title: category.name } : null
  }

  const tagMatch = fromPath.match(/^\/blog\/tag\/([a-z0-9-]+)$/)
  if (tagMatch) {
    const tag = await db.query.blogTags.findFirst({
      where: and(eq(blogTags.slug, tagMatch[1]), eq(blogTags.isActive, true)),
    })
    return tag ? { type: "tag", id: tag.id, title: tag.name } : null
  }

  const postMatch = fromPath.match(/^\/blog\/([a-z0-9-]+)$/)
  if (postMatch) {
    const post = await db.query.blogPosts.findFirst({
      where: and(
        eq(blogPosts.slug, postMatch[1]),
        eq(blogPosts.isPublished, true)
      ),
    })
    // A trashed-but-still-flagged-published row can't happen (trashing
    // clears isPublished), but the null check costs nothing and doesn't
    // rely on that invariant holding forever.
    return post && !post.deletedAt ? { type: "post", id: post.id, title: post.title } : null
  }

  return null
}

/**
 * Batch lookup for the Blog Posts admin list — which of these posts' own
 * `/blog/<slug>` paths currently have a redirect pointed away from them.
 * Purely informational (a "Redirects to X" badge); doesn't affect whether
 * the redirect actually fires, which is still decided at render time in
 * src/app/blog/[slug]/page.tsx.
 */
export async function getRedirectTargetsBySlugs(slugs: string[]): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map()

  const fromPaths = slugs.map((slug) => `/blog/${slug}`)
  const rows = await db.query.redirects.findMany({ where: inArray(redirects.fromPath, fromPaths) })

  const bySlug = new Map<string, string>()
  for (const row of rows) {
    const slug = row.fromPath.replace(/^\/blog\//, "")
    bySlug.set(slug, row.toPath)
  }
  return bySlug
}
