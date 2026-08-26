import type { MetadataRoute } from "next"
import {
  SITEMAP_CHUNK_SIZE,
  buildSitemapEntries,
  countSitemapChunks,
} from "@/Modules/Blog/Public/Queries/sitemapQueries"
import { resolveSeoContext } from "@/Modules/Blog/Public/Values/buildPostMetadata"

/**
 * Chunked sitemap. `generateSitemaps` moves this file's output from
 * `/sitemap.xml` to `/sitemap/0.xml`, `/sitemap/1.xml`, … — Next does NOT
 * emit an index of its own, so `src/app/sitemap.xml/route.ts` writes one and
 * that is what robots.txt and Search Console point at.
 *
 * Dynamic because the entry list comes from the database and every read path
 * runs publishDueScheduledPosts() — a build-time snapshot would go stale the
 * first time a scheduled post went live.
 */
export const dynamic = "force-dynamic"

export async function generateSitemaps(): Promise<{ id: number }[]> {
  try {
    const { base } = await resolveSeoContext()
    const count = await countSitemapChunks(base)
    return Array.from({ length: count }, (_, id) => ({ id }))
  } catch {
    // generateSitemaps also runs during `next build`, where the database may
    // not be reachable. One empty chunk keeps the route registered instead of
    // failing the build over a file that is regenerated on every request.
    return [{ id: 0 }]
  }
}

export default async function sitemap({
  id,
}: {
  // Async in Next 16 — the id resolves from the [__metadata_id__] segment.
  id: Promise<string>
}): Promise<MetadataRoute.Sitemap> {
  const parsed = Number.parseInt(await id, 10)
  const chunk = Number.isNaN(parsed) ? 0 : parsed

  const { base } = await resolveSeoContext()
  const entries = await buildSitemapEntries(base)

  return entries.slice(chunk * SITEMAP_CHUNK_SIZE, (chunk + 1) * SITEMAP_CHUNK_SIZE)
}
