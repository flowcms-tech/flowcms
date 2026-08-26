/**
 * One-off repair: rewrite presigned S3 image URLs stored in post bodies to the
 * permanent public image route.
 *
 * Why this exists: `ElementEditor` used to insert `thumbnailUrl` — a presigned
 * URL with a 1 h TTL — as the `src` of every in-content image. That value was
 * saved into `blog_post.content` and served publicly verbatim, so every
 * in-content image 404'd an hour after it was written. The editor now writes
 * `publicImagePath(key)` instead, but rows written before that fix still hold
 * dead URLs and will not repair themselves.
 *
 * Run with:  bun run src/db/backfillContentImageUrls.ts [--dry]
 *
 * `--dry` prints what would change and writes nothing. Run it first.
 *
 * Safe to run more than once: already-rewritten bodies contain no presigned
 * URLs, so they simply don't match.
 */
import { eq } from "drizzle-orm"
import { db } from "./client"
import { blogPosts } from "@/db/tables"
import { publicImagePath } from "@/Framework/Storage/publicImageUrl"

/** A presigned URL is any absolute http(s) URL carrying an AWS signature. The
 *  signature params are the tell — an ordinary absolute image URL to some
 *  other site must be left completely alone. */
const PRESIGNED_SRC = /src="(https?:\/\/[^"]*[?&]X-Amz-(?:Signature|Credential)=[^"]*)"/gi

/**
 * `https://endpoint/bucket/posts/a b.png?X-Amz-...` → `posts/a b.png`.
 *
 * The client runs `forcePathStyle: true`, so the first path segment is the
 * bucket. Returns null rather than guessing when the shape is unfamiliar — a
 * wrong key produces a 404 that looks exactly like the bug being fixed.
 */
function keyFromPresignedUrl(rawUrl: string, bucket: string | undefined): string | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }

  const segments = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent)
  if (segments.length === 0) return null

  // Drop the bucket segment when it is there. Virtual-host-style URLs put the
  // bucket in the hostname instead, in which case the path is already the key.
  if (bucket && segments[0] === bucket) segments.shift()
  if (segments.length === 0) return null

  return segments.join("/")
}

async function main() {
  const isDry = process.argv.includes("--dry")
  const bucket = process.env.S3_BUCKET

  const posts = await db.select({ id: blogPosts.id, slug: blogPosts.slug, content: blogPosts.content }).from(blogPosts)

  let changedPosts = 0
  let changedUrls = 0
  let skipped = 0

  for (const post of posts) {
    if (!post.content) continue

    let touched = 0
    const next = post.content.replace(PRESIGNED_SRC, (match, url: string) => {
      const key = keyFromPresignedUrl(url, bucket)
      if (!key) {
        skipped += 1
        console.warn(`  ! ${post.slug}: could not derive a key from ${url.slice(0, 80)}…`)
        return match
      }
      touched += 1
      return `src="${publicImagePath(key)}"`
    })

    if (touched === 0) continue

    changedPosts += 1
    changedUrls += touched
    console.log(`${isDry ? "would fix" : "fixed"} ${touched} image(s) in /blog/${post.slug}`)

    if (!isDry) {
      // `content` only — deliberately not touching `updatedAt`, and certainly
      // not `contentUpdatedAt`. This is a repair, not an edit: re-dating every
      // post because of an infrastructure fix is the exact dishonest
      // `dateModified` signal the rest of this work went out of its way to
      // avoid.
      await db.update(blogPosts).set({ content: next }).where(eq(blogPosts.id, post.id))
    }
  }

  console.log(
    `\n${isDry ? "DRY RUN — nothing written. " : ""}` +
      `${changedUrls} image URL(s) across ${changedPosts} post(s).` +
      (skipped > 0 ? ` ${skipped} left alone — see warnings above.` : "")
  )
}

await main()
