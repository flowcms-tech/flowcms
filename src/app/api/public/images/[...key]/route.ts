import { NextResponse } from "next/server"
import { and, eq, isNull, or } from "drizzle-orm"
import { db } from "@/db/client"
import { blogPosts, customPages } from "@/db/tables"
import { StorageService } from "@/Framework/Storage/StorageService"
import { getFileCategory, getFileExtension } from "@/Framework/Functions/FileValidation"
import { CacheService } from "@/Framework/Redis/CacheService"
import { PUBLIC_IMAGE_ROUTE_BASE } from "@/Framework/Storage/publicImageUrl"
import { likeContains } from "@/db/likeEscape"

/**
 * Unauthenticated image reads for the public blog.
 *
 * This is the only route in the app that reads S3 with no session, so the key
 * is treated as hostile input. Three guards, and every rejection returns 404
 * rather than 403 — a 403 would confirm that a key exists.
 *
 * The rule is REFERENCE, not prefix. A key is public only if something
 * published points at it: a live post's featured or social image, a live custom
 * page's social image, or a URL inside live post/page content.
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

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
}

function isSafeKey(key: string): boolean {
  if (!key) return false
  if (key.includes("\\") || key.includes("\0")) return false
  if (key.startsWith("/")) return false
  return key.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
}

/**
 * Whether this key is actually referenced by something published.
 *
 * THE PREFIX SHORTCUT IS GONE, DELIBERATELY.
 *
 * This used to begin `if (key.startsWith("posts/")) return true` — the editor's
 * paste-upload prefix was treated as unconditionally world-readable. But the
 * File Manager lets an admin file anything anywhere, so anything an admin
 * happened to put under `posts/` — a contract, an unreleased asset, an export —
 * was readable by anyone who could guess or enumerate its name, with no
 * reference to any published content at all.
 *
 * Paste-uploads still work: the editor writes them into post content as
 * `/api/public/images/<key>` URLs, so the content scan below finds them. The
 * difference is that they are now public because something published points at
 * them, which is the rule everywhere else in this function.
 */
async function isPubliclyReferenced(key: string): Promise<boolean> {
  // `isPublished` and `deletedAt` belong in the WHERE clause, not in a check on
  // the row that comes back: `findFirst` returns an arbitrary match, so a
  // trashed draft sharing an image with a live post would answer "not public"
  // for an image that plainly is.
  const post = await db.query.blogPosts.findFirst({
    where: and(
      eq(blogPosts.isPublished, true),
      isNull(blogPosts.deletedAt),
      or(eq(blogPosts.featuredImageKey, key), eq(blogPosts.ogImageKey, key))
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
        likeContains(blogPosts.content, needle)
      ),
    })
    if (referencingPost) return true

    // customPages has no deletedAt — there's no trash for this table.
    const referencingPage = await db.query.customPages.findFirst({
      where: and(
        eq(customPages.isPublished, true),
        likeContains(customPages.content, needle)
      ),
    })
    return !!referencingPage
  })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  // params is async in Next 16
  const { key } = await params
  const objectKey = key.map(decodeURIComponent).join("/")

  const notFound = () => NextResponse.json({ message: "Not found" }, { status: 404 })

  if (!isSafeKey(objectKey)) return notFound()
  if (getFileCategory(objectKey) !== "image") return notFound()
  if (!(await isPubliclyReferenced(objectKey))) return notFound()

  let body: Buffer
  try {
    body = await StorageService.downloadObject(objectKey)
  } catch {
    return notFound()
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": CONTENT_TYPES[getFileExtension(objectKey)] ?? "application/octet-stream",
      // Safe because the File Manager names uploads uniquely rather than
      // overwriting in place. Revisit if keys ever become mutable.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  })
}
